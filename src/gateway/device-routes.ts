import crypto from 'node:crypto';

import type { Config } from '../config/schema.js';
import { getTailscaleExposureState } from './tailscale-lifecycle.js';
import { resolveReverseProxyPublicUrl } from './public-url.js';
import type { DeviceRoute } from '../storage/sqlite/device-pairing-repository.js';
import { getTunnelService } from '../tunnel/tunnel-service.js';

function secureUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password) return null;
    return parsed.origin;
  } catch {
    return null;
  }
}

function routeId(kind: DeviceRoute['kind'], url: string): string {
  return `${kind}-${crypto.createHash('sha256').update(url).digest('hex').slice(0, 12)}`;
}

export function resolveSecureDeviceRoutes(config: Config): DeviceRoute[] {
  const tunnelStatus = getTunnelService().getStatus();
  const candidates: Array<{ kind: DeviceRoute['kind']; url: string | null }> = [
    { kind: 'custom-https', url: secureUrl(resolveReverseProxyPublicUrl(config)) },
    {
      kind: 'xopc-secure-link',
      url: tunnelStatus.state === 'connected' ? secureUrl(tunnelStatus.publicUrl) : null,
    },
  ];
  const tailscale = getTailscaleExposureState();
  if (tailscale.active && tailscale.hostname) {
    candidates.push({ kind: 'tailscale', url: secureUrl(`https://${tailscale.hostname}`) });
  }

  const seen = new Set<string>();
  const routes: DeviceRoute[] = [];
  for (const candidate of candidates) {
    if (!candidate.url || seen.has(candidate.url)) continue;
    seen.add(candidate.url);
    routes.push({
      id: routeId(candidate.kind, candidate.url),
      kind: candidate.kind,
      url: candidate.url,
    });
  }
  return routes;
}
