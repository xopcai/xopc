import { fetchJson } from '@/lib/fetch';
import { apiUrl } from '@/lib/url';

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
};

function normalizeFromConfig(cfg: unknown): WebSearchSettingsState {
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
  };
}

export async function fetchWebSearchSettings(): Promise<WebSearchSettingsState> {
  const res = await fetchJson<{ ok?: boolean; payload?: { config?: unknown } }>(apiUrl('/api/config'));
  return normalizeFromConfig(res.payload?.config);
}

export async function patchWebSearchSettings(state: WebSearchSettingsState): Promise<void> {
  const region =
    state.regionMode === 'auto' ? 'auto' : state.regionMode === 'cn' ? 'cn' : 'global';

  const search: Record<string, unknown> = {
    maxResults: state.maxResults,
    providers: state.providers.map((p) => {
      const row: Record<string, unknown> = {
        type: p.type,
        apiKey: p.apiKey,
      };
      if (p.type === 'searxng' && p.url.trim()) {
        row.url = p.url.trim().replace(/\/+$/, '');
      }
      if (p.disabled) row.disabled = true;
      return row;
    }),
  };

  await fetchJson(apiUrl('/api/config'), {
    method: 'PATCH',
    body: JSON.stringify({
      tools: {
        web: {
          region,
          search,
        },
      },
    }),
  });
}
