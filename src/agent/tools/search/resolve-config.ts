import type { WebToolsConfig } from '../../../config/schema.js';
import { resolveConfigValue } from '../../../config/resolve-config-value.js';
import { resolveWebSearchRegion } from './region.js';
import type { ResolvedWebSearchConfig } from './types.js';

function resolveKey(raw?: string): string | undefined {
  if (raw === undefined || raw === '') return undefined;
  return resolveConfigValue(raw) ?? raw;
}

/**
 * Build registry input from config + env. Legacy Brave: `search.apiKey` or `BRAVE_API_KEY`.
 */
export function resolveWebSearchConfig(web?: WebToolsConfig): ResolvedWebSearchConfig {
  const search = web?.search;
  const region = resolveWebSearchRegion(web);

  const legacyFromEnv = process.env.BRAVE_API_KEY?.trim();
  const legacyApiRaw = search?.apiKey?.trim() ? search.apiKey : legacyFromEnv;
  const apiKey = resolveKey(legacyApiRaw) ?? '';

  const providers = search?.providers?.map((p) => {
    const resolvedKey =
      p.apiKey !== undefined && p.apiKey !== '' ? resolveKey(p.apiKey) : undefined;
    let apiKey = resolvedKey;
    let url = p.url?.replace(/\/+$/, '');
    if (p.type === 'tavily' && !apiKey) {
      apiKey = process.env.TAVILY_API_KEY?.trim();
    }
    if (p.type === 'bing' && !apiKey) {
      apiKey = process.env.BING_SEARCH_API_KEY?.trim();
    }
    if (p.type === 'searxng' && !url) {
      url = process.env.SEARXNG_URL?.replace(/\/+$/, '');
    }
    return {
      type: p.type,
      apiKey,
      url,
      disabled: p.disabled,
    };
  });

  return {
    region,
    apiKey,
    maxResults: search?.maxResults ?? 5,
    providers,
  };
}
