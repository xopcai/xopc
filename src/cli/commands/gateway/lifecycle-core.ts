/**
 * Daemon lifecycle core — OpenClaw-aligned service start/stop/restart with onNotLoaded fallback.
 */

import { createLogger } from '../../../utils/logger.js';
import type {
  DaemonLifecycleOptions,
  GatewayService,
} from '../../../daemon/types.js';
import {
  clearGatewayRestartIntentSync,
  writeGatewayRestartIntentSync,
} from '../../../infra/restart.js';

const log = createLogger('DaemonLifecycle');

export type ServiceRecoveryResult = {
  result: 'started' | 'stopped' | 'restarted';
  message?: string;
  warnings?: string[];
  loaded?: boolean;
};

type ServiceRecoveryContext = {
  json: boolean;
  fail: (message: string, hints?: string[], diagnostics?: string[], options?: DaemonLifecycleOptions) => void;
};

type RestartPostCheckContext = {
  options: DaemonLifecycleOptions;
  fail: (message: string, hints?: string[], diagnostics?: string[], options?: DaemonLifecycleOptions) => void;
};

function emitResult(
  options: DaemonLifecycleOptions,
  payload: {
    ok: boolean;
    result?: string;
    message?: string;
    error?: string;
    hints?: string[];
    warnings?: string[];
  },
): void {
  if (options.json) {
    console.log(JSON.stringify(payload, null, 2));
    return;
  }
  if (payload.ok) {
    if (payload.message) {
      console.log(`✅ ${payload.message}`);
    }
    for (const warning of payload.warnings ?? []) {
      console.warn(`⚠️  ${warning}`);
    }
    return;
  }
  if (payload.error) {
    console.error(`❌ ${payload.error}`);
  }
  for (const hint of payload.hints ?? []) {
    console.log(`💡 ${hint}`);
  }
}

function createFail(options: DaemonLifecycleOptions) {
  return (
    message: string,
    hints?: string[],
    diagnostics?: string[],
    opts: DaemonLifecycleOptions = options,
  ) => {
    emitResult(opts, { ok: false, error: message, hints });
    for (const line of diagnostics ?? []) {
      if (!opts.json) {
        console.log(`   ${line}`);
      }
    }
    process.exit(1);
  };
}

async function resolveServiceLoadedOrFail(
  service: GatewayService,
  fail: ServiceRecoveryContext['fail'],
): Promise<boolean | null> {
  try {
    return await service.isLoaded({ env: process.env });
  } catch (err) {
    fail(`Gateway service check failed: ${String(err)}`);
    return null;
  }
}

async function handleServiceNotLoaded(params: {
  service: GatewayService;
  renderStartHints: () => string[];
  options: DaemonLifecycleOptions;
}): Promise<void> {
  emitResult(params.options, {
    ok: true,
    result: 'not-loaded',
    message: `Gateway service ${params.service.notLoadedText}.`,
    hints: params.renderStartHints(),
  });
}

async function checkAndWarnTokenDrift(
  service: GatewayService,
  options: DaemonLifecycleOptions,
): Promise<string[]> {
  const warnings: string[] = [];
  try {
    const command = await service.readCommand(process.env);
    const serviceToken = command?.environment?.XOPC_GATEWAY_TOKEN;
    if (!serviceToken) {
      return warnings;
    }
    const { loadConfig } = await import('../../../config/index.js');
    const { resolveConfigPath } = await import('../../../config/paths.js');
    const config = loadConfig(resolveConfigPath());
    const configToken = config?.gateway?.auth?.token;
    if (configToken && serviceToken !== configToken) {
      const warning =
        'Token drift detected: service token differs from config. Run `xopc gateway service install --force` to sync.';
      warnings.push(warning);
      if (!options.json) {
        console.warn(`⚠️  ${warning}`);
      }
    }
  } catch {
    // Best-effort
  }
  return warnings;
}

export async function runServiceStop(params: {
  service: GatewayService;
  opts?: DaemonLifecycleOptions;
  onNotLoaded?: (ctx: ServiceRecoveryContext) => Promise<ServiceRecoveryResult | null>;
}): Promise<void> {
  const options = params.opts ?? {};
  const fail = createFail(options);
  const loaded = await resolveServiceLoadedOrFail(params.service, fail);
  if (loaded === null) {
    return;
  }

  if (!loaded) {
    try {
      const handled = await params.onNotLoaded?.({ json: Boolean(options.json), fail });
      if (handled) {
        emitResult(options, {
          ok: true,
          result: handled.result,
          message: handled.message,
          warnings: handled.warnings,
        });
        return;
      }
    } catch (err) {
      fail(`Gateway stop failed: ${String(err)}`);
      return;
    }
    await handleServiceNotLoaded({
      service: params.service,
      renderStartHints: () => ['xopc gateway service install', 'xopc gateway'],
      options,
    });
    return;
  }

  try {
    await params.service.stop({ env: process.env, disable: options.disable });
    emitResult(options, {
      ok: true,
      result: 'stopped',
      message: options.disable
        ? 'Gateway stopped and disabled (will not respawn).'
        : 'Gateway stop signal sent.',
    });
  } catch (err) {
    log.error({ err }, 'Failed to stop gateway');
    fail(`Gateway stop failed: ${String(err)}`);
  }
}

export async function runServiceRestart(params: {
  service: GatewayService;
  opts?: DaemonLifecycleOptions;
  renderStartHints: () => string[];
  checkTokenDrift?: boolean;
  onNotLoaded?: (ctx: ServiceRecoveryContext) => Promise<ServiceRecoveryResult | null>;
  postRestartCheck?: (ctx: RestartPostCheckContext) => Promise<void>;
}): Promise<void> {
  const options = params.opts ?? {};
  const fail = createFail(options);
  const warnings: string[] = [];
  let handledRecovery: ServiceRecoveryResult | null = null;

  const loaded = await resolveServiceLoadedOrFail(params.service, fail);
  if (loaded === null) {
    return;
  }

  if (!loaded) {
    try {
      handledRecovery = (await params.onNotLoaded?.({ json: Boolean(options.json), fail })) ?? null;
    } catch (err) {
      fail(`Gateway restart failed: ${String(err)}`);
      return;
    }
    if (!handledRecovery) {
      await handleServiceNotLoaded({
        service: params.service,
        renderStartHints: params.renderStartHints,
        options,
      });
      return;
    }
    if (handledRecovery.warnings?.length) {
      warnings.push(...handledRecovery.warnings);
    }
  }

  if (loaded && params.checkTokenDrift) {
    warnings.push(...(await checkAndWarnTokenDrift(params.service, options)));
  }

  try {
    if (loaded) {
      let wroteRestartIntent = false;
      const runtime = await params.service.readRuntime(process.env).catch(() => null);
      wroteRestartIntent = writeGatewayRestartIntentSync({ targetPid: runtime?.pid });
      try {
        await params.service.restart({ env: process.env });
      } catch (err) {
        if (wroteRestartIntent) {
          clearGatewayRestartIntentSync();
        }
        throw err;
      }
    }

    if (params.postRestartCheck) {
      await params.postRestartCheck({ options, fail });
    }

    if (options.wait) {
      const timeoutMs = parseWaitTimeout(options.wait);
      const { loadConfig } = await import('../../../config/index.js');
      const { resolveConfigPath } = await import('../../../config/paths.js');
      const config = loadConfig(resolveConfigPath());
      const port = typeof config.gateway?.port === 'number' ? config.gateway.port : 18790;
      const { waitForRestartHealth } = await import('./restart-health.js');
      const snapshot = await waitForRestartHealth({
        service: params.service,
        port,
        timeoutMs,
        onProgress: () => {
          if (!options.json) {
            process.stdout.write('.');
          }
        },
      });
      if (!options.json) {
        process.stdout.write('\n');
      }
      if (!snapshot.healthy) {
        fail(`Restart health check failed: ${snapshot.waitOutcome ?? 'timeout'}`, [
          'xopc gateway logs',
        ]);
        return;
      }
      emitResult(options, {
        ok: true,
        result: 'healthy',
        message: `Gateway restarted and healthy (pid ${snapshot.runtime?.pid ?? 'unknown'}, ${snapshot.elapsedMs ?? 0}ms).`,
        warnings: warnings.length ? warnings : undefined,
      });
      return;
    }

    emitResult(options, {
      ok: true,
      result: 'restarted',
      message: handledRecovery?.message ?? 'Gateway restart completed.',
      warnings: warnings.length ? warnings : undefined,
    });
  } catch (err) {
    log.error({ err }, 'Failed to restart gateway');
    fail(`Gateway restart failed: ${String(err)}`, params.renderStartHints());
  } finally {
    clearGatewayRestartIntentSync();
  }
}

export async function executeDaemonUninstall(options: DaemonLifecycleOptions = {}): Promise<void> {
  const { resolveGatewayService, isDaemonAvailableAsync } = await import('../../../daemon/service.js');
  const available = await isDaemonAvailableAsync();
  if (!available) {
    emitResult(options, { ok: false, error: 'Daemon service not available on this platform' });
    process.exit(1);
  }
  const service = await resolveGatewayService();
  const loaded = await service.isLoaded({ env: process.env }).catch(() => false);
  if (loaded) {
    try {
      await service.stop({ env: process.env });
    } catch {
      // Best-effort
    }
  }
  try {
    await service.uninstall({ env: process.env });
    emitResult(options, { ok: true, result: 'uninstalled', message: 'Gateway service uninstalled.' });
  } catch (err) {
    log.error({ err }, 'Failed to uninstall gateway service');
    emitResult(options, { ok: false, error: `Failed to uninstall: ${String(err)}` });
    process.exit(1);
  }
}

function parseWaitTimeout(wait: string): number {
  const match = wait.match(/^(\d+)(s|m|ms)?$/);
  if (!match) return 60_000;
  const value = parseInt(match[1], 10);
  const unit = match[2] || 's';
  switch (unit) {
    case 'ms':
      return value;
    case 'm':
      return value * 60_000;
    case 's':
    default:
      return value * 1000;
  }
}
