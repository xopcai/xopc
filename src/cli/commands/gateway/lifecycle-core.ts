/**
 * Daemon Lifecycle Core - Unified start/stop/restart/uninstall logic
 *
 * Entry point for all daemon lifecycle operations. Handles:
 * - Service resolution and availability checks
 * - Token drift detection
 * - Restart intent writing
 * - Health wait coordination
 * - JSON output mode
 */

import { createLogger } from '../../../utils/logger.js';
import type {
  DaemonLifecycleOptions,
  GatewayServiceRestartResult,
} from '../../../daemon/types.js';

const log = createLogger('DaemonLifecycle');

// ─── Stop ───

export async function executeDaemonStop(options: DaemonLifecycleOptions): Promise<void> {
  const { resolveGatewayService, isDaemonAvailableAsync } = await import(
    '../../../daemon/service.js'
  );

  const available = await isDaemonAvailableAsync();
  if (!available) {
    outputResult(options, { ok: false, error: 'Daemon service not available on this platform' });
    process.exit(1);
  }

  const service = await resolveGatewayService();
  const loaded = await service.isLoaded({ env: process.env });

  if (!loaded) {
    outputResult(options, {
      ok: true,
      result: 'not-running',
      message: `Gateway service ${service.notLoadedText}. Nothing to stop.`,
    });
    return;
  }

  try {
    await service.stop({ env: process.env, disable: options.disable });
    outputResult(options, {
      ok: true,
      result: 'stopped',
      message: options.disable
        ? 'Gateway stopped and disabled (will not respawn).'
        : 'Gateway stop signal sent.',
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error({ err }, 'Failed to stop gateway');
    outputResult(options, { ok: false, error: `Failed to stop: ${message}` });
    process.exit(1);
  }
}

// ─── Restart ───

export async function executeDaemonRestart(options: DaemonLifecycleOptions): Promise<void> {
  const { resolveGatewayService, isDaemonAvailableAsync } = await import(
    '../../../daemon/service.js'
  );

  const available = await isDaemonAvailableAsync();
  if (!available) {
    outputResult(options, { ok: false, error: 'Daemon service not available on this platform' });
    process.exit(1);
  }

  const service = await resolveGatewayService();
  const loaded = await service.isLoaded({ env: process.env });

  if (!loaded) {
    outputResult(options, {
      ok: false,
      error: `Gateway service ${service.notLoadedText}. Install first with: xopc gateway service install`,
      hints: ['xopc gateway service install'],
    });
    process.exit(1);
  }

  // Token drift check
  await checkAndWarnTokenDrift(service, options);

  // Write restart intent
  const { writeGatewayRestartIntentSync } = await import('../../../infra/restart-intent.js');
  writeGatewayRestartIntentSync({ force: options.force });

  try {
    const result: GatewayServiceRestartResult = await service.restart({ env: process.env });

    // If --wait specified, wait for health
    if (options.wait) {
      const timeoutMs = parseWaitTimeout(options.wait);
      await waitForHealthAfterRestart(service, timeoutMs, options);
    } else {
      outputResult(options, {
        ok: true,
        result: result.outcome,
        message: `Gateway restart ${result.outcome}.`,
      });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error({ err }, 'Failed to restart gateway');
    outputResult(options, { ok: false, error: `Failed to restart: ${message}` });
    process.exit(1);
  } finally {
    // Clean up intent
    const { clearGatewayRestartIntentSync } = await import('../../../infra/restart-intent.js');
    clearGatewayRestartIntentSync();
  }
}

// ─── Uninstall ───

export async function executeDaemonUninstall(options: DaemonLifecycleOptions): Promise<void> {
  const { resolveGatewayService, isDaemonAvailableAsync } = await import(
    '../../../daemon/service.js'
  );

  const available = await isDaemonAvailableAsync();
  if (!available) {
    outputResult(options, { ok: false, error: 'Daemon service not available on this platform' });
    process.exit(1);
  }

  const service = await resolveGatewayService();

  try {
    await service.uninstall({ env: process.env });
    outputResult(options, {
      ok: true,
      result: 'uninstalled',
      message: 'Gateway service uninstalled.',
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error({ err }, 'Failed to uninstall gateway service');
    outputResult(options, { ok: false, error: `Failed to uninstall: ${message}` });
    process.exit(1);
  }
}

// ─── Token Drift Check ───

async function checkAndWarnTokenDrift(
  service: { readCommand: (env?: Record<string, string | undefined>) => Promise<{ environment?: Record<string, string> } | null> },
  options: DaemonLifecycleOptions,
): Promise<void> {
  try {
    const command = await service.readCommand(process.env);
    if (!command?.environment?.XOPC_GATEWAY_TOKEN) return;

    const { loadConfig } = await import('../../../config/index.js');
    const { resolveConfigPath } = await import('../../../config/paths.js');
    const config = loadConfig(resolveConfigPath());
    const configToken = config?.gateway?.auth?.token;

    if (configToken && command.environment.XOPC_GATEWAY_TOKEN !== configToken) {
      const warning =
        'Token drift detected: service token differs from config. ' +
        'Run `xopc gateway service install --force` to sync.';

      if (options.json) {
        // Will be included in output
      } else {
        console.warn(`⚠️  ${warning}`);
      }
    }
  } catch {
    // Best-effort; don't block restart on drift check failure
  }
}

// ─── Health Wait ───

async function waitForHealthAfterRestart(
  service: { readRuntime: (env?: Record<string, string | undefined>) => Promise<{ status: string; pid?: number }> },
  timeoutMs: number,
  options: DaemonLifecycleOptions,
): Promise<void> {
  const { loadConfig } = await import('../../../config/index.js');
  const { resolveConfigPath } = await import('../../../config/paths.js');
  const config = loadConfig(resolveConfigPath());
  const port = config?.gateway?.port ?? 18790;

  try {
    const { waitForRestartHealth } = await import('./restart-health.js');
    const snapshot = await waitForRestartHealth({
      service: service as any,
      port,
      timeoutMs,
      onProgress: (_snap) => {
        if (!options.json) {
          process.stdout.write('.');
        }
      },
    });

    if (!options.json) {
      process.stdout.write('\n');
    }

    if (snapshot.healthy) {
      outputResult(options, {
        ok: true,
        result: 'healthy',
        message: `Gateway restarted and healthy (pid ${snapshot.runtime?.pid ?? 'unknown'}, ${snapshot.elapsedMs}ms).`,
      });
    } else {
      outputResult(options, {
        ok: false,
        error: `Restart health check failed: ${snapshot.waitOutcome}`,
        hints: ['Check logs with: xopc gateway logs'],
      });
      process.exit(1);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    outputResult(options, {
      ok: false,
      error: `Health wait failed: ${message}`,
    });
    process.exit(1);
  }
}

// ─── Helpers ───

function parseWaitTimeout(wait: string): number {
  const match = wait.match(/^(\d+)(s|m|ms)?$/);
  if (!match) return 60_000;

  const value = parseInt(match[1], 10);
  const unit = match[2] || 's';

  switch (unit) {
    case 'ms': return value;
    case 'm': return value * 60_000;
    case 's':
    default: return value * 1000;
  }
}

interface LifecycleOutput {
  ok: boolean;
  result?: string;
  message?: string;
  error?: string;
  hints?: string[];
}

function outputResult(options: DaemonLifecycleOptions, output: LifecycleOutput): void {
  if (options.json) {
    console.log(JSON.stringify(output, null, 2));
  } else if (output.ok) {
    if (output.message) {
      console.log(`✅ ${output.message}`);
    }
  } else {
    if (output.error) {
      console.error(`❌ ${output.error}`);
    }
    if (output.hints) {
      for (const hint of output.hints) {
        console.log(`💡 ${hint}`);
      }
    }
  }
}
