import type { Config } from '../config/schema.js';
import { createLogger } from '../utils/logger.js';
import { testConnectorInstance } from './health.js';
import { listConnectorInstances } from './instances.js';
import { recordConnectorHealthUsage } from './usage.js';

const log = createLogger('Connectors:Supervisor');

export type ConnectorSupervisorOptions = {
  getConfig: () => Config;
  saveConfig: (config: Config) => Promise<{ saved: boolean; error?: string }>;
  intervalMs?: number;
  initialDelayMs?: number;
};

export type ConnectorSupervisor = {
  runNow(): Promise<void>;
  stop(): void;
};

function resolveIntervalMs(input?: number): number {
  const env = Number(process.env.XOPC_CONNECTOR_SUPERVISOR_INTERVAL_MS ?? '');
  const value = input ?? (Number.isFinite(env) && env > 0 ? env : 60_000);
  return Math.max(10_000, Math.min(value, 30 * 60_000));
}

export function startConnectorSupervisor(options: ConnectorSupervisorOptions): ConnectorSupervisor {
  const intervalMs = resolveIntervalMs(options.intervalMs);
  let timer: NodeJS.Timeout | null = null;
  let running = false;
  let stopped = false;

  async function runNow(): Promise<void> {
    if (running || stopped) return;
    running = true;
    const config = options.getConfig();
    let changed = false;
    try {
      const instances = listConnectorInstances(config).filter((instance) => instance.enabled);
      for (const instance of instances) {
        if (instance.materialized.type !== 'mcp') continue;
        try {
          const result = await testConnectorInstance(config, instance.materialized.serverId);
          recordConnectorHealthUsage(config, instance.instanceId, result);
          changed = true;
          if (!result.ok) {
            log.warn(
              { instanceId: instance.instanceId, status: result.status, errorMessage: result.error },
              `Connector health check failed: ${result.status}`,
            );
          }
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          log.warn({ instanceId: instance.instanceId, errorMessage }, `Connector supervisor check failed: ${errorMessage}`);
        }
      }
      if (changed) {
        const saved = await options.saveConfig(config);
        if (!saved.saved) {
          log.warn({ errorMessage: saved.error }, `Connector supervisor could not save health state: ${saved.error}`);
        }
      }
    } finally {
      running = false;
    }
  }

  const initialDelayMs = options.initialDelayMs ?? 15_000;
  timer = setTimeout(() => {
    void runNow();
    timer = setInterval(() => void runNow(), intervalMs);
  }, Math.max(0, initialDelayMs));
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
