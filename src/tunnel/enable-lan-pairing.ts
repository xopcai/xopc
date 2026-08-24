import type { Config } from '../config/schema.js';
import { resolveGatewayAuth, assertGatewayAuthConfigured } from '../gateway/auth.js';
import { assertGatewayRuntimeConfig } from '../gateway/runtime-config.js';

export function applyLanPairingGatewayPatch(
  config: Config,
): { ok: true; changed: boolean } | { ok: false; message: string } {
  if (!config.gateway) {
    return { ok: false, message: 'Gateway section missing from config' };
  }

  const previousGateway = JSON.stringify(config.gateway);
  const nextGateway = { ...config.gateway, bind: 'lan' as const };
  delete nextGateway.customBindHost;
  const candidate = { ...config, gateway: nextGateway };
  const port = nextGateway.port ?? 18790;

  try {
    const auth = resolveGatewayAuth({ authConfig: candidate.gateway.auth });
    assertGatewayAuthConfigured(auth);
    assertGatewayRuntimeConfig({
      cfg: candidate,
      auth,
      port,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, message };
  }

  config.gateway = candidate.gateway;
  const changed = previousGateway !== JSON.stringify(config.gateway);
  return { ok: true, changed };
}
