import { monitorEventLoopDelay, performance } from 'node:perf_hooks';

import { createLogger } from '../utils/logger.js';

const log = createLogger('GatewayStartup');

function isTruthyEnvValue(value: string | undefined): boolean {
  const normalized = value?.trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on';
}

export function isGatewayStartupTraceEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return isTruthyEnvValue(env.XOPC_GATEWAY_STARTUP_TRACE);
}

export type GatewayStartupTrace = {
  mark: (name: string) => void;
  detail: (name: string, metrics: ReadonlyArray<readonly [string, number | string]>) => void;
  measure: <T>(name: string, run: () => Promise<T> | T) => Promise<T>;
};

export function createGatewayStartupTrace(
  enabled: boolean = isGatewayStartupTraceEnabled(),
): GatewayStartupTrace {
  const eventLoopDelay = enabled ? monitorEventLoopDelay({ resolution: 10 }) : undefined;
  eventLoopDelay?.enable();
  const started = performance.now();
  let last = started;

  const formatMetric = (key: string, value: number | string) =>
    `${key}=${typeof value === 'number' ? value.toFixed(1) : value}`;

  const readEventLoopMaxMs = () => {
    if (!eventLoopDelay) {
      return 0;
    }
    const maxMs = eventLoopDelay.max / 1_000_000;
    eventLoopDelay.reset();
    return maxMs;
  };

  const emit = (
    name: string,
    durationMs: number,
    totalMs: number,
    extras: ReadonlyArray<readonly [string, number | string]> = [],
  ) => {
    if (!enabled) {
      return;
    }
    const metrics = [
      `eventLoopMax=${readEventLoopMaxMs().toFixed(1)}ms`,
      ...extras.map(([key, value]) => formatMetric(key, value)),
    ].join(' ');
    log.info(`startup trace: ${name} ${durationMs.toFixed(1)}ms total=${totalMs.toFixed(1)}ms ${metrics}`);
  };

  return {
    mark(name: string) {
      const now = performance.now();
      emit(name, now - last, now - started);
      last = now;
      if (name === 'ready') {
        eventLoopDelay?.disable();
      }
    },
    detail(name: string, metrics: ReadonlyArray<readonly [string, number | string]>) {
      if (!enabled) {
        return;
      }
      log.info(
        `startup trace: ${name} ${metrics.map(([key, value]) => formatMetric(key, value)).join(' ')}`,
      );
    },
    async measure<T>(name: string, run: () => Promise<T> | T): Promise<T> {
      const before = performance.now();
      try {
        return await run();
      } finally {
        const now = performance.now();
        emit(name, now - before, now - started);
        last = now;
      }
    },
  };
}
