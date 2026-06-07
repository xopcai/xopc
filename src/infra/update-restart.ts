/**
 * Gateway restart after xopc update — daemon, unmanaged, or in-process respawn.
 */

import { loadConfig } from '../config/loader.js';
import { resolveConfigPath } from '../config/paths.js';
import { isRestartEnabled } from '../config/commands.flags.js';
import { resolveGatewayService } from '../daemon/service.js';
import type { GatewayService } from '../daemon/types.js';
import {
  findVerifiedGatewayListenerPidsOnPortSync,
  signalVerifiedGatewayPidSync,
} from './gateway-processes.js';
import { authorizeGatewaySigusr1Restart, writeGatewayRestartIntentSync } from './restart.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('UpdateRestart');

const DEFAULT_HEALTH_ATTEMPTS = 120;
const DEFAULT_HEALTH_DELAY_MS = 500;

export type UpdateRestartResult = {
  ok: boolean;
  mode: 'in-process' | 'daemon' | 'unmanaged' | 'skipped' | 'disabled' | 'failed';
  message?: string;
};

export type InProcessRestartTrigger = () => { ok: boolean; mode?: string; message?: string };

export function isRunningInsideGatewayService(
  env: Record<string, string | undefined> = process.env,
): boolean {
  return env.XOPC_SERVICE_MARKER?.trim() === '1';
}

function resolveGatewayPort(configPath?: string): number {
  const config = loadConfig(configPath ?? resolveConfigPath());
  return typeof config.gateway?.port === 'number' ? config.gateway.port : 18790;
}

function parsePortFromArgs(programArguments: string[] | undefined): number | null {
  if (!programArguments?.length) {
    return null;
  }
  for (let i = 0; i < programArguments.length; i += 1) {
    const arg = programArguments[i];
    if (arg === '--port') {
      const parsed = parseInt(String(programArguments[i + 1]), 10);
      if (Number.isFinite(parsed) && parsed > 0) {
        return parsed;
      }
    }
    if (arg?.startsWith('--port=')) {
      const parsed = parseInt(arg.split('=', 2)[1] ?? '', 10);
      if (Number.isFinite(parsed) && parsed > 0) {
        return parsed;
      }
    }
  }
  return null;
}

async function resolveRestartPort(service: GatewayService): Promise<number> {
  const command = await service.readCommand(process.env).catch(() => null);
  return parsePortFromArgs(command?.programArguments) ?? resolveGatewayPort();
}

async function waitForGatewayHealth(port: number, expectedVersion?: string): Promise<boolean> {
  for (let attempt = 0; attempt < DEFAULT_HEALTH_ATTEMPTS; attempt += 1) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 1500);
      const response = await fetch(`http://127.0.0.1:${port}/api/health`, {
        method: 'GET',
        signal: controller.signal,
      });
      clearTimeout(timeout);
      if (!response.ok) {
        await new Promise((r) => setTimeout(r, DEFAULT_HEALTH_DELAY_MS));
        continue;
      }
      if (expectedVersion) {
        const body = (await response.json()) as { version?: string };
        if (body.version && body.version !== expectedVersion) {
          await new Promise((r) => setTimeout(r, DEFAULT_HEALTH_DELAY_MS));
          continue;
        }
      }
      return true;
    } catch {
      await new Promise((r) => setTimeout(r, DEFAULT_HEALTH_DELAY_MS));
    }
  }
  return false;
}

async function restartUnmanagedGateway(port: number, configPath?: string): Promise<UpdateRestartResult> {
  const config = loadConfig(configPath ?? resolveConfigPath());
  if (!isRestartEnabled(config)) {
    return {
      ok: false,
      mode: 'disabled',
      message:
        'Gateway restart is disabled in config (commands.restart=false). Restart manually: xopc gateway restart',
    };
  }

  const pids = findVerifiedGatewayListenerPidsOnPortSync(port).filter(
    (pid): pid is number => Number.isFinite(pid) && pid > 0,
  );
  if (pids.length === 0) {
    return {
      ok: false,
      mode: 'failed',
      message: `No gateway listener found on port ${port}.`,
    };
  }
  if (pids.length > 1) {
    return {
      ok: false,
      mode: 'failed',
      message: `Multiple gateway processes on port ${port}; use "xopc gateway status" before retrying.`,
    };
  }

  const targetPid = pids[0];
  if (process.platform === 'win32') {
    writeGatewayRestartIntentSync({ targetPid });
    signalVerifiedGatewayPidSync(targetPid, 'SIGTERM');
  } else {
    authorizeGatewaySigusr1Restart();
    signalVerifiedGatewayPidSync(targetPid, 'SIGUSR1');
  }

  return {
    ok: true,
    mode: 'unmanaged',
    message: `Gateway restart signal sent to process ${targetPid} on port ${port}.`,
  };
}

async function restartDaemonGateway(
  service: GatewayService,
  port: number,
  expectedVersion?: string,
): Promise<UpdateRestartResult> {
  try {
    const loaded = await service.isLoaded({ env: process.env });
    if (!loaded) {
      return restartUnmanagedGateway(port);
    }
    await service.restart({ env: process.env, stdout: process.stdout });
    const healthy = await waitForGatewayHealth(port, expectedVersion);
    if (!healthy) {
      log.warn({ port, expectedVersion }, 'Gateway restart completed but health check timed out');
      return {
        ok: true,
        mode: 'daemon',
        message: 'Gateway service restarted; health check timed out (gateway may still be starting).',
      };
    }
    return {
      ok: true,
      mode: 'daemon',
      message: 'Gateway service restarted successfully.',
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.warn({ err, port }, `Daemon restart failed: ${message}`);
    return { ok: false, mode: 'failed', message };
  }
}

export async function maybeRestartGatewayAfterUpdate(params: {
  shouldRestart?: boolean;
  expectedVersion?: string;
  configPath?: string;
  triggerInProcessRestart?: InProcessRestartTrigger;
}): Promise<UpdateRestartResult> {
  if (params.shouldRestart === false) {
    return { ok: true, mode: 'skipped', message: 'Restart skipped (--no-restart).' };
  }

  const config = loadConfig(params.configPath ?? resolveConfigPath());
  if (!isRestartEnabled(config)) {
    return {
      ok: false,
      mode: 'disabled',
      message:
        'Gateway restart is disabled (commands.restart=false). Restart manually: xopc gateway restart',
    };
  }

  if (isRunningInsideGatewayService() && params.triggerInProcessRestart) {
    const result = params.triggerInProcessRestart();
    if (!result.ok) {
      return {
        ok: false,
        mode: 'failed',
        message: result.message ?? 'In-process gateway restart failed.',
      };
    }
    log.info({ mode: result.mode }, 'Scheduled in-process gateway restart after update');
    return {
      ok: true,
      mode: 'in-process',
      message: result.message ?? 'Gateway restart scheduled.',
    };
  }

  const service = await resolveGatewayService();
  const port = await resolveRestartPort(service);
  return restartDaemonGateway(service, port, params.expectedVersion);
}
