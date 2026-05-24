import type { Config } from '../config/schema.js';
import { assertExposureConfig } from '../remote-access/exposure-guards.js';
import { createLogger } from '../utils/logger.js';
import { startGatewayTailscaleExposure, type GatewayTailscaleMode } from './server-tailscale.js';

const log = createLogger('TailscaleLifecycle');

export type TailscaleExposureState = {
  mode: GatewayTailscaleMode;
  active: boolean;
  hostname: string | null;
  resetOnExit: boolean;
};

let tailscaleCleanup: (() => Promise<void>) | null = null;
let tailscaleState: TailscaleExposureState = {
  mode: 'off',
  active: false,
  hostname: null,
  resetOnExit: true,
};

export function getTailscaleExposureState(): TailscaleExposureState {
  return { ...tailscaleState };
}

export function resolveGatewayTailscaleMode(
  cfg: Config,
  override?: GatewayTailscaleMode,
): GatewayTailscaleMode {
  if (override) {
    return override;
  }
  const envMode = process.env.XOPC_GATEWAY_TAILSCALE_MODE?.trim().toLowerCase();
  if (envMode === 'serve' || envMode === 'funnel' || envMode === 'off') {
    return envMode;
  }
  return cfg.gateway?.tailscale?.mode ?? 'off';
}

export async function maybeStartTailscaleFromConfig(
  config: Config,
  port: number,
  override?: GatewayTailscaleMode,
): Promise<void> {
  const mode = resolveGatewayTailscaleMode(config, override);
  if (mode === 'off') {
    return;
  }

  const resetOnExit =
    process.env.XOPC_GATEWAY_TAILSCALE_RESET_ON_EXIT === '1' ||
    config.gateway?.tailscale?.resetOnExit !== false;
  const cleanup = await startGatewayTailscaleExposure({
    tailscaleMode: mode,
    resetOnExit,
    port,
  });
  tailscaleCleanup = cleanup;
  tailscaleState = {
    mode,
    active: true,
    hostname: null,
    resetOnExit,
  };

  try {
    const { getTailnetHostname } = await import('../infra/tailscale.js');
    tailscaleState.hostname = await getTailnetHostname();
  } catch {
    // hostname optional
  }
}

export async function stopTailscaleExposure(): Promise<void> {
  if (tailscaleCleanup) {
    try {
      await tailscaleCleanup();
    } catch (err) {
      const em = err instanceof Error ? err.message : String(err);
      log.warn({ err, errorMessage: em, phase: 'tailscale_stop' }, `Tailscale cleanup failed: ${em}`);
    }
    tailscaleCleanup = null;
  }
  tailscaleState = {
    mode: 'off',
    active: false,
    hostname: null,
    resetOnExit: true,
  };
}

export function assertTailscaleExposureCompatible(cfg: Config): void {
  assertExposureConfig(cfg);
}

export function warnTailnetBindUnavailable(cfg: Config, bindMode: string, bindHost: string): void {
  if (bindMode === 'tailnet' && bindHost === '127.0.0.1') {
    log.warn(
      { bindMode, bindHost, phase: 'gateway_bind' },
      'gateway.bind=tailnet but no Tailscale IPv4 found; falling back to loopback',
    );
  }
}
