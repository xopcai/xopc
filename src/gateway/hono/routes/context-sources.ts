import type { Hono } from 'hono';

import { resolveDefaultAgentId } from '../../../agent/agent-scope.js';
import { listConnectedContentCandidates, readConnectedContent } from '../../../connectors/content-enrichment.js';
import {
  countKnowledgeSourceItems,
  deleteKnowledgeSourceItems,
  getConnectorAccount,
} from '../../../storage/sqlite/index.js';
import { getSqliteDatabase } from '../../../storage/sqlite/transaction.js';
import { listUserModelObservations } from '../../../user-model/index.js';
import { listUnderstandingSourceDefinitions } from '../../../user-context/sources/catalog.js';
import { getActiveUnderstandingConsent } from '../../../user-context/sources/consent-repository.js';
import {
  getUnderstandingSourceGrant,
  listUnderstandingSourceGrants,
  listUnderstandingSourceRuns,
  resolveGrantSourceInstanceId,
  revokeUnderstandingSourceGrant,
  updateUnderstandingSourceGrantPolicies,
} from '../../../user-context/sources/repository.js';
import type { UnderstandingSourcePlatform } from '../../../user-context/sources/types.js';
import type { DeepUnderstandingConfirmationInput } from '../../../work-discovery/types.js';
import type { AuthenticatedRouteDeps } from './deps.js';

function stringField(value: unknown, field: string): string {
  if (!value || typeof value !== 'object') return '';
  const fieldValue = (value as Record<string, unknown>)[field];
  return typeof fieldValue === 'string' ? fieldValue.trim() : '';
}

function stringArray(value: unknown, max = 32): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    .map((item) => item.trim())
    .slice(0, max);
}

function assertionIdsForSource(instanceId: string): string[] {
  return (getSqliteDatabase().prepare(`SELECT DISTINCT ae.assertion_id
    FROM user_assertion_evidence ae JOIN context_evidence e ON e.evidence_id = ae.evidence_id
    WHERE e.source_instance_id = ?`).all(instanceId) as Array<{ assertion_id: string }>)
    .map((row) => row.assertion_id);
}

export function registerContextSourceRoutes(authenticated: Hono, deps: AuthenticatedRouteDeps): void {
  const service = deps.service.workDiscovery;
  const limited = deps.strictRateLimitMiddleware;

  authenticated.get('/api/context-sources/catalog', (c) => {
    const requested = c.req.query('platform');
    const platform: Exclude<UnderstandingSourcePlatform, 'all'> = requested === 'darwin'
      || requested === 'win32' || requested === 'linux'
      ? requested : process.platform as Exclude<UnderstandingSourcePlatform, 'all'>;
    return c.json({ sources: listUnderstandingSourceDefinitions(platform) });
  });

  authenticated.get('/api/context-sources/grants', (c) => {
    const grants = listUnderstandingSourceGrants({ includeRevoked: c.req.query('includeRevoked') === 'true' });
    return c.json({
      grants,
      consents: Object.fromEntries(grants.map((grant) => [grant.id, getActiveUnderstandingConsent(grant.id)])),
      latestRuns: Object.fromEntries(grants.flatMap((grant) => {
        const run = listUnderstandingSourceRuns(grant.id, 1)[0];
        return run ? [[grant.id, run]] : [];
      })),
    });
  });

  authenticated.patch('/api/context-sources/grants/:grantId', limited, async (c) => {
    const input = await c.req.json().catch(() => null) as Record<string, unknown> | null;
    if (!input) return c.json({ error: 'Invalid JSON' }, 400);
    const accessMode = input.accessMode;
    const retentionPolicy = input.retentionPolicy;
    const processingPolicy = input.processingPolicy;
    if (accessMode !== undefined && accessMode !== 'once' && accessMode !== 'continuous') {
      return c.json({ error: 'Invalid access mode' }, 400);
    }
    if (retentionPolicy !== undefined && !['metadata_only', 'derived_only', 'bounded_raw'].includes(String(retentionPolicy))) {
      return c.json({ error: 'Invalid retention policy' }, 400);
    }
    if (processingPolicy !== undefined && processingPolicy !== 'local_only' && processingPolicy !== 'remote_allowed') {
      return c.json({ error: 'Invalid processing policy' }, 400);
    }
    const grant = updateUnderstandingSourceGrantPolicies(c.req.param('grantId'), {
      ...(accessMode ? { accessMode: accessMode as 'once' | 'continuous' } : {}),
      ...(retentionPolicy ? { retentionPolicy: retentionPolicy as 'metadata_only' | 'derived_only' | 'bounded_raw' } : {}),
      ...(processingPolicy ? { processingPolicy: processingPolicy as 'local_only' | 'remote_allowed' } : {}),
    });
    return grant ? c.json({ grant }) : c.json({ error: 'Context source not found' }, 404);
  });

  authenticated.delete('/api/context-sources/grants/:grantId', limited, (c) => {
    const current = getUnderstandingSourceGrant(c.req.param('grantId'));
    if (!current) return c.json({ error: 'Context source not found' }, 404);
    const instanceId = resolveGrantSourceInstanceId(current);
    const affectedAssertions = instanceId ? assertionIdsForSource(instanceId).length : 0;
    const deleteRaw = c.req.query('deleteRaw') === 'true';
    const rawDeleted = deleteRaw && instanceId ? deleteKnowledgeSourceItems(instanceId) : 0;
    const observationsDeleted = listUserModelObservations({ sourceGrantId: current.id, limit: 2_000 }).length;
    const accountId = typeof current.config.accountId === 'string' ? current.config.accountId : undefined;
    const connectionId = accountId ? getConnectorAccount(accountId)?.currentConnectionId : undefined;
    if (connectionId) deps.service.setConnectorLearningPaused(connectionId, true);
    return c.json({
      grant: revokeUnderstandingSourceGrant(current.id), affectedAssertions, rawDeleted, observationsDeleted,
    });
  });

  authenticated.get('/api/context-sources/content-candidates', (c) => c.json({
    candidates: listConnectedContentCandidates({ agentId: resolveDefaultAgentId() }),
  }));

  authenticated.post('/api/context-sources/content-reads', limited, async (c) => {
    const input = await c.req.json().catch(() => null);
    const sourceItemIds = input && typeof input === 'object' && Array.isArray((input as Record<string, unknown>).sourceItemIds)
      ? (input as { sourceItemIds: unknown[] }).sourceItemIds.filter((item): item is string => typeof item === 'string')
      : [];
    try {
      return c.json({ result: await readConnectedContent({
        sourceItemIds, agentId: resolveDefaultAgentId(),
      }) });
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : String(error) }, 400);
    }
  });

  authenticated.get('/api/context-sources/work-folders', (c) => c.json({ sources: service.listDirectorySources() }));
  authenticated.post('/api/context-sources/work-folders', limited, async (c) => {
    const input = await c.req.json().catch(() => null);
    const rootPath = stringField(input, 'rootPath');
    const processingPolicy = stringField(input, 'processingPolicy');
    if (!rootPath || (processingPolicy !== 'local_only' && processingPolicy !== 'remote_allowed')) {
      return c.json({ error: 'rootPath and an explicit processingPolicy are required' }, 400);
    }
    try {
      return c.json({ source: await service.grantDirectorySource(rootPath, processingPolicy) }, 201);
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : String(error) }, 400);
    }
  });

  authenticated.get('/api/context-sources/local-preview', async (c) => {
    const rawDirs = c.req.query('customNoteDirectories');
    const customNoteDirectories = rawDirs
      ? rawDirs.split(',').map((dir) => dir.trim()).filter(Boolean).slice(0, 10)
      : undefined;
    const previews = await service.previewLocalUnderstandingSources(customNoteDirectories);
    return c.json({ platform: process.platform, previews });
  });

  authenticated.post('/api/context-sources/understanding-runs', limited, async (c) => {
    const input = await c.req.json().catch(() => null);
    if (!input || typeof input !== 'object') return c.json({ error: 'Invalid JSON body' }, 400);
    const raw = input as Record<string, unknown>;
    const processingPolicy = stringField(raw, 'processingPolicy');
    if (processingPolicy !== 'local_only' && processingPolicy !== 'remote_allowed') {
      return c.json({ error: 'An explicit processingPolicy is required' }, 400);
    }
    const selectedTier1Sources = stringArray(raw.selectedTier1Sources, 16);
    const customNoteDirectories = stringArray(raw.customNoteDirectories, 10);
    const excludeIds = stringArray(raw.excludeIds, 64);
    const precollectedItems = Array.isArray(raw.precollectedItems) ? raw.precollectedItems.slice(0, 1_200) : [];
    const locale = stringField(raw, 'locale') || undefined;
    const sourceCheckpoints = raw.sourceCheckpoints && typeof raw.sourceCheckpoints === 'object' && !Array.isArray(raw.sourceCheckpoints)
      ? raw.sourceCheckpoints as Record<string, unknown>
      : undefined;
    try {
      const run = service.startDeepUnderstandingRun({
        selectedTier1Sources,
        customNoteDirectories,
        excludeIds,
        precollectedItems,
        sourceCheckpoints,
        processingPolicy,
        locale,
      });
      return c.json({ run }, 202);
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : String(error) }, 400);
    }
  });

  authenticated.get('/api/context-sources/understanding-runs/latest', (c) => {
    return c.json({ run: service.getLatestDeepUnderstandingRun() });
  });

  authenticated.get('/api/context-sources/understanding-runs/:runId', (c) => {
    const run = service.getDeepUnderstandingRun(c.req.param('runId'));
    return run ? c.json({ run }) : c.json({ error: 'Understanding run not found' }, 404);
  });

  authenticated.post('/api/context-sources/understanding-runs/:runId/cancel', (c) => {
    const run = service.cancelDeepUnderstandingRun(c.req.param('runId'));
    return run ? c.json({ run }) : c.json({ error: 'Understanding run not found' }, 404);
  });

  authenticated.post('/api/context-sources/understanding-runs/:runId/confirm', limited, async (c) => {
    const input = await c.req.json().catch(() => null);
    if (!input || typeof input !== 'object') return c.json({ error: 'Invalid JSON body' }, 400);
    try {
      const result = service.confirmDeepUnderstandingRun(
        c.req.param('runId'),
        input as DeepUnderstandingConfirmationInput,
      );
      return c.json(result);
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : String(error) }, 400);
    }
  });

  authenticated.get('/api/context-sources/:grantId/raw-count', (c) => {
    const grant = getUnderstandingSourceGrant(c.req.param('grantId'));
    const instanceId = grant ? resolveGrantSourceInstanceId(grant) : undefined;
    return grant ? c.json({ count: instanceId ? countKnowledgeSourceItems(instanceId) : 0 })
      : c.json({ error: 'Context source not found' }, 404);
  });
}
