import type { Config } from '../config/schema.js';
import type { MemoryManager } from '../agent/memory/manager.js';
import {
  claimNextConnectorLearningJob,
  enqueueConnectorLearningJob,
  listConnectorConnections,
  listConnectorLearningJobs,
  pruneBoundedKnowledgeSourceItems,
  recoverStaleConnectorLearningJobs,
  setConnectorLearningPaused,
  updateConnectorLearningJob,
  type ConnectorLearningJob,
} from '../storage/sqlite/index.js';
import { ConnectedUnderstandingPipeline } from '../knowledge/index.js';
import { createLogger } from '../utils/logger.js';
import { getConnectorDefinition } from './catalog.js';
import { ingestComposioConnectedSource } from './connected-source-ingestion.js';
import { buildConnectorLearningArguments, getConnectorLearningRecipe } from './learning-recipes.js';

const log = createLogger('ConnectorLearning');
const CONNECTED_ACCOUNT_UNAVAILABLE = 'connected_account_unavailable';
const CONNECTED_SOURCE_SYNC_FAILED = 'connected_source_sync_failed';

function learningFailureCode(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes('ToolRouterV2_InvalidConnectedAccountIds')
    || message.includes('Could not find connected account(s)')
    || message.includes('missing its provider identity')
    ? CONNECTED_ACCOUNT_UNAVAILABLE
    : CONNECTED_SOURCE_SYNC_FAILED;
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
    && config.userContext.understanding.enabled
    && config.userContext.memory.mode !== 'off'
    && config.userContext.memory.sources.includes('connectedSources');
}

export function startConnectorLearningCoordinator(options: {
  getConfig: () => Config;
  resolveAgentId: () => string;
  getMemoryManager: () => MemoryManager;
  emit?: (type: string, payload: unknown) => void;
  intervalMs?: number;
  initialDelayMs?: number;
}): ConnectorLearningCoordinator {
  const intervalMs = Math.max(2_000, Math.min(options.intervalMs ?? 10_000, 60_000));
  let timer: NodeJS.Timeout | null = null;
  let running = false;
  let stopped = false;

  const publish = (job: ConnectorLearningJob) => options.emit?.('connector.learning.updated', job);

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
    const definition = getConnectorDefinition(connection.connectorId);
    if (definition?.runtime.type !== 'composio' || definition.runtime.role !== 'toolkit') return null;
    if (!getConnectorLearningRecipe(definition.runtime.toolkit)) return null;
    const sourceInstanceId = `composio:${connection.connectorId}:${connection.id}`;
    const existing = listConnectorLearningJobs({ connectionId: connection.id, limit: 1 });
    const mode = request.mode ?? (existing.length === 0 ? 'bootstrap' : 'incremental');
    const bucket = Math.floor(Date.now() / 60_000);
    const job = enqueueConnectorLearningJob({
      connectorId: connection.connectorId,
      connectionId: connection.id,
      sourceInstanceId,
      agentId: options.resolveAgentId(),
      mode,
      idempotencyKey: request.idempotencyKey
        ?? (mode === 'bootstrap'
          ? `bootstrap:${connection.id}:v1`
          : `incremental:${connection.id}:${request.reason ?? 'manual'}:${bucket}`),
      nextRunAt: request.nextRunAt,
    });
    publish(job);
    queueMicrotask(() => void runNow());
    return job;
  }

  function enqueueToolkit(toolkit: string): ConnectorLearningJob[] {
    const normalized = toolkit.trim().toLowerCase();
    return listConnectorConnections()
      .filter((connection) => connection.status === 'active')
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
    const recipe = getConnectorLearningRecipe(definition.runtime.toolkit);
    if (!recipe) throw new Error(`Connector learning has no recipe for ${definition.runtime.toolkit}.`);
    const synced = await ingestComposioConnectedSource({
      config: options.getConfig(),
      connectorId: job.connectorId,
      connectionId: job.connectionId,
      actionId: recipe.actionId,
      arguments: recipe.arguments,
      buildArguments: (pull) => buildConnectorLearningArguments(recipe, pull),
      agentId: job.agentId,
    });
    if (listConnectorLearningJobs({ connectionId: job.connectionId, limit: 100 })
      .find((candidate) => candidate.id === job.id)?.status === 'paused') return;
    publish(updateConnectorLearningJob(job.id, {
      phase: 'indexing',
      itemsDiscovered: synced.itemsSeen,
      itemsIndexed: synced.itemsIndexed,
    }));
    publish(updateConnectorLearningJob(job.id, { phase: 'deriving' }));
    const understanding = await new ConnectedUnderstandingPipeline(options.getMemoryManager())
      .process(job.sourceInstanceId, job.connectorId, job.agentId);
    const completed = updateConnectorLearningJob(job.id, {
      status: 'completed',
      phase: 'completed',
      candidatesCreated: understanding.created,
      nextRunAt: null,
      finished: true,
    });
    publish(completed);
    pruneBoundedKnowledgeSourceItems(
      job.sourceInstanceId,
      Date.now() - recipe.bootstrapWindowDays * 24 * 60 * 60_000,
    );
    const nextRunAt = Date.now() + recipe.intervalMinutes * 60_000;
    enqueueConnection(job.connectionId, {
      mode: 'incremental',
      reason: 'schedule',
      nextRunAt,
      idempotencyKey: `scheduled:${job.connectionId}:${nextRunAt}`,
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
          log.warn({ err, jobId: job.id, connectorId: job.connectorId }, `Connector learning failed: ${errorMessage}`);
        }
      }
    } finally {
      running = false;
    }
  }

  recoverStaleConnectorLearningJobs(Date.now());
  if (learningEnabled(options.getConfig())) {
    for (const connection of listConnectorConnections().filter((item) => item.status === 'active')) {
      if (listConnectorLearningJobs({ connectionId: connection.id, limit: 1 }).length === 0) {
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
      const changed = setConnectorLearningPaused(connectionId, paused);
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
