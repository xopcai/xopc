import type { Config } from '../config/schema.js';
import { getWorkspacePath } from '../config/workspace-path-helpers.js';
import type { MemoryManager } from '../agent/memory/manager.js';
import {
  claimNextConnectorLearningJob,
  enqueueConnectorLearningJob,
  finishContextExtractionRun,
  listConnectorConnections,
  listConnectorLearningJobs,
  getConnectorAccount,
  getConnectorInstallation,
  getConnectorSyncPolicyForConnection,
  recoverStaleConnectorLearningJobs,
  reconcileConnectorAccount,
  setConnectorLearningPaused,
  updateConnectorLearningJob,
  upsertConnectorConnection,
  type ConnectorLearningJob,
} from '../storage/sqlite/index.js';
import { ConnectedKnowledgePipeline } from '../knowledge/index.js';
import { createLogger } from '../utils/logger.js';
import {
  createUnderstandingSourceRun,
  getUnderstandingSourceGrant,
  listUnderstandingSourceRuns,
  upsertUnderstandingSourceGrant,
  updateUnderstandingSourceGrantCheckpoint,
  updateUnderstandingSourceRun,
} from '../user-context/sources/repository.js';
import type { UnderstandingSourceCategory, UnderstandingSourceRun } from '../user-context/sources/types.js';
import { getConnectorDefinition } from './catalog.js';
import { ComposioSessionsAdapter } from './composio-sessions.js';
import { connectorIdentityKey, normalizeConnectorIdentity } from './connector-identity.js';
import { deriveConnectedSourceUnderstanding } from './connected-source-understanding.js';
import { ingestComposioConnectedSource } from './connected-source-ingestion.js';
import { listConnectedContentCandidates, readConnectedContent } from './content-enrichment.js';
import { buildConnectorLearningArguments, getConnectorLearningPlan } from './learning-recipes.js';

const log = createLogger('ConnectorLearning');
const CONNECTED_ACCOUNT_UNAVAILABLE = 'connected_account_unavailable';
const CONNECTED_SOURCE_SYNC_FAILED = 'connected_source_sync_failed';
const CONNECTED_SOURCE_ANALYSIS_FAILED = 'connected_source_analysis_failed';

function learningFailureCode(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes('ToolRouterV2_InvalidConnectedAccountIds')
    || message.includes('Could not find connected account(s)')
    || message.includes('missing its provider identity')
    ? CONNECTED_ACCOUNT_UNAVAILABLE
    : CONNECTED_SOURCE_SYNC_FAILED;
}

function connectorSourceCategory(toolkit: string): UnderstandingSourceCategory {
  if (toolkit === 'gmail') return 'mail';
  if (toolkit === 'googlecalendar') return 'calendar';
  if (toolkit === 'github' || toolkit === 'linear') return 'code_activity';
  return 'files';
}

function ensureUnderstandingSourceRun(
  job: ConnectorLearningJob,
  toolkit: string,
  displayName: string,
): UnderstandingSourceRun {
  const grant = upsertUnderstandingSourceGrant({
    sourceKey: `connector-account:${job.accountId}`,
    adapterId: `connector:${job.connectorId}`,
    category: connectorSourceCategory(toolkit),
    platform: 'all',
    displayName,
    accessMode: 'continuous',
    retentionPolicy: 'bounded_raw',
    processingPolicy: 'remote_allowed',
    config: { connectorId: job.connectorId, accountId: job.accountId, readOnly: true },
  });
  return listUnderstandingSourceRuns(grant.id, 100)
    .find((run) => run.metadata.connectorLearningJobId === job.id)
    ?? createUnderstandingSourceRun({
      grantId: grant.id,
      kind: job.mode,
      status: 'queued',
      metadata: { connectorLearningJobId: job.id, connectorId: job.connectorId },
    });
}

export type ConnectorLearningCoordinator = {
  enqueueConnection(connectionId: string, request?: {
    mode?: 'bootstrap' | 'incremental';
    reason?: 'manual' | 'event' | 'schedule';
    idempotencyKey?: string;
    nextRunAt?: number;
  }): ConnectorLearningJob | null;
  enqueueToolkit(toolkit: string): ConnectorLearningJob[];
  setPaused(connectionId: string, paused: boolean): number;
  runNow(): Promise<void>;
  stop(): void;
};

function learningEnabled(config: Config): boolean {
  return config.userContext.enabled
    && config.userContext.understanding.enabled;
}

export function startConnectorLearningCoordinator(options: {
  getConfig: () => Config;
  resolveAgentId: () => string;
  getMemoryManager: () => MemoryManager;
  emit?: (type: string, payload: unknown) => void;
  intervalMs?: number;
  initialDelayMs?: number;
  composioAdapter?: ComposioSessionsAdapter;
}): ConnectorLearningCoordinator {
  const intervalMs = Math.max(2_000, Math.min(options.intervalMs ?? 10_000, 60_000));
  let timer: NodeJS.Timeout | null = null;
  let running = false;
  let stopped = false;
  const composioAdapter = options.composioAdapter ?? new ComposioSessionsAdapter();

  const publish = (job: ConnectorLearningJob) => options.emit?.('connector.learning.updated', job);

  const activeAccountConnections = () => listConnectorConnections()
    .filter((connection) => connection.status === 'active' && connection.accountId)
    .filter((connection) => getConnectorAccount(connection.accountId!)?.currentConnectionId === connection.id);

  function enqueueConnection(
    connectionId: string,
    request: {
      mode?: 'bootstrap' | 'incremental';
      reason?: 'manual' | 'event' | 'schedule';
      idempotencyKey?: string;
      nextRunAt?: number;
    } = {},
  ): ConnectorLearningJob | null {
    const config = options.getConfig();
    if (!learningEnabled(config)) return null;
    const connection = listConnectorConnections().find((item) => item.id === connectionId && item.status === 'active');
    if (!connection) return null;
    if (!connection.accountId) throw new Error(`Connector account is missing for connection ${connection.id}.`);
    const syncPolicy = getConnectorSyncPolicyForConnection(connection.id);
    if (request.reason !== 'manual' && syncPolicy?.scanEnabled === false) return null;
    const definition = getConnectorDefinition(connection.connectorId);
    if (definition?.runtime.type !== 'composio' || definition.runtime.role !== 'toolkit') return null;
    if (!getConnectorLearningPlan(definition.runtime.toolkit)) return null;
    const sourceInstanceId = `composio:${connection.connectorId}:${connection.accountId}`;
    const existing = listConnectorLearningJobs({ accountId: connection.accountId, limit: 1 });
    const mode = request.mode ?? (existing.length === 0 ? 'bootstrap' : 'incremental');
    const bucket = Math.floor(Date.now() / 60_000);
    const job = enqueueConnectorLearningJob({
      connectorId: connection.connectorId,
      accountId: connection.accountId,
      connectionId: connection.id,
      sourceInstanceId,
      agentId: options.resolveAgentId(),
      mode,
      idempotencyKey: request.idempotencyKey
        ?? (mode === 'bootstrap'
          ? `bootstrap:${connection.accountId}:v1`
          : `incremental:${connection.accountId}:${request.reason ?? 'manual'}:${bucket}`),
      nextRunAt: request.nextRunAt,
    });
    ensureUnderstandingSourceRun(job, definition.runtime.toolkit, definition.displayName);
    publish(job);
    queueMicrotask(() => void runNow());
    return job;
  }

  function enqueueToolkit(toolkit: string): ConnectorLearningJob[] {
    const normalized = toolkit.trim().toLowerCase();
    return activeAccountConnections()
      .filter((connection) => {
        const definition = getConnectorDefinition(connection.connectorId);
        return definition?.runtime.type === 'composio'
          && definition.runtime.role === 'toolkit'
          && definition.runtime.toolkit === normalized;
      })
      .map((connection) => enqueueConnection(connection.id, { reason: 'event' }))
      .filter((job): job is ConnectorLearningJob => Boolean(job));
  }

  async function execute(job: ConnectorLearningJob): Promise<void> {
    publish(job);
    const definition = getConnectorDefinition(job.connectorId);
    if (definition?.runtime.type !== 'composio' || definition.runtime.role !== 'toolkit') {
      throw new Error(`Connector learning is unavailable for ${job.connectorId}.`);
    }
    const plan = getConnectorLearningPlan(definition.runtime.toolkit);
    if (!plan) throw new Error(`Connector learning has no plan for ${definition.runtime.toolkit}.`);
    const sourceRun = ensureUnderstandingSourceRun(job, plan.toolkit, definition.displayName);
    updateUnderstandingSourceRun(sourceRun.id, { status: 'running' });
    let connection = listConnectorConnections().find((candidate) => candidate.id === job.connectionId);
    if (!connection) throw new Error('Connector account no longer exists.');
    const installation = getConnectorInstallation(`${job.connectorId}-local-owner`);
    if (!installation?.enabled) throw new Error('Connector installation is not enabled.');
    const hasIdentity = Object.values(connection.identity).some((value) => typeof value === 'string' && value.trim());
    if (plan.identityProbe && (job.mode === 'bootstrap' || !hasIdentity)) {
      const execution = await composioAdapter.executeWithPolicy({
        context: { principalId: connection.principalId, toolkits: [plan.toolkit] },
        installation: { ...installation, maxScope: 'read', confirmationPolicy: 'never' },
        connection,
        agentId: job.agentId,
        action: {
          connectorId: job.connectorId,
          actionId: plan.identityProbe.actionId,
          toolkit: plan.toolkit,
          scope: 'read',
          curated: true,
          cachedAt: new Date().toISOString(),
        },
        args: {},
        confirmed: true,
      });
      if (execution.decision !== 'allowed') throw new Error(execution.reason);
      connection = upsertConnectorConnection({
        ...connection,
        identity: normalizeConnectorIdentity(plan.toolkit, execution.result),
      });
      const identityKey = connectorIdentityKey(plan.toolkit, connection.identity);
      if (identityKey) {
        const account = reconcileConnectorAccount({
          connectionId: connection.id,
          identityKey,
          identity: connection.identity,
        });
        connection = listConnectorConnections().find((candidate) => candidate.id === connection.id)!;
        job = updateConnectorLearningJob(job.id, {
          accountId: account.id,
          sourceInstanceId: `composio:${connection.connectorId}:${account.id}`,
        });
      }
    }
    let itemsSeen = 0;
    let itemsIndexed = 0;
    for (const stream of plan.streams) {
      const synced = await ingestComposioConnectedSource({
        config: options.getConfig(),
        connectorId: job.connectorId,
        connectionId: job.connectionId,
        collectionScope: stream.scope,
        streamKind: stream.kind,
        actionId: stream.actionId,
        arguments: stream.arguments,
        buildArguments: (pull) => buildConnectorLearningArguments(plan, stream, pull, connection.identity),
        agentId: job.agentId,
      });
      itemsSeen += synced.itemsSeen;
      itemsIndexed += synced.itemsIndexed;
    }
    const enrichmentErrors: string[] = [];
    if (plan.toolkit === 'googledrive') {
      const candidates = listConnectedContentCandidates({
        agentId: job.agentId,
        sourceInstanceId: job.sourceInstanceId,
        limit: 5,
      });
      if (candidates.length) {
        const enriched = await readConnectedContent({
          agentId: job.agentId,
          sourceItemIds: candidates.map((candidate) => candidate.sourceItemId),
        });
        enrichmentErrors.push(...enriched.failed.map((failure) => failure.error));
        itemsIndexed += enriched.completed;
      }
    }
    if (listConnectorLearningJobs({ accountId: job.accountId, limit: 100 })
      .find((candidate) => candidate.id === job.id)?.status === 'paused') return;
    publish(updateConnectorLearningJob(job.id, {
      phase: 'indexing',
      itemsDiscovered: itemsSeen,
      itemsIndexed,
    }));
    publish(updateConnectorLearningJob(job.id, { phase: 'deriving' }));
    let semantic: Awaited<ReturnType<typeof deriveConnectedSourceUnderstanding>> = {
      created: 0,
      focusCount: 0,
      status: 'completed',
    };
    try {
      semantic = await deriveConnectedSourceUnderstanding({
        config: options.getConfig(),
        agentId: job.agentId,
        sourceInstanceId: job.sourceInstanceId,
        sourceRunId: sourceRun.id,
        processingPolicy: getUnderstandingSourceGrant(sourceRun.grantId)?.processingPolicy ?? 'local_only',
        memoryManager: options.getMemoryManager(),
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      semantic = { created: 0, focusCount: 0, status: 'failed', error: CONNECTED_SOURCE_ANALYSIS_FAILED };
      log.warn({ err: error, jobId: job.id, connectorId: job.connectorId }, `Connected source semantic analysis failed: ${errorMessage}`);
    }
    const candidatesCreated = semantic.created + semantic.focusCount;
    const incomplete = enrichmentErrors.length > 0 || semantic.status !== 'completed';
    const completed = updateConnectorLearningJob(job.id, {
      status: 'completed',
      phase: 'completed',
      candidatesCreated,
      nextRunAt: null,
      finished: true,
    });
    updateUnderstandingSourceRun(sourceRun.id, {
      status: incomplete ? 'partial' : 'completed',
      itemsSeen,
      cursorAfter: new Date().toISOString(),
      completed: true,
      metadata: {
        ...sourceRun.metadata,
        itemsIndexed,
        candidatesCreated,
        semanticStatus: semantic.status,
        ...(semantic.error ? { semanticError: semantic.error } : {}),
        ...(enrichmentErrors.length ? { enrichmentFailureCount: enrichmentErrors.length } : {}),
      },
    });
    updateUnderstandingSourceGrantCheckpoint(sourceRun.grantId, {
      checkpoint: { cursor: new Date().toISOString(), connectorLearningJobId: job.id },
      lastCollectedAt: Date.now(),
    });
    publish(completed);
    const retention = new ConnectedKnowledgePipeline({
      agentId: job.agentId,
      workspaceId: getWorkspacePath(options.getConfig()),
    }).pruneBoundedRetention(
      job.sourceInstanceId,
      Date.now() - plan.bootstrapWindowDays * 24 * 60 * 60_000,
    );
    if (retention.rawDeleted || retention.derivedDeleted) {
      log.info({ jobId: job.id, sourceInstanceId: job.sourceInstanceId, ...retention }, 'Connected source retention pruned');
    }
    const syncPolicy = getConnectorSyncPolicyForConnection(job.connectionId);
    if (syncPolicy?.scanEnabled === false) return;
    const intervalMinutes = syncPolicy?.intervalMinutes ?? plan.intervalMinutes;
    const nextRunAt = Date.now() + intervalMinutes * 60_000;
    const account = getConnectorAccount(job.accountId);
    enqueueConnection(account?.currentConnectionId ?? job.connectionId, {
      mode: 'incremental',
      reason: 'schedule',
      nextRunAt,
      idempotencyKey: `scheduled:${job.accountId}:${nextRunAt}`,
    });
  }

  async function runNow(): Promise<void> {
    if (running || stopped) return;
    running = true;
    try {
      for (let count = 0; count < 10; count += 1) {
        const job = claimNextConnectorLearningJob();
        if (!job) break;
        try {
          await execute(job);
        } catch (err) {
          const errorMessage = err instanceof Error ? err.message : String(err);
          const exhausted = job.attemptCount >= 5;
          const failed = updateConnectorLearningJob(job.id, {
            status: exhausted ? 'paused' : 'failed',
            error: learningFailureCode(err),
            nextRunAt: exhausted
              ? null
              : Date.now() + Math.min(30 * 60_000, 30_000 * 2 ** Math.min(job.attemptCount, 6)),
            finished: true,
          });
          publish(failed);
          const definition = getConnectorDefinition(job.connectorId);
          if (definition?.runtime.type === 'composio' && definition.runtime.role === 'toolkit') {
            const sourceRun = ensureUnderstandingSourceRun(job, definition.runtime.toolkit, definition.displayName);
            updateUnderstandingSourceRun(sourceRun.id, {
              status: 'failed', errorMessage: learningFailureCode(err), completed: true,
            });
          }
          log.warn({ err, jobId: job.id, connectorId: job.connectorId }, `Connector learning failed: ${errorMessage}`);
        }
      }
    } finally {
      running = false;
    }
  }

  recoverStaleConnectorLearningJobs(Date.now());
  if (learningEnabled(options.getConfig())) {
    for (const connection of activeAccountConnections()) {
      if (listConnectorLearningJobs({ accountId: connection.accountId, limit: 1 }).length === 0) {
        enqueueConnection(connection.id, { reason: 'schedule' });
      }
    }
  }

  timer = setTimeout(() => {
    void runNow();
    timer = setInterval(() => void runNow(), intervalMs);
    timer.unref?.();
  }, Math.max(0, options.initialDelayMs ?? 2_000));
  timer.unref?.();

  return {
    enqueueConnection,
    enqueueToolkit,
    setPaused(connectionId, paused) {
      const accountId = listConnectorConnections().find((connection) => connection.id === connectionId)?.accountId;
      if (!accountId) return 0;
      const changed = setConnectorLearningPaused(accountId, paused);
      if (!paused && changed > 0) queueMicrotask(() => void runNow());
      return changed;
    },
    runNow,
    stop() {
      stopped = true;
      if (timer) {
        clearTimeout(timer);
        clearInterval(timer);
        timer = null;
      }
    },
  };
}
