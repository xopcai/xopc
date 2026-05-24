import type { Config } from '../config/schema.js';
import {
  isNetworkAccessibleBindHost,
  resolveGatewayBindMode,
  resolveGatewayEffectiveHost,
} from '../config/gateway-bind.js';
import { resolveGatewayAuth, assertGatewayAuthConfigured } from '../gateway/auth.js';
import { buildDefaultCorsOrigins } from '../gateway/host.js';
import { assertGatewayRuntimeConfig } from '../gateway/runtime-config.js';
import { enumerateLanGatewayCandidates } from './tunnel-qr.js';

function mergeCorsOriginsForLan(config: Config, port: number, bindHost: string): void {
  if (!config.gateway) return;
  const existing = new Set(
    (config.gateway.corsOrigins ?? []).map((o) => o.trim()).filter(Boolean),
  );
  for (const origin of buildDefaultCorsOrigins({ port, bindHost })) {
    existing.add(origin);
  }
  for (const candidate of enumerateLanGatewayCandidates(port)) {
    existing.add(candidate.url);
  }
  config.gateway.corsOrigins = [...existing];
}

export function applyLanPairingGatewayPatch(
  config: Config,
): { ok: true; changed: boolean } | { ok: false; message: string } {
  const bindMode = resolveGatewayBindMode(config);
  const listenHost = resolveGatewayEffectiveHost(config);
  if (bindMode === 'lan' && isNetworkAccessibleBindHost(listenHost)) {
    return { ok: true, changed: false };
  }

  if (!config.gateway) {
    return { ok: false, message: 'Gateway section missing from config' };
  }

  config.gateway.bind = 'lan';
  delete config.gateway.customBindHost;

  const port = config.gateway.port ?? 18790;
  const bindHost = resolveGatewayEffectiveHost(config);
  mergeCorsOriginsForLan(config, port, bindHost);

  try {
    const auth = resolveGatewayAuth({ authConfig: config.gateway.auth });
    assertGatewayAuthConfigured(auth);
    assertGatewayRuntimeConfig({
      cfg: config,
      auth,
      port,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, message };
  }

  return { ok: true, changed: true };
}
