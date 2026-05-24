import type { Config } from '../config/schema.js';
import { resolveGatewayBindMode } from '../config/gateway-bind.js';
import { isLoopbackHost } from '../gateway/host.js';
import { resolveGatewayListenPlan } from '../gateway/listen.js';
import type { GatewayTailscaleMode } from '../gateway/server-tailscale.js';

export type ExposureConflict = {
  code: string;
  message: string;
};

export function collectExposureConflicts(cfg: Config): ExposureConflict[] {
  const conflicts: ExposureConflict[] = [];
  const tailscaleMode = cfg.gateway?.tailscale?.mode ?? 'off';
  const bindMode = resolveGatewayBindMode(cfg);

  if (tailscaleMode !== 'off' && bindMode !== 'loopback') {
    conflicts.push({
      code: 'tailscale_non_loopback_bind',
      message: `gateway.tailscale.mode=${tailscaleMode} requires gateway.bind=loopback`,
    });
  }

  if (tailscaleMode === 'funnel' && cfg.gateway?.auth?.mode !== 'password') {
    conflicts.push({
      code: 'funnel_without_password',
      message: 'gateway.tailscale.mode=funnel requires gateway.auth.mode=password',
    });
  }

  if (tailscaleMode !== 'off' && cfg.tunnel?.autoStart === true) {
    conflicts.push({
      code: 'tailscale_frp_autostart_conflict',
      message: 'tunnel.autoStart cannot be enabled while Tailscale exposure is active',
    });
  }

  return conflicts;
}

export function assertExposureConfig(cfg: Config): void {
  const conflicts = collectExposureConflicts(cfg);
  if (conflicts.length > 0) {
    throw new Error(conflicts.map((c) => c.message).join('; '));
  }
}

export function resolveEffectiveTailscaleMode(
  cfg: Config,
  override?: GatewayTailscaleMode,
): GatewayTailscaleMode {
  if (override) {
    return override;
  }
  return cfg.gateway?.tailscale?.mode ?? 'off';
}

export function isGatewayTlsEnabled(cfg: Config): boolean {
  return (
    cfg.gateway?.tls?.enabled === true ||
    cfg.tunnel?.enabled === true ||
    (cfg.gateway?.tailscale?.mode ?? 'off') !== 'off'
  );
}

export function isRemoteGatewayInsecure(cfg: Config): boolean {
  if (cfg.gateway?.mode !== 'remote') {
    return false;
  }
  const url = cfg.gateway.remote?.url?.trim();
  if (!url) {
    return false;
  }
  try {
    const parsed = new URL(url);
    const loopback =
      parsed.hostname === '127.0.0.1' ||
      parsed.hostname === 'localhost' ||
      parsed.hostname === '::1';
    if (loopback) {
      return false;
    }
    if (parsed.protocol === 'https:') {
      return false;
    }
    return !isGatewayTlsEnabled(cfg);
  } catch {
    return true;
  }
}

export function isTailnetBindUnavailable(cfg: Config): boolean {
  const plan = resolveGatewayListenPlan({ cfg });
  return plan.bindMode === 'tailnet' && isLoopbackHost(plan.bindHost);
}
