import type { Config, SearchProviderEntry } from '../config/schema.js';

export function isMaskedApiKey(v: unknown): boolean {
  return v === '***' || v === '••••••••••••';
}

export function safeToolsWebForGet(config: Config): {
  web: {
    region: 'cn' | 'global' | null;
    search: {
      maxResults: number;
      providers: Array<{ type: string; apiKey: string; url: string; disabled: boolean }>;
    };
  };
} {
  const web = config.tools?.web;
  const search = web?.search;
  const providers = search?.providers ?? [];
  const providersOut = providers.map((p) => ({
    type: p.type,
    apiKey: p.apiKey && p.apiKey.trim().length > 0 ? '***' : '',
    url: typeof p.url === 'string' ? p.url : '',
    disabled: Boolean(p.disabled),
  }));
  return {
    web: {
      region: web?.region ?? null,
      search: {
        maxResults: search?.maxResults ?? 5,
        providers: providersOut,
      },
    },
  };
}

/**
 * Merge `body.tools.web` into config. Returns an error message on validation failure.
 */
export function applyToolsWebPatch(config: Config, body: Record<string, unknown>): string | undefined {
  const tools = body.tools;
  if (!tools || typeof tools !== 'object') return undefined;
  const tw = (tools as { web?: unknown }).web;
  if (!tw || typeof tw !== 'object') return undefined;

  const incoming = tw as Record<string, unknown>;

  if (!config.tools) {
    config.tools = { web: {} };
  }
  if (!config.tools.web) {
    config.tools.web = {};
  }
  if (!config.tools.web.search) {
    config.tools.web.search = { maxResults: 5, providers: [] };
  }

  const prevSearch = config.tools.web.search;
  const prevProviders = prevSearch.providers;

  if (incoming.region !== undefined) {
    if (incoming.region === null || incoming.region === '' || incoming.region === 'auto') {
      delete config.tools.web.region;
    } else if (incoming.region === 'cn' || incoming.region === 'global') {
      config.tools.web.region = incoming.region;
    } else {
      return 'Invalid tools.web.region';
    }
  }

  const sr = incoming.search;
  if (sr === undefined) return undefined;
  if (typeof sr !== 'object' || sr === null) {
    return 'Invalid tools.web.search';
  }
  const s = sr as Record<string, unknown>;

  if (s.maxResults !== undefined) {
    const n = typeof s.maxResults === 'number' ? s.maxResults : Number(s.maxResults);
    if (!Number.isFinite(n) || n < 1 || n > 50) {
      return 'tools.web.search.maxResults must be between 1 and 50';
    }
    config.tools.web.search.maxResults = Math.floor(n);
  }

  if (!('providers' in s)) {
    return undefined;
  }

  if (!Array.isArray(s.providers)) {
    return 'tools.web.search.providers must be an array';
  }

  const merged: SearchProviderEntry[] = [];
  for (let i = 0; i < s.providers.length; i++) {
    const rawRow = s.providers[i];
    if (!rawRow || typeof rawRow !== 'object') {
      return 'Invalid search provider entry';
    }
    const row = rawRow as Record<string, unknown>;
    const type = row.type;
    if (type !== 'brave' && type !== 'tavily' && type !== 'bing' && type !== 'searxng') {
      return `Invalid search provider type: ${String(type)}`;
    }
    const prev = prevProviders?.[i];
    let apiKey = typeof row.apiKey === 'string' ? row.apiKey : '';
    if (isMaskedApiKey(apiKey) && prev?.apiKey) {
      apiKey = prev.apiKey;
    }
    const urlRaw = typeof row.url === 'string' ? row.url.trim().replace(/\/+$/, '') : '';
    const entry: SearchProviderEntry = { type };
    if (type === 'searxng') {
      if (urlRaw) entry.url = urlRaw;
      if (apiKey) entry.apiKey = apiKey;
    } else {
      if (apiKey) entry.apiKey = apiKey;
    }
    if (row.disabled === true) {
      entry.disabled = true;
    }
    merged.push(entry);
  }
  config.tools.web.search.providers = merged;
  return undefined;
}
