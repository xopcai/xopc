import { fetchJson } from '@/lib/fetch';
import { apiUrl } from '@/lib/url';

import type { GatewaySettingsState } from './gateway-settings.types';

export type { GatewaySettingsState } from './gateway-settings.types';

function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

export function normalizeGatewayFromConfig(config: unknown): GatewaySettingsState {
  const c = isRecord(config) ? config : {};
  const gw = isRecord(c.gateway) ? c.gateway : {};
  const auth = isRecord(gw.auth) ? gw.auth : {};
  const mode = auth.mode === 'none' || auth.mode === 'token' ? auth.mode : 'token';
  return {
    host: typeof gw.host === 'string' ? gw.host : '',
    port: typeof gw.port === 'number' ? gw.port : undefined,
    auth: {
      mode,
      token: typeof auth.token === 'string' ? auth.token : '',
    },
  };
}

export async function fetchGatewaySettings(): Promise<GatewaySettingsState> {
  const res = await fetchJson<{ ok?: boolean; payload?: { config?: unknown } }>(apiUrl('/api/config'));
  return normalizeGatewayFromConfig(res.payload?.config ?? {});
}

export async function patchGatewaySettings(state: GatewaySettingsState): Promise<void> {
  const token = state.auth.token.trim();
  const auth =
    token.length > 0
      ? { mode: state.auth.mode, token: state.auth.token }
      : { mode: state.auth.mode };
  await fetchJson(apiUrl('/api/config'), {
    method: 'PATCH',
    body: JSON.stringify({
      gateway: {
        auth,
      },
    }),
  });
}
