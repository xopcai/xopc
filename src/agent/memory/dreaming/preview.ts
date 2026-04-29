import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';

import type { DreamingDeepConfig } from './config.js';
import { DEFAULT_MAX_AGE_DAYS, DEFAULT_RECENCY_HALF_LIFE_DAYS, MEMORY_MD_FILENAME } from './constants.js';
import { loadDreamingStore, type DreamingStoreEntry } from './short-term-store.js';

type PreviewItem = {
  key: string;
  hash: string;
  snippet: string;
  path: string;
  startLine: number;
  endLine: number;
  score: number;
  avgScore: number;
  recallCount: number;
  recencyDecay: number;
  alreadyPromotedByKey: boolean;
  alreadyPromotedByHash: boolean;
  skippedReason: string | null;
};

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function compare(a: { score: number; recallCount: number; lastRecalledAt: string; path: string }, b: { score: number; recallCount: number; lastRecalledAt: string; path: string }): number {
  if (b.score !== a.score) return b.score - a.score;
  if (b.recallCount !== a.recallCount) return b.recallCount - a.recallCount;
  const aMs = Date.parse(a.lastRecalledAt);
  const bMs = Date.parse(b.lastRecalledAt);
  if (Number.isFinite(aMs) || Number.isFinite(bMs)) {
    if (bMs !== aMs) return bMs - aMs;
  }
  return a.path.localeCompare(b.path);
}

async function readFileLines(fullPath: string): Promise<string[] | null> {
  try {
    const raw = await fs.readFile(fullPath, 'utf-8');
    return raw.split(/\r?\n/);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException | undefined)?.code;
    if (code === 'ENOENT') return null;
    throw err;
  }
}

function sliceRange(lines: string[], startLine: number, endLine: number): string {
  const startIdx = Math.max(0, startLine - 1);
  const endIdx = Math.min(lines.length, endLine);
  if (startIdx >= endIdx) return '';
  return lines
    .slice(startIdx, endIdx)
    .map((l) => l.trim())
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 360);
}

function normalizeSnippetForHash(snippet: string): string {
  return snippet
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .toLowerCase()
    .slice(0, 512);
}

function snippetHash(snippet: string): string {
  return createHash('sha1').update(normalizeSnippetForHash(snippet)).digest('hex').slice(0, 12);
}

function extractPromotionMarkers(memoryText: string): { keys: Set<string>; hashes: Set<string> } {
  const keys = new Set<string>();
  const hashes = new Set<string>();
  for (const match of memoryText.matchAll(/<!--\s*xopc-memory-promotion\b([\s\S]*?)-->/gi)) {
    const body = match[1] ?? '';
    const k = body.match(/\bkey\s*=\s*"([^"]+)"/i)?.[1]?.trim();
    const h = body.match(/\bhash\s*=\s*"([^"]+)"/i)?.[1]?.trim();
    if (k) keys.add(k);
    if (h) hashes.add(h);
  }
  for (const match of memoryText.matchAll(/<!--\s*xopc-memory-promotion:([^\n]+?)\s*-->/gi)) {
    const key = match[1]?.trim();
    if (key) keys.add(key);
  }
  return { keys, hashes };
}

function isContaminatedSnippet(snippet: string): boolean {
  const s = snippet.trim();
  if (!s) return true;
  const lower = s.toLowerCase();
  const patterns: RegExp[] = [
    /\b(system|assistant|tool)\s*:/i,
    /<\s*(system|assistant|tool)\b/i,
    /<!--\s*xopc-memory-promotion\b/i,
    /tool_call_id|toolcallid|function_call|arguments\s*:\s*\{/i,
    /"tool"\s*:\s*|\btool_name\b|\btool\b\s*results?/i,
    /you are (an|a)\s+(ai|assistant)|follow these instructions/i,
    /begin\s+(system prompt|instructions)|end\s+(system prompt|instructions)/i,
    /```/i,
    /\b__xopc_/i,
  ];
  if (patterns.some((p) => p.test(s))) return true;
  const braceCount = (s.match(/[{}[\]]/g) ?? []).length;
  if (braceCount >= 12) return true;
  const urlCount = (lower.match(/https?:\/\//g) ?? []).length;
  if (urlCount >= 3) return true;
  return false;
}

// ── Time-decay scoring (aligned with deep-promotion.ts) ────────────────

const MS_PER_DAY = 86_400_000;

function computeRecencyDecay(lastRecalledAtIso: string, nowMs: number, halfLifeDays: number): number {
  const lastMs = Date.parse(lastRecalledAtIso);
  if (!Number.isFinite(lastMs)) return 0;
  const ageDays = Math.max(0, (nowMs - lastMs) / MS_PER_DAY);
  return Math.pow(2, -ageDays / Math.max(1, halfLifeDays));
}

function isExpiredEntry(lastRecalledAtIso: string, nowMs: number, maxAgeDays: number): boolean {
  const lastMs = Date.parse(lastRecalledAtIso);
  if (!Number.isFinite(lastMs)) return true;
  const ageDays = (nowMs - lastMs) / MS_PER_DAY;
  return ageDays > maxAgeDays;
}

function resolveDefaultConfig(overrides?: Partial<DreamingDeepConfig>): DreamingDeepConfig {
  const enabled = overrides?.enabled === true;
  const minScore = typeof overrides?.minScore === 'number' ? overrides.minScore : 0.8;
  const minRecallCount = typeof overrides?.minRecallCount === 'number' ? overrides.minRecallCount : 3;
  const minUniqueQueries = typeof overrides?.minUniqueQueries === 'number' ? overrides.minUniqueQueries : 3;
  const limit = typeof overrides?.limit === 'number' ? overrides.limit : 10;
  const recencyHalfLifeDays = typeof overrides?.recencyHalfLifeDays === 'number' ? overrides.recencyHalfLifeDays : DEFAULT_RECENCY_HALF_LIFE_DAYS;
  const maxAgeDays = typeof overrides?.maxAgeDays === 'number' ? overrides.maxAgeDays : DEFAULT_MAX_AGE_DAYS;
  return {
    enabled,
    cron: typeof overrides?.cron === 'string' ? overrides.cron : '0 3 * * *',
    minScore: clamp01(minScore),
    minRecallCount: Math.max(1, Math.floor(minRecallCount)),
    minUniqueQueries: Math.max(1, Math.floor(minUniqueQueries)),
    limit: Math.max(0, Math.floor(limit)),
    recencyHalfLifeDays: Math.max(1, Math.floor(recencyHalfLifeDays)),
    maxAgeDays: Math.max(1, Math.floor(maxAgeDays)),
  };
}

export async function previewDreamingDeepPromotion(params: {
  workspaceDir: string;
  config?: Partial<DreamingDeepConfig>;
  limit?: number;
  now?: Date;
}): Promise<{ ok: boolean; reason: string; items: PreviewItem[]; memoryPath: string }> {
  const cfg = resolveDefaultConfig(params.config);
  const memoryPath = path.join(params.workspaceDir, MEMORY_MD_FILENAME);
  if (!cfg.enabled) return { ok: true, reason: 'dreaming disabled', items: [], memoryPath };

  const { store } = await loadDreamingStore({ workspaceDir: params.workspaceDir });
  const nowMs = (params.now ?? new Date()).getTime();

  const all = Object.values(store.entries ?? {}).filter((e): e is DreamingStoreEntry => {
    if (!e || typeof e !== 'object') return false;
    if (e.promotedAt) return false;
    if (!e.path || !e.path.startsWith('memory/')) return false;
    if (e.recallCount < cfg.minRecallCount) return false;
    if ((e.queryHashes?.length ?? 0) < cfg.minUniqueQueries) return false;
    if (isExpiredEntry(e.lastRecalledAt, nowMs, cfg.maxAgeDays)) return false;
    const avg = e.recallCount > 0 ? e.totalScore / e.recallCount : 0;
    return clamp01(avg) >= cfg.minScore;
  });

  const ranked = all
    .map((e) => {
      const avgScore = e.recallCount > 0 ? clamp01(e.totalScore / e.recallCount) : 0;
      // Recall-count reinforcement (mild logarithmic boost).
      const reinforcement = clamp01(Math.log1p(e.recallCount) / Math.log1p(10)) * 0.12;
      // Multi-signal bonus: reward entries touched by multiple signal dimensions.
      const signalDiversity =
        (e.recallCount > 0 ? 1 : 0) +
        (e.dailyCount > 0 ? 1 : 0) +
        (e.groundedCount > 0 ? 1 : 0) +
        (e.lightHits > 0 ? 1 : 0);
      const diversityBonus = clamp01(signalDiversity / 4) * 0.08;
      // Time-decay: exponential decay based on recency half-life.
      const recencyDecay = computeRecencyDecay(e.lastRecalledAt, nowMs, cfg.recencyHalfLifeDays);
      // Final score: (base + reinforcement + diversity) * recency decay.
      const rawScore = avgScore + reinforcement + diversityBonus;
      const score = clamp01(rawScore * recencyDecay);
      return { ...e, avgScore, score, recencyDecay };
    })
    .sort(compare);

  const existing = await fs.readFile(memoryPath, 'utf-8').catch((err: unknown) => {
    if ((err as NodeJS.ErrnoException | undefined)?.code === 'ENOENT') return '';
    throw err;
  });
  const markers = extractPromotionMarkers(existing);

  const limit = Math.min(Math.max(params.limit ?? 20, 1), 50);
  const out: PreviewItem[] = [];

  // Scan more than limit so filtering doesn’t yield empty previews.
  const scanCap = Math.min(ranked.length, Math.max(limit * 3, limit));
  for (const candidate of ranked.slice(0, scanCap)) {
    const alreadyPromotedByKey = markers.keys.has(candidate.key);
    if (alreadyPromotedByKey) {
      out.push({
        key: candidate.key,
        hash: '',
        snippet: '',
        path: candidate.path,
        startLine: candidate.startLine,
        endLine: candidate.endLine,
        score: candidate.score,
        avgScore: candidate.avgScore,
        recallCount: candidate.recallCount,
        recencyDecay: candidate.recencyDecay,
        alreadyPromotedByKey: true,
        alreadyPromotedByHash: false,
        skippedReason: 'already promoted (key)',
      });
      continue;
    }

    const fullPath = path.join(params.workspaceDir, candidate.path);
    const lines = await readFileLines(fullPath);
    if (!lines) continue;
    const startLine = Math.max(1, Math.floor(candidate.startLine));
    const endLine = Math.max(startLine, Math.floor(candidate.endLine));
    const snippet = sliceRange(lines, startLine, endLine);
    if (!snippet) continue;
    if (isContaminatedSnippet(snippet)) continue;
    const hash = snippetHash(snippet);
    const alreadyPromotedByHash = markers.hashes.has(hash);
    out.push({
      key: candidate.key,
      hash,
      snippet,
      path: candidate.path,
      startLine,
      endLine,
      score: candidate.score,
      avgScore: candidate.avgScore,
      recallCount: candidate.recallCount,
      recencyDecay: candidate.recencyDecay,
      alreadyPromotedByKey: false,
      alreadyPromotedByHash,
      skippedReason: alreadyPromotedByHash ? 'already promoted (hash)' : null,
    });
    if (out.filter((x) => !x.skippedReason).length >= limit) break;
  }

  return { ok: true, reason: 'ok', items: out, memoryPath };
}

