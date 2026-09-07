import { randomUUID } from 'node:crypto';

import type { Hono } from 'hono';

import { resolveDefaultAgentId } from '../../../agent/agent-scope.js';
import { listConnectedContentCandidates, readConnectedContent } from '../../../connectors/content-enrichment.js';
import {
  countKnowledgeSourceItems,
  deleteKnowledgeSourceItems,
  getConnectorAccount,
} from '../../../storage/sqlite/index.js';
import { getSqliteDatabase } from '../../../storage/sqlite/transaction.js';
import { setAssertionStatus } from '../../../user-model/index.js';
import { listUnderstandingSourceDefinitions } from '../../../user-context/sources/catalog.js';
import {
  getUnderstandingSourceGrant,
  listUnderstandingSourceGrants,
  listUnderstandingSourceRuns,
  revokeUnderstandingSourceGrant,
  updateUnderstandingSourceGrantPolicies,
} from '../../../user-context/sources/repository.js';
import type { UnderstandingSourcePlatform } from '../../../user-context/sources/types.js';
import type { AuthenticatedRouteDeps } from './deps.js';
import { getWorkDiscoveryService } from './work-discovery.js';

function stringField(value: unknown, field: string): string {
  if (!value || typeof value !== 'object') return '';
  const fieldValue = (value as Record<string, unknown>)[field];
  return typeof fieldValue === 'string' ? fieldValue.trim() : '';
}

function sourceInstanceId(grant: NonNullable<ReturnType<typeof getUnderstandingSourceGrant>>): string | undefined {
  const accountId = typeof grant.config.accountId === 'string' ? grant.config.accountId : undefined;
  const connectorId = typeof grant.config.connectorId === 'string' ? grant.config.connectorId : undefined;
  return accountId && connectorId ? `composio:${connectorId}:${accountId}` : undefined;
}

function assertionIdsForSource(instanceId: string): string[] {
  return (getSqliteDatabase().prepare(`SELECT DISTINCT ae.assertion_id
    FROM user_assertion_evidence ae JOIN context_evidence e ON e.evidence_id = ae.evidence_id
    WHERE e.source_instance_id = ?`).all(instanceId) as Array<{ assertion_id: string }>)
    .map((row) => row.assertion_id);
}

export function markContextSourceAssertionsForReview(grantId: string): number {
  const grant = getUnderstandingSourceGrant(grantId);
  const instanceId = grant ? sourceInstanceId(grant) : undefined;
  const ids = instanceId ? assertionIdsForSource(instanceId) : [];
  for (const id of ids) {
    setAssertionStatus(id, 'needs_review', { actor: 'runtime', reason: 'Its context source was revoked.' });
  }
  return ids.length;
}

export function registerContextSourceRoutes(authenticated: Hono, deps: AuthenticatedRouteDeps): void {
  const service = getWorkDiscoveryService(deps);
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
    const instanceId = sourceInstanceId(current);
    const affectedAssertions = markContextSourceAssertionsForReview(current.id);
    const deleteRaw = c.req.query('deleteRaw') === 'true';
    const rawDeleted = deleteRaw && instanceId ? deleteKnowledgeSourceItems(instanceId) : 0;
    const accountId = typeof current.config.accountId === 'string' ? current.config.accountId : undefined;
    const connectionId = accountId ? getConnectorAccount(accountId)?.currentConnectionId : undefined;
    if (connectionId) deps.service.setConnectorLearningPaused(connectionId, true);
    return c.json({ grant: revokeUnderstandingSourceGrant(current.id), affectedAssertions, rawDeleted });
  });

  authenticated.get('/api/context-sources/content-candidates', (c) => c.json({
    candidates: listConnectedContentCandidates({ agentId: resolveDefaultAgentId(deps.service.currentConfig) }),
  }));

  authenticated.post('/api/context-sources/content-reads', limited, async (c) => {
    const input = await c.req.json().catch(() => null);
    const sourceItemIds = input && typeof input === 'object' && Array.isArray((input as Record<string, unknown>).sourceItemIds)
      ? (input as { sourceItemIds: unknown[] }).sourceItemIds.filter((item): item is string => typeof item === 'string')
      : [];
    try {
      return c.json({ result: await readConnectedContent({
        sourceItemIds, agentId: resolveDefaultAgentId(deps.service.currentConfig),
      }) });
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : String(error) }, 400);
    }
  });

  authenticated.post('/api/context-sources/grants/:grantId/refresh', limited, async (c) => {
    const grant = getUnderstandingSourceGrant(c.req.param('grantId'));
    if (!grant || grant.status !== 'active') return c.json({ error: 'Active context source not found' }, 404);
    try {
      if (grant.adapterId === 'local-work-folders') {
        const result = await service.refreshDirectorySourceIfChanged({ id: grant.id, idempotencyKey: randomUUID() });
        return c.json({ result }, result.changed ? 202 : 200);
      }
      const accountId = typeof grant.config.accountId === 'string' ? grant.config.accountId : '';
      const connectionId = accountId ? getConnectorAccount(accountId)?.currentConnectionId : undefined;
      const job = connectionId
        ? deps.service.requestConnectorLearning(connectionId, { mode: 'incremental', reason: 'manual' })
        : null;
      return job ? c.json({ job }, 202) : c.json({ error: 'Context source cannot be refreshed here' }, 409);
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

  authenticated.post('/api/context-sources/bootstrap', limited, async (c) => {
    const input = await c.req.json().catch(() => null);
    const items = input && typeof input === 'object' && Array.isArray((input as Record<string, unknown>).items)
      ? (input as { items: unknown[] }).items.slice(0, 1_200) : [];
    const processingPolicy = stringField(input, 'processingPolicy');
    if (!items.length || (processingPolicy !== 'local_only' && processingPolicy !== 'remote_allowed')) {
      return c.json({ error: 'items and an explicit processingPolicy are required' }, 400);
    }
    try {
      const result = await service.importUnderstandingSources(items, processingPolicy, c.req.raw.signal);
      return c.json(result, 201);
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : String(error) }, 400);
    }
  });

  authenticated.get('/api/context-sources/:grantId/raw-count', (c) => {
    const grant = getUnderstandingSourceGrant(c.req.param('grantId'));
    const instanceId = grant ? sourceInstanceId(grant) : undefined;
    return grant ? c.json({ count: instanceId ? countKnowledgeSourceItems(instanceId) : 0 })
      : c.json({ error: 'Context source not found' }, 404);
  });
}
