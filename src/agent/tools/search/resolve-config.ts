import type { WebToolsConfig } from '../../../config/schema.js';
import { resolveConfigValue } from '../../../config/resolve-config-value.js';
import { resolveWebSearchRegion } from './region.js';
import type { ResolvedWebSearchConfig } from './types.js';

function resolveKey(raw?: string): string | undefined {
  if (raw === undefined || raw === '') return undefined;
  return resolveConfigValue(raw) ?? raw;
}

/** Build registry input from config (keys resolved via resolveConfigValue when set). */
export function resolveWebSearchConfig(web?: WebToolsConfig): ResolvedWebSearchConfig {
  const search = web?.search;
  const region = resolveWebSearchRegion(web);

  const providers = (search?.providers ?? []).map((p) => {
    const resolvedKey =
      p.apiKey !== undefined && p.apiKey !== '' ? resolveKey(p.apiKey) : undefined;
    const url = p.url?.replace(/\/+$/, '');
    return {
      type: p.type,
      apiKey: resolvedKey,
      url,
      disabled: p.disabled,
    };
  });

  return {
    region,
    maxResults: search?.maxResults ?? 5,
    providers,
  };
}
