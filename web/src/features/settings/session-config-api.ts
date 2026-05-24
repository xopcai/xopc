import { revalidateGatewayConfig } from '@/features/gateway/gateway-config-swr';
import { fetchJson } from '@/lib/fetch';
import { apiUrl } from '@/lib/url';

export type SessionDmScope = 'main' | 'per-peer' | 'per-channel-peer' | 'per-account-channel-peer';

export type SessionConfigState = {
  dmScope: SessionDmScope;
  pruneAfterDays: number | null;
  maxEntries: number | null;
};

export const DEFAULT_SESSION_CONFIG: SessionConfigState = {
  dmScope: 'main',
  pruneAfterDays: null,
  maxEntries: null,
};

function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function normalizeDmScope(raw: unknown): SessionDmScope {
  if (
    raw === 'main' ||
    raw === 'per-peer' ||
    raw === 'per-channel-peer' ||
    raw === 'per-account-channel-peer'
  ) {
    return raw;
  }
  return 'main';
}

export function normalizeSessionConfigFromConfig(config: unknown): SessionConfigState {
  const c = isRecord(config) ? config : {};
  const session = isRecord(c.session) ? c.session : {};
  const storage = isRecord(session.storage) ? session.storage : {};
  const pruneAfterDays =
    typeof storage.pruneAfterDays === 'number' && Number.isFinite(storage.pruneAfterDays)
      ? Math.max(0, Math.floor(storage.pruneAfterDays))
      : typeof storage.pruneAfterMs === 'number' && Number.isFinite(storage.pruneAfterMs)
        ? Math.max(0, Math.round(storage.pruneAfterMs / 86_400_000))
        : null;
  const maxEntries =
    typeof storage.maxEntries === 'number' && Number.isFinite(storage.maxEntries)
      ? Math.max(1, Math.floor(storage.maxEntries))
      : null;
  return {
    dmScope: normalizeDmScope(session.dmScope),
    pruneAfterDays,
    maxEntries,
  };
}

export async function patchSessionConfig(state: SessionConfigState): Promise<void> {
  await fetchJson(apiUrl('/api/config'), {
    method: 'PATCH',
    body: JSON.stringify({
      session: {
        dmScope: state.dmScope,
        storage: {
          pruneAfterMs:
            state.pruneAfterDays !== null ? state.pruneAfterDays * 86_400_000 : null,
          maxEntries: state.maxEntries,
        },
      },
    }),
  });
  void revalidateGatewayConfig();
}
