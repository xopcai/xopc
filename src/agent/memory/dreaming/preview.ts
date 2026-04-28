import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';

import type { DreamingDeepConfig } from './deep-promotion.js';
import { loadDreamingStore, type DreamingStoreEntry } from './short-term-store.js';
import { MEMORY_MD_FILENAME } from './constants.js';

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

function resolveDefaultConfig(overrides?: Partial<DreamingDeepConfig>): DreamingDeepConfig {
  const enabled = overrides?.enabled === true;
  const minScore = typeof overrides?.minScore === 'number' ? overrides.minScore : 0.8;
  const minRecallCount = typeof overrides?.minRecallCount === 'number' ? overrides.minRecallCount : 3;
  const limit = typeof overrides?.limit === 'number' ? overrides.limit : 10;
  return {
    enabled,
    minScore: clamp01(minScore),
    minRecallCount: Math.max(1, Math.floor(minRecallCount)),
    limit: Math.max(0, Math.floor(limit)),
  };
}

export async function previewDreamingDeepPromotion(params: {
  workspaceDir: string;
  config?: Partial<DreamingDeepConfig>;
  limit?: number;
}): Promise<{ ok: boolean; reason: string; items: PreviewItem[]; memoryPath: string }> {
  const cfg = resolveDefaultConfig(params.config);
  const memoryPath = path.join(params.workspaceDir, MEMORY_MD_FILENAME);
  if (!cfg.enabled) return { ok: true, reason: 'dreaming disabled', items: [], memoryPath };

  const { store } = await loadDreamingStore({ workspaceDir: params.workspaceDir });
  const all = Object.values(store.entries ?? {}).filter((e): e is DreamingStoreEntry => {
    if (!e || typeof e !== 'object') return false;
    if (e.promotedAt) return false;
    if (!e.path || !e.path.startsWith('memory/')) return false;
    if (e.recallCount < cfg.minRecallCount) return false;
    const avg = e.recallCount > 0 ? e.totalScore / e.recallCount : 0;
    return clamp01(avg) >= cfg.minScore;
  });

  const ranked = all
    .map((e) => {
      const avgScore = e.recallCount > 0 ? clamp01(e.totalScore / e.recallCount) : 0;
      const reinforcement = clamp01(Math.log1p(e.recallCount) / Math.log1p(10)) * 0.12;
      const score = clamp01(avgScore + reinforcement);
      return { ...e, avgScore, score };
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
      alreadyPromotedByKey: false,
      alreadyPromotedByHash,
      skippedReason: alreadyPromotedByHash ? 'already promoted (hash)' : null,
    });
    if (out.filter((x) => !x.skippedReason).length >= limit) break;
  }

  return { ok: true, reason: 'ok', items: out, memoryPath };
}

