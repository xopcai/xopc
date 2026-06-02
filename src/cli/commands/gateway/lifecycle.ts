/**
 * Gateway lifecycle orchestration — OpenClaw-aligned service + unmanaged fallback.
 */

import { isRestartEnabled } from '../../../config/commands.flags.js';
import { loadConfig } from '../../../config/index.js';
import { resolveConfigPath } from '../../../config/paths.js';
import { resolveGatewayService } from '../../../daemon/service.js';
import {
  findVerifiedGatewayListenerPidsOnPortSync,
  formatGatewayPidList,
  signalVerifiedGatewayPidSync,
} from '../../../infra/gateway-processes.js';
import { authorizeGatewaySigusr1Restart } from '../../../infra/restart.js';
import {
  DEFAULT_RESTART_HEALTH_ATTEMPTS,
  DEFAULT_RESTART_HEALTH_DELAY_MS,
  renderGatewayPortHealthDiagnostics,
  waitForGatewayHealthyListener,
} from './restart-health.js';
import {
  parsePortFromArgs,
  renderGatewayServiceStartHints,
  resolveGatewayPortFromConfig,
} from './shared.js';
import {
  runServiceRestart,
  runServiceStop,
  type ServiceRecoveryResult,
} from './lifecycle-core.js';

const POST_RESTART_HEALTH_ATTEMPTS = DEFAULT_RESTART_HEALTH_ATTEMPTS;
const POST_RESTART_HEALTH_DELAY_MS = DEFAULT_RESTART_HEALTH_DELAY_MS;

async function resolveGatewayLifecyclePort(service?: Awaited<ReturnType<typeof resolveGatewayService>>): Promise<number> {
  const resolvedService = service ?? (await resolveGatewayService());
  const command = await resolvedService.readCommand(process.env).catch(() => null);
  const portFromArgs = parsePortFromArgs(command?.programArguments);
  return portFromArgs ?? resolveGatewayPortFromConfig();
}

function resolveVerifiedGatewayListenerPids(port: number): number[] {
  return findVerifiedGatewayListenerPidsOnPortSync(port).filter(
    (pid): pid is number => Number.isFinite(pid) && pid > 0,
  );
}

async function assertUnmanagedGatewayRestartEnabled(port: number): Promise<void> {
  const config = loadConfig(resolveConfigPath());
  if (!isRestartEnabled(config)) {
    throw new Error(
      'Gateway restart is disabled in config (commands.restart=false); unmanaged SIGUSR1 restart would be ignored',
    );
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 1000);
    const response = await fetch(`http://127.0.0.1:${port}/api/health`, {
      method: 'GET',
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (!response.ok) {
      return;
    }
  } catch {
    // Best-effort probe; unmanaged restart may still target a starting gateway.
  }
}

async function stopGatewayWithoutServiceManager(port: number): Promise<ServiceRecoveryResult | null> {
  const pids = resolveVerifiedGatewayListenerPids(port);
  if (pids.length === 0) {
    return null;
  }
  for (const pid of pids) {
    signalVerifiedGatewayPidSync(pid, 'SIGTERM');
  }
  return {
    result: 'stopped',
    message: `Gateway stop signal sent to unmanaged process${pids.length === 1 ? '' : 'es'} on port ${port}: ${formatGatewayPidList(pids)}.`,
  };
}

async function restartGatewayWithoutServiceManager(port: number): Promise<ServiceRecoveryResult | null> {
  await assertUnmanagedGatewayRestartEnabled(port);
  const pids = resolveVerifiedGatewayListenerPids(port);
  if (pids.length === 0) {
    return null;
  }
  if (pids.length > 1) {
    throw new Error(
      `multiple gateway processes are listening on port ${port}: ${formatGatewayPidList(pids)}; use "xopc gateway status" before retrying restart`,
    );
  }
  authorizeGatewaySigusr1Restart();
  signalVerifiedGatewayPidSync(pids[0], 'SIGUSR1');
  return {
    result: 'restarted',
    message: `Gateway restart signal sent to unmanaged process on port ${port}: ${pids[0]}.`,
  };
}

export async function runDaemonStop(options: { json?: boolean; disable?: boolean } = {}): Promise<void> {
  const service = await resolveGatewayService();
  let gatewayPortPromise: Promise<number> | undefined;

  await runServiceStop({
    service,
    opts: options,
    onNotLoaded: async () => {
      gatewayPortPromise ??= resolveGatewayLifecyclePort(service);
      return stopGatewayWithoutServiceManager(await gatewayPortPromise);
    },
  });
}

export async function runDaemonRestart(options: {
  json?: boolean;
  wait?: string;
} = {}): Promise<void> {
  const service = await resolveGatewayService();
  let restartedWithoutServiceManager = false;
  const restartPort = await resolveGatewayLifecyclePort(service);
  const restartHealthAttempts = POST_RESTART_HEALTH_ATTEMPTS;
  const restartWaitSeconds = Math.round(
    (restartHealthAttempts * POST_RESTART_HEALTH_DELAY_MS) / 1000,
  );

  await runServiceRestart({
    service,
    opts: options,
    renderStartHints: renderGatewayServiceStartHints,
    checkTokenDrift: true,
    onNotLoaded: async () => {
      const handled = await restartGatewayWithoutServiceManager(restartPort);
      if (handled) {
        restartedWithoutServiceManager = true;
      }
      return handled;
    },
    postRestartCheck: async ({ options: opts, fail }) => {
      if (!restartedWithoutServiceManager) {
        return;
      }
      const health = await waitForGatewayHealthyListener({
        port: restartPort,
        attempts: restartHealthAttempts,
        delayMs: POST_RESTART_HEALTH_DELAY_MS,
      });
      if (health.healthy) {
        return;
      }
      const diagnostics = renderGatewayPortHealthDiagnostics(health);
      fail(
        `Gateway restart timed out after ${restartWaitSeconds}s waiting for health checks.`,
        ['xopc gateway status', 'xopc doctor'],
        diagnostics,
        opts,
      );
    },
  });
}
