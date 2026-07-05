import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';

import type { DreamingDeepConfig } from './config.js';
import {
  DEFAULT_DEEP_CRON,
  DEFAULT_MAX_AGE_DAYS,
  DEFAULT_RECENCY_HALF_LIFE_DAYS,
  DIVERSITY_DIMENSION_COUNT,
  DIVERSITY_WEIGHT,
  MS_PER_DAY,
  REINFORCEMENT_WEIGHT,
} from './constants.js';
// `DreamingStoreEntry` lives in `./short-term-store.js`, which imports value
// helpers from THIS file — so importing it back creates a circular cycle.
// `computeCandidateScore` only reads three numeric/string fields; declaring a
// narrow structural type keeps the helper decoupled.
type DreamingStoreEntryScoringView = {
  recallCount: number;
  totalScore: number;
  lastRecalledAt?: string;
  queryHashes?: readonly string[];
  sourceCount: number;
  groundedCount: number;
  lightHits: number;
  remHits: number;
};

// ── Path + keying ─────────────────────────────────────────────────────

/** Normalize a workspace-relative memory path: forward slashes, no odd ../ escapes at start. */
export function normalizeMemoryPath(rel: string): string {
  if (typeof rel !== 'string' || !rel.trim()) return '';
  const s = rel.trim().replace(/\\/g, '/');
  return path.posix
    .normalize(s)
    .replace(/^(\.\/)+/, '')
    .replace(/\/+/g, '/');
}

/**
 * Stable id for a short-term store entry (path + line range).
 * Format: `{normalizedPath}#{start}-{end}` (1-based, inclusive end).
 */
export function buildEntryKey(parts: { path: string; startLine: number; endLine: number }): string {
  const p = normalizeMemoryPath(parts.path);
  const a = Math.max(1, Math.floor(parts.startLine));
  const b = Math.max(a, Math.floor(parts.endLine));
  return `${p}#${a}-${b}`;
}

/** YYYY-MM-DD in local time. */
export function isoDay(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// ── Numbers + deep config defaults ────────────────────────────────────

export function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function toPositiveInt(value: unknown, fallback: number): number {
  const num = typeof value === 'string' ? Number(value) : Number(value);
  if (!Number.isFinite(num)) return fallback;
  const floored = Math.floor(num);
  return floored > 0 ? floored : fallback;
}

function toNonNegInt(value: unknown, fallback: number): number {
  const num = typeof value === 'string' ? Number(value) : Number(value);
  if (!Number.isFinite(num)) return fallback;
  const floored = Math.floor(num);
  return floored >= 0 ? floored : fallback;
}

function clampScore(value: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(0, Math.min(1, value));
}

function trimmedCron(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

/** Fills in deep-phase defaults; mirrors `resolveDreamingConfig` deep object when only partial overrides are given. */
export function resolveDeepDefaults(overrides?: Partial<DreamingDeepConfig>): DreamingDeepConfig {
  return {
    enabled: overrides?.enabled !== false,
    cron: trimmedCron(overrides?.cron, DEFAULT_DEEP_CRON),
    minScore: clampScore(Number(overrides?.minScore), 0.8),
    minRecallCount: toPositiveInt(overrides?.minRecallCount, 3),
    minUniqueQueries: toPositiveInt(overrides?.minUniqueQueries, 3),
    limit: toNonNegInt(overrides?.limit, 10),
    recencyHalfLifeDays: toPositiveInt(overrides?.recencyHalfLifeDays, DEFAULT_RECENCY_HALF_LIFE_DAYS),
    maxAgeDays: toPositiveInt(overrides?.maxAgeDays, DEFAULT_MAX_AGE_DAYS),
  };
}

// ── Scoring (deep promotion) ─────────────────────────────────────────

export function computeCandidateScore(
  entry: DreamingStoreEntryScoringView,
  nowMs: number,
  recencyHalfLifeDays: number,
): { avgScore: number; score: number; recencyDecay: number } {
  const recall = Math.max(0, entry.recallCount);
  const avgRaw = recall > 0 ? entry.totalScore / recall : 0;
  const avgScore = clamp01(avgRaw);

  let recencyDecay = 1;
  if (entry.lastRecalledAt) {
    const last = Date.parse(entry.lastRecalledAt);
    if (Number.isFinite(last)) {
      const days = Math.max(0, (nowMs - last) / MS_PER_DAY);
      const hl = Math.max(0.1, recencyHalfLifeDays);
      recencyDecay = 0.5 ** (days / hl);
    }
  }

  const logRecall = Math.log(1 + recall);
  const reinforcement = REINFORCEMENT_WEIGHT * Math.min(logRecall, 3);

  const qCount = entry.queryHashes?.length ?? 0;
  const uniqueQueryTerm = Math.min(1, qCount / 6) * DIVERSITY_WEIGHT;

  const dims = [entry.sourceCount, entry.groundedCount, entry.lightHits, entry.remHits].filter(
    (n) => n > 0,
  ).length;
  const signalDiversity = ((dims / DIVERSITY_DIMENSION_COUNT) * DIVERSITY_WEIGHT) / 2;

  const score = clamp01(avgScore * recencyDecay + reinforcement * 0.25 + uniqueQueryTerm + signalDiversity);

  return { avgScore, score, recencyDecay };
}

export function compareCandidatesByScore(
  a: { score: number; key: string },
  b: { score: number; key: string },
): number {
  if (b.score !== a.score) return b.score - a.score;
  return a.key.localeCompare(b.key);
}

// ── File slices + integrity ─────────────────────────────────────────

export async function readFileLines(fullPath: string): Promise<string[] | null> {
  try {
    const raw = await fs.readFile(fullPath, 'utf-8');
    return raw.split(/\r?\n/);
  } catch (err) {
    if ((err as NodeJS.ErrnoException | undefined)?.code === 'ENOENT') return null;
    throw err;
  }
}

/** 1-based inclusive line range. Joins with newlines. */
export function sliceRange(lines: string[], startLine: number, endLine: number): string {
  const a = Math.max(1, Math.floor(startLine));
  const b = Math.max(a, Math.floor(endLine));
  const out = lines.slice(a - 1, b);
  return out.join('\n').trimEnd();
}

export function isExpiredEntry(
  lastRecalledAt: string | undefined,
  nowMs: number,
  maxAgeDays: number,
): boolean {
  if (!lastRecalledAt) return true;
  const t = Date.parse(lastRecalledAt);
  if (!Number.isFinite(t)) return true;
  return (nowMs - t) / MS_PER_DAY > maxAgeDays;
}

/** Reject empty, tiny, or absurdly long snippets; blocks obvious “tool error” text. */
export function isContaminatedSnippet(snippet: string): boolean {
  const s = snippet.trim();
  if (s.length < 3) return true;
  if (s.length > 12_000) return true;
  if (!/\p{L}/u.test(s) && !/\d/.test(s)) return true;
  return false;
}

export function normalizeSnippetForHash(text: string): string {
  return text
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/['"`]/g, '')
    .trim();
}

export function snippetHash(text: string): string {
  const n = normalizeSnippetForHash(text);
  return createHash('sha1').update(n, 'utf8').digest('hex').slice(0, 20);
}

export function extractPromotionMarkers(markdown: string): { keys: Set<string>; hashes: Set<string> } {
  const keys = new Set<string>();
  const hashes = new Set<string>();
  let m: RegExpExecArray | null;
  const re = /<!--\s*xopc-memory-promotion\s+key="([^"]*)"\s+hash="([^"]*)"\s*-->/g;
  while ((m = re.exec(markdown)) !== null) {
    if (m[1]) keys.add(m[1]);
    if (m[2]) hashes.add(m[2]);
  }
  return { keys, hashes };
}
