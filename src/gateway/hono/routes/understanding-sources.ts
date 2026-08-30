import type { Hono } from 'hono';

import { resolveDefaultAgentId } from '../../../agent/agent-scope.js';
import {
  listConnectedContentCandidates,
  readConnectedContent,
} from '../../../connectors/content-enrichment.js';
import {
  deleteUnderstanding,
  getConnectorAccount,
  listUnderstandingEvidence,
  listUnderstandings,
} from '../../../storage/sqlite/index.js';
import { listUnderstandingSourceDefinitions } from '../../../user-context/sources/catalog.js';
import {
  listUnderstandingSourceGrants,
  listUnderstandingSourceRuns,
  getUnderstandingSourceGrant,
  deleteUserFocus,
  listUserFocuses,
  revokeUnderstandingSourceGrant,
  setUserFocusStatus,
} from '../../../user-context/sources/repository.js';
import type { UnderstandingSourcePlatform, UserFocus } from '../../../user-context/sources/types.js';
import type { AuthenticatedRouteDeps } from './deps.js';
import { getWorkDiscoveryService } from './work-discovery.js';

function stringField(body: unknown, field: string): string {
  if (!body || typeof body !== 'object') return '';
  const value = (body as Record<string, unknown>)[field];
  return typeof value === 'string' ? value.trim() : '';
}

function decisionsFrom(body: unknown): Array<{
  understandingId: string;
  status: 'accepted' | 'edited' | 'rejected';
  statement?: string;
}> {
  const values = body && typeof body === 'object' && Array.isArray((body as Record<string, unknown>).decisions)
    ? (body as { decisions: unknown[] }).decisions : [];
  return values.flatMap((value) => {
    if (!value || typeof value !== 'object') return [];
    const item = value as Record<string, unknown>;
    const understandingId = typeof item.understandingId === 'string' ? item.understandingId.trim() : '';
    const status: 'accepted' | 'edited' | 'rejected' | null = item.status === 'accepted'
      || item.status === 'edited' || item.status === 'rejected' ? item.status : null;
    if (!understandingId || !status) return [];
    return [{ understandingId, status, ...(typeof item.statement === 'string' ? { statement: item.statement } : {}) }];
  }).slice(0, 20);
}

export function registerUnderstandingSourceRoutes(authenticated: Hono, deps: AuthenticatedRouteDeps): void {
  const service = getWorkDiscoveryService(deps);
  const limited = deps.strictRateLimitMiddleware;

  authenticated.get('/api/understanding/sources/catalog', (c) => {
    const requested = c.req.query('platform');
    const platform: Exclude<UnderstandingSourcePlatform, 'all'> = requested === 'darwin' || requested === 'win32' || requested === 'linux'
      ? requested : process.platform as Exclude<UnderstandingSourcePlatform, 'all'>;
    return c.json({ ok: true, sources: listUnderstandingSourceDefinitions(platform) });
  });

  authenticated.get('/api/understanding/sources/grants', (c) => {
    const grants = listUnderstandingSourceGrants({ includeRevoked: c.req.query('includeRevoked') === 'true' });
    return c.json({
      ok: true,
      grants,
      latestRuns: Object.fromEntries(grants.flatMap((grant) => {
        const run = listUnderstandingSourceRuns(grant.id, 1)[0];
        return run ? [[grant.id, run]] : [];
      })),
    });
  });

  authenticated.get('/api/understanding/sources/content-candidates', (c) => {
    const agentId = resolveDefaultAgentId(deps.service.currentConfig);
    return c.json({ ok: true, candidates: listConnectedContentCandidates({ agentId }) });
  });

  authenticated.post('/api/understanding/sources/content-reads', limited, async (c) => {
    const body = await c.req.json().catch(() => null);
    const sourceItemIds = body && typeof body === 'object' && Array.isArray((body as Record<string, unknown>).sourceItemIds)
      ? (body as { sourceItemIds: unknown[] }).sourceItemIds.filter((value): value is string => typeof value === 'string')
      : [];
    try {
      const agentId = resolveDefaultAgentId(deps.service.currentConfig);
      return c.json({ ok: true, result: await readConnectedContent({ sourceItemIds, agentId }) });
    } catch (error) {
      return c.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, 400);
    }
  });

  authenticated.delete('/api/understanding/sources/grants/:grantId', limited, (c) => {
    const current = getUnderstandingSourceGrant(c.req.param('grantId'));
    const accountId = typeof current?.config.accountId === 'string' ? current.config.accountId : undefined;
    const connectorId = typeof current?.config.connectorId === 'string' ? current.config.connectorId : undefined;
    const sourceInstanceId = accountId && connectorId ? `composio:${connectorId}:${accountId}` : undefined;
    const connectionId = accountId ? getConnectorAccount(accountId)?.currentConnectionId : undefined;
    if (connectionId) deps.service.setConnectorLearningPaused(connectionId, true);
    const grant = revokeUnderstandingSourceGrant(c.req.param('grantId'));
    if (grant && c.req.query('deleteDerived') === 'true') {
      const activeGrantIds = new Set(listUnderstandingSourceGrants().map((item) => item.id));
      const activeSourceInstanceIds = new Set(listUnderstandingSourceGrants().flatMap((item) => {
        const activeAccountId = typeof item.config.accountId === 'string' ? item.config.accountId : undefined;
        const activeConnectorId = typeof item.config.connectorId === 'string' ? item.config.connectorId : undefined;
        return activeAccountId && activeConnectorId ? [`composio:${activeConnectorId}:${activeAccountId}`] : [];
      }));
      for (const understanding of listUnderstandings()) {
        const evidence = listUnderstandingEvidence(understanding.id);
        const grantEvidence = evidence
          .map((evidence) => /^understanding-source-grant:([^:]+):/.exec(evidence.sourceRef)?.[1])
          .filter((id): id is string => Boolean(id));
        const connectorEvidence = evidence
          .map((item) => item.sourceInstanceId)
          .filter((id): id is string => Boolean(id));
        const belongsToRevokedSource = grantEvidence.includes(grant.id)
          || Boolean(sourceInstanceId && connectorEvidence.includes(sourceInstanceId));
        const hasActiveAlternative = grantEvidence.some((id) => id !== grant.id && activeGrantIds.has(id))
          || connectorEvidence.some((id) => id !== sourceInstanceId && activeSourceInstanceIds.has(id));
        if (belongsToRevokedSource && !hasActiveAlternative) {
          deleteUnderstanding(understanding.id);
        }
      }
    }
    return grant ? c.json({ ok: true, grant }) : c.json({ ok: false, error: 'Source grant not found' }, 404);
  });

  authenticated.post('/api/understanding/sources/grants/:grantId/refresh', limited, async (c) => {
    const grant = getUnderstandingSourceGrant(c.req.param('grantId'));
    if (!grant || grant.status !== 'active') return c.json({ ok: false, error: 'Active source grant not found' }, 404);
    try {
      if (grant.adapterId === 'local-work-folders') {
        const result = await service.refreshDirectorySourceIfChanged({ id: grant.id, idempotencyKey: crypto.randomUUID() });
        return c.json({ ok: true, result }, result.changed ? 202 : 200);
      }
      const accountId = typeof grant.config.accountId === 'string' ? grant.config.accountId : '';
      const connectionId = accountId ? getConnectorAccount(accountId)?.currentConnectionId : undefined;
      if (connectionId) {
        const job = deps.service.requestConnectorLearning(connectionId, { mode: 'incremental', reason: 'manual' });
        return job ? c.json({ ok: true, job }, 202) : c.json({ ok: false, error: 'Source does not support learning' }, 409);
      }
      return c.json({ ok: false, error: 'This source is collected from the desktop app' }, 409);
    } catch (error) {
      return c.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, 400);
    }
  });

  authenticated.get('/api/understanding/sources/work-folders', (c) => c.json({
    ok: true,
    sources: service.listDirectorySources(),
  }));

  authenticated.post('/api/understanding/sources/work-folders', limited, async (c) => {
    const body = await c.req.json().catch(() => null);
    const rootPath = stringField(body, 'rootPath');
    if (!rootPath) return c.json({ ok: false, error: 'Missing rootPath' }, 400);
    try {
      return c.json({ ok: true, source: await service.grantDirectorySource(rootPath) }, 201);
    } catch (error) {
      return c.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, 400);
    }
  });

  authenticated.post('/api/understanding/sources/work-folders/:grantId/runs', limited, async (c) => {
    try {
      const run = await service.rescanDirectorySource({ id: c.req.param('grantId'), idempotencyKey: crypto.randomUUID() });
      return c.json({ ok: true, run }, 202);
    } catch (error) {
      return c.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, 400);
    }
  });

  authenticated.post('/api/understanding/bootstrap', limited, async (c) => {
    const body = await c.req.json().catch(() => null);
    const items = body && typeof body === 'object' && Array.isArray((body as Record<string, unknown>).items)
      ? (body as { items: unknown[] }).items.slice(0, 150) : [];
    if (!items.length) return c.json({ ok: false, error: 'No understanding source items were provided' }, 400);
    try {
      const checkpoints = body && typeof body === 'object' && (body as Record<string, unknown>).sourceCheckpoints
        && typeof (body as Record<string, unknown>).sourceCheckpoints === 'object'
        ? (body as { sourceCheckpoints: Record<string, unknown> }).sourceCheckpoints : undefined;
      const result = await service.importUnderstandingSources(
        items,
        c.req.raw.signal,
        stringField(body, 'workDiscoveryRunId') || undefined,
        checkpoints,
      );
      return c.json({ ok: true, ...result }, 201);
    } catch (error) {
      return c.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, 400);
    }
  });

  authenticated.post('/api/understanding/review', limited, async (c) => {
    const body = await c.req.json().catch(() => null);
    const decisions = decisionsFrom(body);
    if (!decisions.length) return c.json({ ok: false, error: 'At least one valid decision is required' }, 400);
    return c.json({ ok: true, decisions: service.updateUnderstandingSourceProfile({ decisions }) });
  });

  authenticated.get('/api/understanding/focuses', (c) => c.json({ ok: true, focuses: listUserFocuses() }));

  authenticated.patch('/api/understanding/focuses/:focusId', limited, async (c) => {
    const body = await c.req.json().catch(() => null);
    const requested = stringField(body, 'status');
    const allowed = new Set<UserFocus['status']>(['candidate', 'active', 'paused', 'completed', 'rejected']);
    if (!allowed.has(requested as UserFocus['status'])) return c.json({ ok: false, error: 'Invalid focus status' }, 400);
    const focus = setUserFocusStatus(c.req.param('focusId'), requested as UserFocus['status']);
    return focus ? c.json({ ok: true, focus }) : c.json({ ok: false, error: 'Focus not found' }, 404);
  });

  authenticated.delete('/api/understanding/focuses/:focusId', limited, (c) => (
    deleteUserFocus(c.req.param('focusId'))
      ? c.json({ ok: true })
      : c.json({ ok: false, error: 'Focus not found' }, 404)
  ));
}
