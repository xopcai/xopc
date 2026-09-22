import { randomUUID } from 'node:crypto';

import type { Hono } from 'hono';

import { getConnectorAccount, listConnectorLearningJobs } from '../../../storage/sqlite/index.js';
import { getWorkDiscoveryRun } from '../../../work-discovery/repository.js';
import { isLocalUnderstandingSourceId } from '../../../user-context/sources/local-source-contract.js';
import { normalizeUnderstandingSourceItems } from '../../../work-discovery/service.js';
import { getConnectorUnderstandingSourceRun } from '../../../user-context/sources/repository.js';
import { UnderstandingRefreshService } from '../../../user-context/sources/refresh-service.js';
import type { AuthenticatedRouteDeps } from './deps.js';

export function createUnderstandingRefreshService(deps: AuthenticatedRouteDeps): UnderstandingRefreshService {
  const service = deps.service;
  return new UnderstandingRefreshService({
    enabled: () => service.currentConfig.userContext.enabled && service.currentConfig.userContext.userModel.enabled,
    emit: (type, payload) => service.emit(type, payload),
    async start(grant, runId) {
      if (grant.adapterId === 'local-work-folders') {
        const run = await service.workDiscovery.rescanDirectorySource({ id: grant.id, idempotencyKey: runId });
        return { discoveryRunId: run.id, phase: 'reading' };
      }
      if (isLocalUnderstandingSourceId(grant.adapterId)) return { phase: 'waiting_desktop' };
      if (grant.adapterId.startsWith('connector:')) {
        const account = typeof grant.config.accountId === 'string' ? getConnectorAccount(grant.config.accountId) : undefined;
        if (!account?.enabled || !account.currentConnectionId) throw new Error('Reconnect this source before updating.');
        const job = service.requestConnectorLearning(account.currentConnectionId, {
          mode: 'incremental', reason: 'manual', idempotencyKey: `understanding-refresh:${randomUUID()}`,
        });
        if (!job) throw new Error('This source cannot currently be updated.');
        return { connectorLearningJobId: job.id, accountId: account.id, phase: 'reading' };
      }
      throw new Error('This source does not support understanding updates.');
    },
    progress(run) {
      if (typeof run.metadata.discoveryRunId === 'string') {
        const discovery = getWorkDiscoveryRun(run.metadata.discoveryRunId);
        if (!discovery) return { status: 'failed', phase: 'completed', error: 'Work folder update is no longer available.' };
        return { status: discovery.status === 'completed' ? 'completed'
          : discovery.status === 'failed' || discovery.status === 'canceled' ? 'failed' : 'running',
        phase: discovery.status === 'analyzing' ? 'analyzing'
          : discovery.status === 'queued' || discovery.status === 'probing' ? 'reading' : 'completed',
        error: discovery.errorMessage };
      }
      if (typeof run.metadata.connectorLearningJobId === 'string') {
        const job = listConnectorLearningJobs({ accountId: String(run.metadata.accountId), limit: 100 })
          .find((item) => item.id === run.metadata.connectorLearningJobId);
        if (!job) return { status: 'failed', phase: 'completed', error: 'Connector update is no longer available.' };
        const sourceRun = getConnectorUnderstandingSourceRun(job.id);
        if (job.status === 'completed') return { status: sourceRun?.status === 'partial' ? 'partial' : 'completed',
          phase: 'completed', added: job.candidatesCreated, itemsSeen: job.itemsDiscovered,
          error: sourceRun?.status === 'partial' ? 'Some source information could not be analyzed. Retry this source.' : undefined };
        if (job.status === 'paused' || job.status === 'failed') return { status: 'failed', phase: 'completed', error: job.error ?? 'Connector update failed.' };
        return { status: 'running', phase: job.phase === 'deriving' ? 'analyzing' : 'reading', itemsSeen: job.itemsDiscovered };
      }
      return undefined;
    },
    async analyzeDesktop(grant, items, signal) {
      const result = await service.workDiscovery.importUnderstandingSources(items, grant.processingPolicy, signal,
        undefined, undefined, { grantId: grant.id });
      const status = result.sourceStatuses.find((item) => item.sourceId === grant.adapterId);
      if (status?.status !== 'completed') throw new Error(status?.error ?? 'Source analysis did not complete.');
      return {};
    },
  });
}

export function registerUserModelRefreshRoutes(app: Hono, deps: AuthenticatedRouteDeps,
  refresh = createUnderstandingRefreshService(deps)): void {
  app.post('/api/user-model/refresh', deps.strictRateLimitMiddleware, async (c) => {
    const input = await c.req.json().catch(() => null);
    if (!input || typeof input !== 'object' || Array.isArray(input)
      || (input.sourceIds !== undefined && (!Array.isArray(input.sourceIds)
        || !input.sourceIds.length || input.sourceIds.length > 100 || input.sourceIds.some((id: unknown) => typeof id !== 'string' || !id)))) {
      return c.json({ error: 'Provide sourceIds or an empty object to update all authorized sources.' }, 400);
    }
    try { return c.json({ batch: refresh.start(input.sourceIds) }, 202); }
    catch (err) { return c.json({ error: err instanceof Error ? err.message : String(err) }, 400); }
  });
  app.get('/api/user-model/refresh', (c) => c.json({ batch: refresh.latest(), sources: refresh.sources() }));
  app.get('/api/user-model/refresh/:id', (c) => {
    const batch = refresh.get(c.req.param('id'));
    return batch ? c.json({ batch }) : c.json({ error: 'Update not found.' }, 404);
  });
  app.post('/api/user-model/refresh/sources/:runId/collection', deps.strictRateLimitMiddleware, async (c) => {
    const raw = await c.req.json().catch(() => null);
    if (!raw || !Array.isArray(raw.items) || raw.items.length > 1_200
      || (raw.error !== undefined && typeof raw.error !== 'string')) return c.json({ error: 'Invalid collection.' }, 400);
    const items = normalizeUnderstandingSourceItems(raw.items);
    if (raw.items.length && !items.length) return c.json({ error: 'No valid source items.' }, 400);
    try {
      refresh.submitDesktop(c.req.param('runId'), { items, error: raw.error });
      return c.json({ ok: true }, 202);
    } catch (err) { return c.json({ error: err instanceof Error ? err.message : String(err) }, 409); }
  });
}
