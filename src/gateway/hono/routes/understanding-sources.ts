import type { Hono } from 'hono';

import { resolveDefaultAgentId } from '../../../agent/agent-scope.js';
import {
  listConnectedContentCandidates,
  readConnectedContent,
} from '../../../connectors/content-enrichment.js';
import {
  countKnowledgeSourceItems,
  countMemoryRecordsBySourceInstanceId,
  deleteKnowledgeSourceItems,
  deleteMemoryRecordsBySourceInstanceId,
  deleteUnderstanding,
  getConnectorAccount,
  listUnderstandingEvidence,
  listUnderstandings,
  setUnderstandingStatus,
} from '../../../storage/sqlite/index.js';
import { listUnderstandingSourceDefinitions } from '../../../user-context/sources/catalog.js';
import {
  listUnderstandingSourceGrants,
  listUnderstandingSourceRuns,
  getUnderstandingSourceGrant,
  getUnderstandingSourceRun,
  deleteUserFocus,
  listUserFocusEvidence,
  listUserFocuses,
  revokeUnderstandingSourceGrant,
  updateUnderstandingSourceGrantPolicies,
  updateUserFocus,
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

export function sourceRevocationImpact(grantId: string) {
  const grant = getUnderstandingSourceGrant(grantId);
  if (!grant) return null;
  const accountId = typeof grant.config.accountId === 'string' ? grant.config.accountId : undefined;
  const connectorId = typeof grant.config.connectorId === 'string' ? grant.config.connectorId : undefined;
  const sourceInstanceId = accountId && connectorId ? `composio:${connectorId}:${accountId}` : undefined;
  const belongs = (evidence: { sourceRef: string; sourceInstanceId?: string }) => (
    evidence.sourceRef.startsWith(`understanding-source-grant:${grantId}:`)
    || Boolean(sourceInstanceId && evidence.sourceInstanceId === sourceInstanceId)
  );
  const understandings = listUnderstandings().flatMap((item) => {
    if (item.explicitness === 'explicit') return [];
    const evidence = listUnderstandingEvidence(item.id);
    return evidence.some(belongs) && !evidence.some((entry) => !belongs(entry)) ? [item] : [];
  });
  const focuses = listUserFocuses().flatMap((focus) => {
    if (focus.explicitness === 'explicit') return [];
    const sourceRun = focus.sourceRunId ? getUnderstandingSourceRun(focus.sourceRunId) : null;
    if (sourceRun?.grantId !== grantId) return [];
    const evidence = listUserFocusEvidence(focus.id);
    return evidence.some((entry) => !belongs(entry)) ? [] : [focus];
  });
  const memoryRecordCount = sourceInstanceId ? countMemoryRecordsBySourceInstanceId(sourceInstanceId) : 0;
  const boundedRawCount = sourceInstanceId ? countKnowledgeSourceItems(sourceInstanceId) : 0;
  return {
    grant,
    sourceInstanceId,
    understandingIds: understandings.map((item) => item.id),
    focusIds: focuses.map((item) => item.id),
    derivedCount: understandings.length + focuses.length + memoryRecordCount,
    understandingCount: understandings.length,
    focusCount: focuses.length,
    memoryRecordCount,
    boundedRawCount,
  };
}

export function applySourceRevocationChoices(
  impact: NonNullable<ReturnType<typeof sourceRevocationImpact>>,
  options: { derived: 'delete' | 'retain'; raw: 'delete' | 'retain' },
): { derivedDeleted: number; rawDeleted: number } {
  let derivedDeleted = 0;
  for (const id of impact.focusIds) {
    if (options.derived === 'delete') {
      if (deleteUserFocus(id)) derivedDeleted += 1;
    } else {
      updateUserFocus(id, { status: 'paused' });
    }
  }
  for (const id of impact.understandingIds) {
    if (options.derived === 'delete') {
      if (deleteUnderstanding(id)) derivedDeleted += 1;
    } else {
      setUnderstandingStatus(id, 'needs_review', { actorType: 'runtime', source: 'understanding-source-revoked' });
    }
  }
  if (options.derived === 'delete' && impact.sourceInstanceId) {
    derivedDeleted += deleteMemoryRecordsBySourceInstanceId(impact.sourceInstanceId);
  }
  const rawDeleted = options.raw === 'delete' && impact.sourceInstanceId
    ? deleteKnowledgeSourceItems(impact.sourceInstanceId)
    : 0;
  return { derivedDeleted, rawDeleted };
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

  authenticated.patch('/api/understanding/sources/grants/:grantId', limited, async (c) => {
    const body = await c.req.json().catch(() => null) as Record<string, unknown> | null;
    if (!body) return c.json({ ok: false, error: 'Invalid JSON' }, 400);
    const accessMode = body.accessMode;
    const retentionPolicy = body.retentionPolicy;
    const processingPolicy = body.processingPolicy;
    if (accessMode !== undefined && accessMode !== 'once' && accessMode !== 'continuous') {
      return c.json({ ok: false, error: 'Invalid access mode' }, 400);
    }
    if (retentionPolicy !== undefined
      && retentionPolicy !== 'metadata_only' && retentionPolicy !== 'derived_only' && retentionPolicy !== 'bounded_raw') {
      return c.json({ ok: false, error: 'Invalid retention policy' }, 400);
    }
    if (processingPolicy !== undefined && processingPolicy !== 'local_only' && processingPolicy !== 'remote_allowed') {
      return c.json({ ok: false, error: 'Invalid processing policy' }, 400);
    }
    if (accessMode === undefined && retentionPolicy === undefined && processingPolicy === undefined) {
      return c.json({ ok: false, error: 'At least one policy change is required' }, 400);
    }
    const grant = updateUnderstandingSourceGrantPolicies(c.req.param('grantId'), {
      ...(accessMode ? { accessMode: accessMode as 'once' | 'continuous' } : {}),
      ...(retentionPolicy ? { retentionPolicy: retentionPolicy as 'metadata_only' | 'derived_only' | 'bounded_raw' } : {}),
      ...(processingPolicy ? { processingPolicy: processingPolicy as 'local_only' | 'remote_allowed' } : {}),
    });
    return grant ? c.json({ ok: true, grant }) : c.json({ ok: false, error: 'Source grant not found' }, 404);
  });

  authenticated.get('/api/understanding/sources/grants/:grantId/impact', (c) => {
    const impact = sourceRevocationImpact(c.req.param('grantId'));
    return impact ? c.json({ ok: true, impact }) : c.json({ ok: false, error: 'Source grant not found' }, 404);
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
    const grantId = c.req.param('grantId');
    const impact = sourceRevocationImpact(grantId);
    const derived = c.req.query('derived');
    const raw = c.req.query('raw');
    if (derived !== 'delete' && derived !== 'retain') {
      return c.json({ ok: false, error: 'derived must be delete or retain' }, 400);
    }
    if (raw !== 'delete' && raw !== 'retain') {
      return c.json({ ok: false, error: 'raw must be delete or retain' }, 400);
    }
    const current = impact?.grant;
    const accountId = typeof current?.config.accountId === 'string' ? current.config.accountId : undefined;
    const connectionId = accountId ? getConnectorAccount(accountId)?.currentConnectionId : undefined;
    if (connectionId) deps.service.setConnectorLearningPaused(connectionId, true);
    const grant = revokeUnderstandingSourceGrant(grantId);
    const deleted = grant && impact
      ? applySourceRevocationChoices(impact, { derived, raw })
      : { derivedDeleted: 0, rawDeleted: 0 };
    return grant
      ? c.json({ ok: true, grant, impact, ...deleted })
      : c.json({ ok: false, error: 'Source grant not found' }, 404);
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
    const processingPolicy = stringField(body, 'processingPolicy');
    if (!rootPath) return c.json({ ok: false, error: 'Missing rootPath' }, 400);
    if (processingPolicy !== 'local_only' && processingPolicy !== 'remote_allowed') {
      return c.json({ ok: false, error: 'Explicit processingPolicy is required' }, 400);
    }
    try {
      return c.json({
        ok: true,
        source: await service.grantDirectorySource(rootPath, processingPolicy),
      }, 201);
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
      ? (body as { items: unknown[] }).items.slice(0, 1_200) : [];
    const processingPolicy = stringField(body, 'processingPolicy');
    if (!items.length) return c.json({ ok: false, error: 'No understanding source items were provided' }, 400);
    if (processingPolicy !== 'local_only' && processingPolicy !== 'remote_allowed') {
      return c.json({ ok: false, error: 'Explicit processingPolicy is required' }, 400);
    }
    try {
      const checkpoints = body && typeof body === 'object' && (body as Record<string, unknown>).sourceCheckpoints
        && typeof (body as Record<string, unknown>).sourceCheckpoints === 'object'
        ? (body as { sourceCheckpoints: Record<string, unknown> }).sourceCheckpoints : undefined;
      const result = await service.importUnderstandingSources(
        items,
        processingPolicy,
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
    const requestedStatus = stringField(body, 'status');
    const title = stringField(body, 'title');
    const summary = stringField(body, 'summary');
    const allowed = new Set<UserFocus['status']>(['candidate', 'active', 'paused', 'completed', 'rejected']);
    if (requestedStatus && !allowed.has(requestedStatus as UserFocus['status'])) {
      return c.json({ ok: false, error: 'Invalid focus status' }, 400);
    }
    if ((body as Record<string, unknown> | null)?.title !== undefined && !title) {
      return c.json({ ok: false, error: 'Focus title cannot be empty' }, 400);
    }
    if ((body as Record<string, unknown> | null)?.summary !== undefined && !summary) {
      return c.json({ ok: false, error: 'Focus summary cannot be empty' }, 400);
    }
    if (title.length > 300 || summary.length > 2_000) {
      return c.json({ ok: false, error: 'Focus title or summary is too long' }, 400);
    }
    if (!requestedStatus && !title && !summary) {
      return c.json({ ok: false, error: 'At least one focus change is required' }, 400);
    }
    const focus = updateUserFocus(c.req.param('focusId'), {
      ...(requestedStatus ? { status: requestedStatus as UserFocus['status'] } : {}),
      ...(title ? { title } : {}),
      ...(summary ? { summary } : {}),
    });
    return focus ? c.json({ ok: true, focus }) : c.json({ ok: false, error: 'Focus not found' }, 404);
  });

}
