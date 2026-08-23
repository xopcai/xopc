import type { Config } from '../../../config/schema.js';

import { listMarketplacePackages } from '../skills-marketplace.js';
import {
  searchClawHubFederatedSkills,
  type ClawHubSearchResultItem,
} from './adapters/clawhub/adapter.js';

export const SKILL_MARKETPLACE_SEARCH_SOURCES = ['store', 'skillhub', 'clawhub', 'skills-sh'] as const;

export type SkillsMarketplaceSearchSource = (typeof SKILL_MARKETPLACE_SEARCH_SOURCES)[number];

export interface SkillsMarketplaceSearchResult {
  id: string;
  provider: 'store' | 'skillhub' | 'clawhub';
  source: SkillsMarketplaceSearchSource;
  name: string;
  description: string;
  author: string;
  downloads: number;
  stars: number;
  updatedAt: string | null;
  canonicalUrl: string | null;
  install: {
    kind: string;
    reference: string;
    sourceUrl: string | null;
  };
  security: {
    status: 'pass' | 'warn' | 'fail' | 'unknown';
    scanners: Array<{
      name: string;
      status: 'pass' | 'warn' | 'fail' | 'unknown';
      checkedAt: string | null;
      url: string | null;
    }>;
  };
  valueScore: number;
}

export interface SkillMarketplaceSourceStatus {
  source: SkillsMarketplaceSearchSource;
  ok: boolean;
  count: number;
  via?: 'clawhub';
  error?: string;
}

function boundedNumber(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function normalizeDate(value: unknown): string | null {
  if (value === undefined || value === null || value === '') return null;
  const numeric = typeof value === 'number'
    ? value
    : typeof value === 'string' && /^\d+(?:\.\d+)?$/.test(value.trim())
      ? Number(value)
      : null;
  const timestamp = numeric !== null && Number.isFinite(numeric)
    ? Math.abs(numeric) < 1_000_000_000_000 ? numeric * 1000 : numeric
    : value;
  const date = new Date(timestamp as string | number);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function scannerStatus(value: unknown): 'pass' | 'warn' | 'fail' | 'unknown' {
  const normalized = String(value ?? '').trim().toLowerCase();
  if (normalized === 'pass') return 'pass';
  if (normalized === 'warn' || normalized === 'warning' || normalized === 'review') return 'warn';
  if (normalized === 'fail' || normalized === 'failed' || normalized === 'block') return 'fail';
  return 'unknown';
}

function securityFromClawHub(item: ClawHubSearchResultItem): SkillsMarketplaceSearchResult['security'] {
  const scanners = Object.entries(item.trust?.upstreamScanners ?? {}).map(([name, evidence]) => ({
    name,
    status: scannerStatus(evidence.status),
    checkedAt: normalizeDate(evidence.sourceCheckedAt),
    url: evidence.sourceUrl ?? null,
  }));
  const statuses = scanners.map((scanner) => scanner.status);
  const status = statuses.includes('fail')
    ? 'fail'
    : statuses.includes('warn')
      ? 'warn'
      : statuses.length > 0 && statuses.every((value) => value === 'pass')
        ? 'pass'
        : scannerStatus(item.trust?.clawHubVerdict);
  return { status, scanners };
}

function absoluteClawHubUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const base = process.env.CLAWHUB_REGISTRY?.trim() || 'https://clawhub.ai';
    return new URL(value, base).toString();
  } catch {
    return null;
  }
}

function relevanceScore(query: string, result: Pick<SkillsMarketplaceSearchResult, 'name' | 'description'>): number {
  const terms = query.toLowerCase().split(/[^a-z0-9]+/).filter((term) => term.length > 1);
  if (terms.length === 0) return 0;
  const name = result.name.toLowerCase();
  const description = result.description.toLowerCase();
  const matched = terms.reduce((score, term) => {
    if (name === term) return score + 3;
    if (name.includes(term)) return score + 2;
    if (description.includes(term)) return score + 1;
    return score;
  }, 0);
  return Math.min(35, Math.round((matched / (terms.length * 3)) * 35));
}

function valueScore(query: string, result: SkillsMarketplaceSearchResult): number {
  const relevance = relevanceScore(query, result);
  const adoption = Math.min(30, Math.log10(result.downloads + 1) * 7);
  const endorsement = Math.min(15, Math.log10(result.stars + 1) * 6);
  const updatedMs = result.updatedAt ? Date.parse(result.updatedAt) : 0;
  const ageDays = updatedMs > 0 ? (Date.now() - updatedMs) / 86_400_000 : Number.POSITIVE_INFINITY;
  const freshness = ageDays <= 90 ? 15 : ageDays <= 365 ? 10 : ageDays <= 730 ? 5 : 0;
  const provenance = result.canonicalUrl && result.install.reference ? 5 : 0;
  const security = result.security.status === 'pass'
    ? 5
    : result.security.status === 'warn'
      ? -20
      : result.security.status === 'fail'
        ? -100
        : 0;
  return Math.round((relevance + adoption + endorsement + freshness + provenance + security) * 10) / 10;
}

function fromClawHub(item: ClawHubSearchResultItem): SkillsMarketplaceSearchResult {
  const source: SkillsMarketplaceSearchSource = item.source === 'skills-sh' ? 'skills-sh' : 'clawhub';
  const owner =
    item.publisher?.handle
    ?? item.sourceIdentity?.owner
    ?? item.owner?.handle
    ?? item.ownerHandle
    ?? source;
  const reference = item.install?.reference
    ?? (source === 'clawhub' && owner !== 'clawhub' ? `${owner}/${item.slug}` : item.slug);
  const result: SkillsMarketplaceSearchResult = {
    id: item.id ?? `${source}:${reference}`,
    provider: 'clawhub',
    source,
    name: item.displayName || item.slug,
    description: item.summary || '',
    author: owner,
    downloads: boundedNumber(item.downloads ?? item.native?.skill?.stats?.downloads),
    stars: boundedNumber(item.native?.skill?.stats?.stars ?? item.metrics?.bookmarks),
    updatedAt: normalizeDate(item.metrics?.updatedAt ?? item.updatedAt),
    canonicalUrl: absoluteClawHubUrl(item.canonicalUrl ?? item.links?.canonical),
    install: {
      kind: item.install?.kind ?? source,
      reference,
      sourceUrl: item.install?.sourceUrl ?? item.links?.source ?? null,
    },
    security: securityFromClawHub(item),
    valueScore: 0,
  };
  return result;
}

function absoluteSkillHubUrl(slug: string): string | null {
  const normalized = slug.trim();
  return normalized ? `https://skillhub.cn/skills/${encodeURIComponent(normalized)}` : null;
}

function fromMarketplacePackage(
  provider: 'store' | 'skillhub',
  item: Awaited<ReturnType<typeof listMarketplacePackages>>['items'][number],
): SkillsMarketplaceSearchResult {
  return {
    id: item.id,
    provider,
    source: provider,
    name: item.name,
    description: item.description,
    author: item.author.username,
    downloads: boundedNumber(item.downloads),
    stars: boundedNumber(item.stars),
    updatedAt: normalizeDate(item.updatedAt),
    canonicalUrl: provider === 'skillhub' ? absoluteSkillHubUrl(item.id) : null,
    install: {
      kind: provider,
      reference: provider === 'store' ? item.name : item.id,
      sourceUrl: null,
    },
    security: { status: 'unknown', scanners: [] },
    valueScore: 0,
  };
}

function dedupeAndRank(query: string, rows: SkillsMarketplaceSearchResult[]): SkillsMarketplaceSearchResult[] {
  const unique = new Map<string, SkillsMarketplaceSearchResult>();
  for (const row of rows) {
    const key = `${row.source}:${row.install.reference || row.id}`.toLowerCase();
    const scored = { ...row, valueScore: valueScore(query, row) };
    const current = unique.get(key);
    if (!current || scored.valueScore > current.valueScore) unique.set(key, scored);
  }
  return [...unique.values()].sort((a, b) =>
    b.valueScore - a.valueScore
    || b.downloads - a.downloads
    || a.name.localeCompare(b.name),
  );
}

export async function searchSkillMarketplaces(params: {
  config: Config;
  query: string;
  sources?: SkillsMarketplaceSearchSource[];
  limit?: number;
}): Promise<{ results: SkillsMarketplaceSearchResult[]; sources: SkillMarketplaceSourceStatus[] }> {
  const requested = new Set(params.sources?.length ? params.sources : SKILL_MARKETPLACE_SEARCH_SOURCES);
  const fetchLimit = Math.min(100, Math.max(params.limit ?? 10, 20));
  const rows: SkillsMarketplaceSearchResult[] = [];
  const statuses: SkillMarketplaceSourceStatus[] = [];

  const jobs: Promise<void>[] = [];
  if (requested.has('store')) {
    jobs.push((async () => {
      try {
        const response = await listMarketplacePackages(params.config, {
          q: params.query,
          page: 1,
          pageSize: fetchLimit,
          sort: 'downloads',
        }, 'store');
        for (const item of response.items) rows.push(fromMarketplacePackage('store', item));
        statuses.push({ source: 'store', ok: true, count: response.items.length });
      } catch (error) {
        statuses.push({ source: 'store', ok: false, count: 0, error: String(error) });
      }
    })());
  }

  if (requested.has('skillhub')) {
    jobs.push((async () => {
      try {
        const response = await listMarketplacePackages(params.config, {
          q: params.query,
          page: 1,
          pageSize: fetchLimit,
          sort: 'downloads',
        }, 'skillhub');
        for (const item of response.items) rows.push(fromMarketplacePackage('skillhub', item));
        statuses.push({ source: 'skillhub', ok: true, count: response.items.length });
      } catch (error) {
        statuses.push({ source: 'skillhub', ok: false, count: 0, error: String(error) });
      }
    })());
  }

  if (requested.has('clawhub') || requested.has('skills-sh')) {
    jobs.push((async () => {
      try {
        const response = await searchClawHubFederatedSkills(params.query, fetchLimit);
        const converted = response.results.map(fromClawHub);
        for (const source of ['clawhub', 'skills-sh'] as const) {
          if (!requested.has(source)) continue;
          const matches = converted.filter((row) => row.source === source);
          rows.push(...matches);
          statuses.push({ source, ok: true, count: matches.length, ...(source === 'skills-sh' ? { via: 'clawhub' as const } : {}) });
        }
      } catch (error) {
        for (const source of ['clawhub', 'skills-sh'] as const) {
          if (requested.has(source)) statuses.push({ source, ok: false, count: 0, error: String(error), ...(source === 'skills-sh' ? { via: 'clawhub' as const } : {}) });
        }
      }
    })());
  }

  await Promise.all(jobs);
  const limit = Math.min(20, Math.max(1, params.limit ?? 10));
  const orderedStatuses = SKILL_MARKETPLACE_SEARCH_SOURCES
    .filter((source) => requested.has(source))
    .map((source) => statuses.find((status) => status.source === source)!)
    .filter(Boolean);
  return { results: dedupeAndRank(params.query, rows).slice(0, limit), sources: orderedStatuses };
}
