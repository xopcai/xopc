import { revalidateGatewayConfig } from '@/features/gateway/gateway-config-swr';
import { fetchJson } from '@/lib/fetch';
import { apiUrl } from '@/lib/url';

import { callSetup, SetupApiError } from './setup-api.js';

export type SearchProviderRow = {
  type: 'brave' | 'tavily' | 'bing' | 'searxng';
  apiKey: string;
  url: string;
  disabled: boolean;
};

export type WebSearchSettingsState = {
  regionMode: 'auto' | 'cn' | 'global';
  maxResults: number;
  providers: SearchProviderRow[];
  blocklistEnabled: boolean;
  blocklistDomains: string[];
};

export function normalizeWebSearchSettingsFromConfig(cfg: unknown): WebSearchSettingsState {
  const tools = cfg && typeof cfg === 'object' && 'tools' in cfg ? (cfg as { tools?: unknown }).tools : undefined;
  const web = tools && typeof tools === 'object' && 'web' in tools ? (tools as { web?: unknown }).web : undefined;
  const region =
    web && typeof web === 'object' && 'region' in web
      ? (web as { region?: unknown }).region
      : undefined;
  const regionMode =
    region === 'cn' || region === 'global' ? region : 'auto';

  const search =
    web && typeof web === 'object' && 'search' in web ? (web as { search?: unknown }).search : undefined;
  const s = search && typeof search === 'object' ? (search as Record<string, unknown>) : {};

  const maxResults =
    typeof s.maxResults === 'number' && Number.isFinite(s.maxResults) ? Math.floor(s.maxResults) : 5;

  const blocklist =
    web && typeof web === 'object' && 'blocklist' in web ? (web as { blocklist?: unknown }).blocklist : undefined;
  const bl = blocklist && typeof blocklist === 'object' ? (blocklist as Record<string, unknown>) : {};
  const blocklistDomains = Array.isArray(bl.domains)
    ? bl.domains.filter((d): d is string => typeof d === 'string' && d.trim().length > 0)
    : [];

  const rawProviders = s.providers;
  const rows: SearchProviderRow[] = Array.isArray(rawProviders)
    ? rawProviders.map((p) => {
        const o = p && typeof p === 'object' ? (p as Record<string, unknown>) : {};
        const type = o.type;
        const t =
          type === 'brave' || type === 'tavily' || type === 'bing' || type === 'searxng' ? type : 'brave';
        return {
          type: t,
          apiKey: typeof o.apiKey === 'string' ? o.apiKey : '',
          url: typeof o.url === 'string' ? o.url : '',
          disabled: o.disabled === true,
        };
      })
    : [];

  return {
    regionMode,
    maxResults,
    providers: rows,
    blocklistEnabled: bl.enabled === true,
    blocklistDomains,
  };
}

export async function fetchWebSearchSettings(): Promise<WebSearchSettingsState> {
  const res = await fetchJson<{ ok?: boolean; payload?: { config?: unknown } }>(apiUrl('/api/config'));
  return normalizeWebSearchSettingsFromConfig(res.payload?.config);
}

function rowToFields(row: SearchProviderRow): Record<string, unknown> {
  const fields: Record<string, unknown> = { type: row.type };
  if (row.type === 'searxng') {
    fields.url = row.url.trim().replace(/\/+$/, '');
  } else {
    fields.key = row.apiKey;
  }
  return fields;
}

function rowsEqual(a: SearchProviderRow, b: SearchProviderRow): boolean {
  return (
    a.type === b.type &&
    a.apiKey === b.apiKey &&
    a.url.trim().replace(/\/+$/, '') === b.url.trim().replace(/\/+$/, '') &&
    a.disabled === b.disabled
  );
}

/**
 * Persist web-search settings.
 *
 * M3.5 phase B routes provider add/remove through `POST /api/setup/search/*`
 * (the same path the CLI and M2 skills use), so all three surfaces share one
 * write path with consistent zod validation. Region / blocklist / maxResults
 * stay on `PATCH /api/config` because no setup CLI handler covers them yet
 * (those follow in a later milestone).
 *
 * Throws on the first provider error (with a {@link SetupApiError} carrying
 * structured `errors[]`); the form catches it and renders the message.
 */
export async function patchWebSearchSettings(
  state: WebSearchSettingsState,
  baseline?: WebSearchSettingsState | null,
): Promise<void> {
  const before = baseline?.providers ?? [];
  const after = state.providers;

  // Remove providers that vanished from the form.
  for (const prev of before) {
    if (!after.some((p) => p.type === prev.type)) {
      try {
        await callSetup({
          domain: 'search',
          action: 'remove',
          fields: { type: prev.type },
        });
      } catch (err) {
        // Tolerate "already gone" — defensive against concurrent edits.
        if (!(err instanceof SetupApiError)) throw err;
        if (!/no.*configured/i.test(err.message)) throw err;
      }
    }
  }

  // Upsert added or changed providers (idempotent on the server).
  for (const row of after) {
    const prev = before.find((p) => p.type === row.type);
    if (prev && rowsEqual(prev, row)) continue;
    if (row.type !== 'searxng' && !row.apiKey.trim()) {
      // Skip rows whose key was cleared but type wasn't removed —
      // prevents the "key required" error from blowing up the save.
      continue;
    }
    if (row.type === 'searxng' && !row.url.trim()) {
      continue;
    }
    await callSetup({ domain: 'search', action: 'add', fields: rowToFields(row) });
  }

  // Region, blocklist and maxResults aren't covered by setup CLI handlers
  // yet — patch them through the legacy /api/config endpoint.
  const region =
    state.regionMode === 'auto' ? 'auto' : state.regionMode === 'cn' ? 'cn' : 'global';
  await fetchJson(apiUrl('/api/config'), {
    method: 'PATCH',
    body: JSON.stringify({
      tools: {
        web: {
          region,
          search: { maxResults: state.maxResults },
          blocklist: {
            enabled: state.blocklistEnabled,
            domains: state.blocklistDomains,
          },
        },
      },
    }),
  });
  void revalidateGatewayConfig();
}
