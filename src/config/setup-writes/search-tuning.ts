import type { Config } from '../schema.js';

export type SearchRegionMode = 'auto' | 'cn' | 'global';

export interface SearchTuningPatch {
  region?: SearchRegionMode;
  maxResults?: number;
  blocklistEnabled?: boolean;
  blocklistDomains?: string[];
}

export function applySearchTuningPatch(cfg: Config, patch: SearchTuningPatch): Config {
  const tools = { ...((cfg.tools ?? {}) as Record<string, unknown>) };
  const web = { ...((tools.web ?? {}) as Record<string, unknown>) };

  if (patch.region !== undefined) {
    web.region = patch.region;
  }

  if (patch.maxResults !== undefined) {
    const search = { ...((web.search ?? {}) as Record<string, unknown>) };
    search.maxResults = patch.maxResults;
    web.search = search;
  }

  if (patch.blocklistEnabled !== undefined || patch.blocklistDomains !== undefined) {
    const blocklist = { ...((web.blocklist ?? {}) as Record<string, unknown>) };
    if (patch.blocklistEnabled !== undefined) {
      blocklist.enabled = patch.blocklistEnabled;
    }
    if (patch.blocklistDomains !== undefined) {
      blocklist.domains = patch.blocklistDomains;
    }
    web.blocklist = blocklist;
  }

  tools.web = web;
  return { ...cfg, tools } as Config;
}
