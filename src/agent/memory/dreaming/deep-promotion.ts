import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';

import { createLogger } from '../../../utils/logger.js';
import { MEMORY_MD_FILENAME } from './constants.js';
import {
  loadDreamingStore,
  saveDreamingStore,
  withDreamingPromotionLock,
  type DreamingStoreEntry,
} from './short-term-store.js';
import { DREAMING_LAST_RUN_RELATIVE } from './constants.js';

const log = createLogger('Dreaming:Deep');

export type DreamingDeepConfig = {
  enabled: boolean;
  minScore: number;
  minRecallCount: number;
  limit: number;
};

export type DreamingPromotionCandidate = DreamingStoreEntry & {
  avgScore: number;
  score: number;
};

function clampScore(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function formatIsoDay(now: Date): string {
  return now.toISOString().slice(0, 10);
}

function compareCandidates(a: DreamingPromotionCandidate, b: DreamingPromotionCandidate): number {
  if (b.score !== a.score) return b.score - a.score;
  if (b.recallCount !== a.recallCount) return b.recallCount - a.recallCount;
  const aMs = Date.parse(a.lastRecalledAt);
  const bMs = Date.parse(b.lastRecalledAt);
  if (Number.isFinite(aMs) || Number.isFinite(bMs)) {
    if (bMs !== aMs) return bMs - aMs;
  }
  return a.path.localeCompare(b.path);
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
  const normalized = normalizeSnippetForHash(snippet);
  return createHash('sha1').update(normalized).digest('hex').slice(0, 12);
}

function markerForPromotion(key: string, hash: string): string {
  // Quote values to allow spaces/colons in key.
  return `<!-- xopc-memory-promotion key="${key}" hash="${hash}" -->`;
}

function extractPromotionMarkers(memoryText: string): { keys: Set<string>; hashes: Set<string> } {
  const keys = new Set<string>();
  const hashes = new Set<string>();

  // New format: <!-- xopc-memory-promotion key="..." hash="..." -->
  for (const match of memoryText.matchAll(/<!--\s*xopc-memory-promotion\b([\s\S]*?)-->/gi)) {
    const body = match[1] ?? '';
    const k = body.match(/\bkey\s*=\s*"([^"]+)"/i)?.[1]?.trim();
    const h = body.match(/\bhash\s*=\s*"([^"]+)"/i)?.[1]?.trim();
    if (k) keys.add(k);
    if (h) hashes.add(h);
  }

  // Legacy format: <!-- xopc-memory-promotion:<key> -->
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

  // Obvious tool/system/prompt artifacts.
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

  // JSON-ish blocks or obvious dumps.
  const braceCount = (s.match(/[{}[\]]/g) ?? []).length;
  if (braceCount >= 12) return true;

  // Very link-heavy / log-like.
  const urlCount = (lower.match(/https?:\/\//g) ?? []).length;
  if (urlCount >= 3) return true;

  return false;
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

async function rehydrateSnippet(params: {
  workspaceDir: string;
  candidate: DreamingPromotionCandidate;
}): Promise<{ snippet: string; startLine: number; endLine: number } | null> {
  const fullPath = path.join(params.workspaceDir, params.candidate.path);
  const lines = await readFileLines(fullPath);
  if (!lines) return null;

  const startLine = Math.max(1, Math.floor(params.candidate.startLine));
  const endLine = Math.max(startLine, Math.floor(params.candidate.endLine));
  const snippet = sliceRange(lines, startLine, endLine);
  if (!snippet) return null;
  return { snippet, startLine, endLine };
}

function resolveDefaultConfig(overrides?: Partial<DreamingDeepConfig>): DreamingDeepConfig {
  const enabled = overrides?.enabled === true;
  const minScore = typeof overrides?.minScore === 'number' ? overrides.minScore : 0.8;
  const minRecallCount =
    typeof overrides?.minRecallCount === 'number' ? overrides.minRecallCount : 3;
  const limit = typeof overrides?.limit === 'number' ? overrides.limit : 10;
  return {
    enabled,
    minScore: clampScore(minScore),
    minRecallCount: Math.max(1, Math.floor(minRecallCount)),
    limit: Math.max(0, Math.floor(limit)),
  };
}

type DreamingLastRun = {
  version: 1;
  runId: string;
  startedAt: string;
  finishedAt: string;
  ok: boolean;
  reason: string;
  config: DreamingDeepConfig;
  candidates: number;
  applied: number;
  memoryPath: string;
  errorMessage?: string;
};

async function writeLastRun(params: { workspaceDir: string; lastRun: DreamingLastRun }): Promise<void> {
  const fullPath = path.join(params.workspaceDir, DREAMING_LAST_RUN_RELATIVE);
  await fs.mkdir(path.dirname(fullPath), { recursive: true });
  const tmp = `${fullPath}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tmp, `${JSON.stringify(params.lastRun, null, 2)}\n`, 'utf-8');
  await fs.rename(tmp, fullPath);
}

export async function runDreamingDeepPromotion(params: {
  workspaceDir: string;
  config?: Partial<DreamingDeepConfig>;
  now?: Date;
}): Promise<{
  ok: boolean;
  reason: string;
  candidates: number;
  applied: number;
  memoryPath: string;
}> {
  const cfg = resolveDefaultConfig(params.config);
  const now = params.now ?? new Date();
  const startedAt = now.toISOString();
  const runId = `${startedAt}:${process.pid}:${Math.random().toString(16).slice(2)}`;
  const memoryPath = path.join(params.workspaceDir, MEMORY_MD_FILENAME);

  if (!cfg.enabled) {
    const finishedAt = new Date().toISOString();
    await writeLastRun({
      workspaceDir: params.workspaceDir,
      lastRun: {
        version: 1,
        runId,
        startedAt,
        finishedAt,
        ok: true,
        reason: 'dreaming mvp disabled',
        config: cfg,
        candidates: 0,
        applied: 0,
        memoryPath,
      },
    }).catch(() => undefined);
    return { ok: true, reason: 'dreaming mvp disabled', candidates: 0, applied: 0, memoryPath };
  }
  if (cfg.limit === 0) {
    const finishedAt = new Date().toISOString();
    await writeLastRun({
      workspaceDir: params.workspaceDir,
      lastRun: {
        version: 1,
        runId,
        startedAt,
        finishedAt,
        ok: true,
        reason: 'dreaming mvp limit=0',
        config: cfg,
        candidates: 0,
        applied: 0,
        memoryPath,
      },
    }).catch(() => undefined);
    return { ok: true, reason: 'dreaming mvp limit=0', candidates: 0, applied: 0, memoryPath };
  }

  try {
    const result = await withDreamingPromotionLock(params.workspaceDir, async () => {
      const { store } = await loadDreamingStore({ workspaceDir: params.workspaceDir });

    const all = Object.values(store.entries ?? {}).filter((e): e is DreamingStoreEntry => {
        if (!e || typeof e !== 'object') return false;
        if (e.promotedAt) return false;
        if (!e.path || !e.path.startsWith('memory/')) return false;
        if (e.recallCount < cfg.minRecallCount) return false;
        const avg = e.recallCount > 0 ? e.totalScore / e.recallCount : 0;
        return clampScore(avg) >= cfg.minScore;
      });

      const ranked: DreamingPromotionCandidate[] = all
        .map((e) => {
          const avgScore = e.recallCount > 0 ? clampScore(e.totalScore / e.recallCount) : 0;
        // Score: avgScore primary, with mild recallCount reinforcement.
          const reinforcement = clampScore(Math.log1p(e.recallCount) / Math.log1p(10)) * 0.12;
          const score = clampScore(avgScore + reinforcement);
          return { ...e, avgScore, score };
        })
        .sort(compareCandidates)
        .slice(0, cfg.limit);

      if (ranked.length === 0) {
        return { ok: true, reason: 'no eligible candidates', candidates: 0, applied: 0, memoryPath };
      }

      const existing = await fs.readFile(memoryPath, 'utf-8').catch((err: unknown) => {
        if ((err as NodeJS.ErrnoException | undefined)?.code === 'ENOENT') return '';
        throw err;
      });
    const existingMarkers = extractPromotionMarkers(existing);

      const appliedCandidates: Array<{
        key: string;
      hash: string;
        snippet: string;
        path: string;
        startLine: number;
        endLine: number;
        score: number;
        recallCount: number;
        avgScore: number;
      }> = [];

      for (const candidate of ranked) {
      if (existingMarkers.keys.has(candidate.key)) {
          // Treat as already applied; mark promotedAt for idempotency and keep going.
          const entry = store.entries[candidate.key];
          if (entry && !entry.promotedAt) {
            entry.promotedAt = now.toISOString();
          }
          continue;
        }
        const rehydrated = await rehydrateSnippet({ workspaceDir: params.workspaceDir, candidate });
        if (!rehydrated) {
          continue;
        }
      if (isContaminatedSnippet(rehydrated.snippet)) {
        continue;
      }
      const hash = snippetHash(rehydrated.snippet);
      if (existingMarkers.hashes.has(hash)) {
        // Already promoted (possibly from a different key/line range). Mark promoted for idempotency.
        const entry = store.entries[candidate.key];
        if (entry && !entry.promotedAt) {
          entry.promotedAt = now.toISOString();
        }
        continue;
      }
        appliedCandidates.push({
          key: candidate.key,
        hash,
          snippet: rehydrated.snippet,
          path: candidate.path,
          startLine: rehydrated.startLine,
          endLine: rehydrated.endLine,
          score: candidate.score,
          recallCount: candidate.recallCount,
          avgScore: candidate.avgScore,
        });
      }

      if (appliedCandidates.length === 0) {
        await saveDreamingStore({ workspaceDir: params.workspaceDir, store });
        return {
          ok: true,
          reason: 'candidates were stale or already applied',
          candidates: ranked.length,
          applied: 0,
          memoryPath,
        };
      }

      const day = formatIsoDay(now);
      const header = existing.trim().length > 0 ? '' : '# Long-Term Memory\n\n';
      const sectionLines: string[] = ['', `## Promoted From Short-Term Memory (${day})`, ''];
      for (const c of appliedCandidates) {
        const src = `${c.path}:${c.startLine}-${c.endLine}`;
      sectionLines.push(markerForPromotion(c.key, c.hash));
        sectionLines.push(
          `- ${c.snippet} [score=${c.score.toFixed(3)} recalls=${c.recallCount} avg=${c.avgScore.toFixed(3)} source=${src}]`,
        );
      }
      sectionLines.push('');

      const next = `${header}${existing.endsWith('\n') || existing.length === 0 ? existing : `${existing}\n`}${sectionLines.join('\n')}`;
      await fs.writeFile(memoryPath, next, 'utf-8');

      const nowIso = now.toISOString();
      for (const c of appliedCandidates) {
        const entry = store.entries[c.key];
        if (entry) {
          entry.promotedAt = nowIso;
          entry.snippet = c.snippet;
          entry.startLine = c.startLine;
          entry.endLine = c.endLine;
        }
      }
      store.updatedAt = nowIso;
      await saveDreamingStore({ workspaceDir: params.workspaceDir, store });

      log.info(
        { workspaceDir: params.workspaceDir, candidates: ranked.length, applied: appliedCandidates.length },
        'Dreaming deep promotion complete',
      );

      return {
        ok: true,
        reason: 'applied promotions',
        candidates: ranked.length,
        applied: appliedCandidates.length,
        memoryPath,
      };
    });

    const finishedAt = new Date().toISOString();
    await writeLastRun({
      workspaceDir: params.workspaceDir,
      lastRun: {
        version: 1,
        runId,
        startedAt,
        finishedAt,
        ok: result.ok,
        reason: result.reason,
        config: cfg,
        candidates: result.candidates,
        applied: result.applied,
        memoryPath: result.memoryPath,
      },
    }).catch(() => undefined);

    return result;
  } catch (err) {
    const finishedAt = new Date().toISOString();
    const em = err instanceof Error ? err.message : String(err);
    await writeLastRun({
      workspaceDir: params.workspaceDir,
      lastRun: {
        version: 1,
        runId,
        startedAt,
        finishedAt,
        ok: false,
        reason: 'error',
        config: cfg,
        candidates: 0,
        applied: 0,
        memoryPath,
        errorMessage: em,
      },
    }).catch(() => undefined);
    throw err;
  }
}

