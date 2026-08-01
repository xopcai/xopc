import type { Config } from '../config/schema.js';
import { listConnectorConnections, listKnowledgeSyncRuns } from '../storage/sqlite/index.js';
import { createLogger } from '../utils/logger.js';
import { getConnectorDefinition } from './catalog.js';
import { syncComposioResultToMemory, syncLocalFolderToMemory } from './connector-memory-sync.js';
import { listConnectorInstances } from './instances.js';
import { getComposioMemorySyncProfile } from './memory-sync-profile.js';

const log = createLogger('ConnectorMemorySync');
const DEFAULT_SYNC_INTERVAL_MINUTES = 15;

export type ConnectorMemorySyncCoordinator = {
  runNow(options?: { toolkit?: string; force?: boolean }): Promise<void>;
  stop(): void;
};

export async function syncDueMemorySources(options: {
  config: Config;
  agentId: string;
  nowMs?: number;
  toolkit?: string;
  force?: boolean;
  syncLocalSource?: typeof syncLocalFolderToMemory;
  syncComposioSource?: typeof syncComposioResultToMemory;
}): Promise<{ eligible: number; synced: number; failed: number }> {
  const nowMs = options.nowMs ?? Date.now();
  const syncLocalSource = options.syncLocalSource ?? syncLocalFolderToMemory;
  const syncComposioSource = options.syncComposioSource ?? syncComposioResultToMemory;
  let eligible = 0;
  let synced = 0;
  let failed = 0;

  for (const instance of listConnectorInstances(options.config)) {
    if (!instance.enabled) continue;
    const definition = getConnectorDefinition(instance.connectorId);
    if (definition?.runtime.type === 'memorySource' && definition.runtime.sourceKind === 'local-folder') {
      if (options.toolkit || instance.config?.autoSync === false) continue;
      eligible += 1;
      const configuredMinutes = Number(instance.config?.syncIntervalMinutes ?? DEFAULT_SYNC_INTERVAL_MINUTES);
      const intervalMinutes = Number.isFinite(configuredMinutes)
        ? Math.max(5, Math.min(configuredMinutes, 24 * 60))
        : DEFAULT_SYNC_INTERVAL_MINUTES;
      const sourceInstanceId = `local-folder:${definition.id}`;
      const latestRun = listKnowledgeSyncRuns({ sourceInstanceId, limit: 1 })[0];
      if (!options.force && latestRun && nowMs - Date.parse(latestRun.startedAt) < intervalMinutes * 60_000) continue;
      try {
        await syncLocalSource({ config: options.config, connectorId: definition.id, agentId: options.agentId });
        synced += 1;
      } catch (err) {
        failed += 1;
        const errorMessage = err instanceof Error ? err.message : String(err);
        log.warn(
          { err, connectorId: definition.id, sourceInstanceId },
          `Automatic connector memory sync failed: ${errorMessage}`,
        );
      }
      continue;
    }
    if (definition?.runtime.type !== 'composio' || definition.runtime.role !== 'toolkit') continue;
    if (options.toolkit && definition.runtime.toolkit !== options.toolkit) continue;
    const profile = getComposioMemorySyncProfile(options.config, definition.id);
    if (!profile?.enabled || (options.force && options.toolkit && !profile.triggerSync)) continue;
    eligible += 1;
    const activeConnections = listConnectorConnections({ connectorId: definition.id })
      .filter((candidate) => candidate.status === 'active');
    const connection = profile.connectionId
      ? activeConnections.find((candidate) => candidate.id === profile.connectionId)
      : activeConnections.find((candidate) => candidate.isDefault) ?? activeConnections[0];
    if (!connection) continue;
    const sourceInstanceId = `composio:${definition.id}:${connection.id}`;
    const latestRun = listKnowledgeSyncRuns({ sourceInstanceId, limit: 1 })[0];
    if (!options.force && latestRun && nowMs - Date.parse(latestRun.startedAt) < profile.intervalMinutes * 60_000) continue;
    try {
      await syncComposioSource({
        config: options.config,
        connectorId: definition.id,
        actionId: profile.actionId,
        arguments: profile.arguments,
        agentId: profile.agentId,
        connectionId: connection.id,
      });
      synced += 1;
    } catch (err) {
      failed += 1;
      const errorMessage = err instanceof Error ? err.message : String(err);
      log.warn(
        { err, connectorId: definition.id, sourceInstanceId },
        `Automatic Composio memory sync failed: ${errorMessage}`,
      );
    }
  }
  return { eligible, synced, failed };
}

export function startConnectorMemorySyncCoordinator(options: {
  getConfig: () => Config;
  resolveAgentId: () => string;
  intervalMs?: number;
  initialDelayMs?: number;
}): ConnectorMemorySyncCoordinator {
  const intervalMs = Math.max(10_000, Math.min(options.intervalMs ?? 60_000, 30 * 60_000));
  let timer: NodeJS.Timeout | null = null;
  let running = false;
  let stopped = false;
  let pendingAll = false;
  let pendingForce = false;
  const pendingToolkits = new Set<string>();

  async function runNow(runOptions?: { toolkit?: string; force?: boolean }): Promise<void> {
    if (stopped) return;
    if (running) {
      if (runOptions?.toolkit) pendingToolkits.add(runOptions.toolkit);
      else pendingAll = true;
      pendingForce ||= runOptions?.force === true;
      return;
    }
    running = true;
    try {
      const result = await syncDueMemorySources({
        config: options.getConfig(),
        agentId: options.resolveAgentId(),
        toolkit: runOptions?.toolkit,
        force: runOptions?.force,
      });
      if (result.synced > 0 || result.failed > 0) {
        log.info(result, 'Automatic connector memory sync cycle completed');
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      log.warn({ err }, `Automatic connector memory sync cycle failed: ${errorMessage}`);
    } finally {
      running = false;
      if (!stopped && (pendingAll || pendingToolkits.size > 0)) {
        const runAll = pendingAll;
        const force = pendingForce;
        const toolkits = [...pendingToolkits];
        pendingAll = false;
        pendingForce = false;
        pendingToolkits.clear();
        queueMicrotask(() => {
          if (runAll) void runNow({ force });
          else void toolkits.reduce(
            async (previous, toolkit) => {
              await previous;
              await runNow({ toolkit, force });
            },
            Promise.resolve(),
          );
        });
      }
    }
  }

  timer = setTimeout(() => {
    void runNow();
    timer = setInterval(() => void runNow(), intervalMs);
    timer.unref?.();
  }, Math.max(0, options.initialDelayMs ?? 10_000));
  timer.unref?.();

  return {
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
