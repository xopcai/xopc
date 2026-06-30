import fs from 'node:fs/promises';
import path from 'node:path';

import { createLogger } from '../../../utils/logger.js';
import { MEMORY_MD_FILENAME } from './constants.js';
import {
  loadDreamingStore,
  saveDreamingStore,
  withDreamingPromotionLock,
  type DreamingStoreEntry,
} from './short-term-store.js';
import {
  DREAMING_LAST_RUN_FORMAT_VERSION,
  emptyDeepPhaseSkipped,
  writeDreamingDeepLastRun,
  type DreamingDeepLastRun,
  type DreamingDeepPhaseSkipped,
} from './last-run.js';
import type { DreamingDeepConfig } from './config.js';
import type { MemoryManager } from '../manager.js';
import {
  clamp01,
  compareCandidatesByScore,
  computeCandidateScore,
  extractPromotionMarkers,
  isContaminatedSnippet,
  isExpiredEntry,
  isoDay,
  readFileLines,
  resolveDeepDefaults,
  sliceRange,
  snippetHash,
} from './utils.js';

const log = createLogger('Dreaming:Deep');

export type { DreamingDeepConfig } from './config.js';

export type DreamingPromotionCandidate = DreamingStoreEntry & {
  avgScore: number;
  /** Time-decay-adjusted final score used for ranking. */
  score: number;
  /** Raw recency decay multiplier (0–1). */
  recencyDecay: number;
};


function markerForPromotion(key: string, hash: string): string {
  // Quote values to allow spaces/colons in key.
  return `<!-- xopc-memory-promotion key="${key}" hash="${hash}" -->`;
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


function buildDeepLastRun(base: {
  runId: string;
  startedAt: string;
  finishedAt: string;
  t0: number;
  ok: boolean;
  reason: string;
  config: DreamingDeepConfig;
  memoryPath: string;
  errorMessage?: string;
  deep: DreamingDeepLastRun['deep'];
}): DreamingDeepLastRun {
  const durationMs = Math.max(0, Date.now() - base.t0);
  return {
    version: DREAMING_LAST_RUN_FORMAT_VERSION,
    phase: 'deep',
    runId: base.runId,
    startedAt: base.startedAt,
    finishedAt: base.finishedAt,
    durationMs,
    ok: base.ok,
    reason: base.reason,
    config: base.config,
    memoryPath: base.memoryPath,
    ...(base.errorMessage ? { errorMessage: base.errorMessage } : {}),
    deep: base.deep,
  };
}

export async function runDreamingDeepPromotion(params: {
  workspaceDir: string;
  config?: Partial<DreamingDeepConfig>;
  memoryManager?: MemoryManager;
  now?: Date;
}): Promise<{
  ok: boolean;
  reason: string;
  candidates: number;
  applied: number;
  memoryPath: string;
}> {
  const cfg = resolveDeepDefaults(params.config);
  const now = params.now ?? new Date();
  const startedAt = now.toISOString();
  const runId = `${startedAt}:${process.pid}:${Math.random().toString(16).slice(2)}`;
  const memoryPath = path.join(params.workspaceDir, MEMORY_MD_FILENAME);
  const t0 = Date.now();

  // Early exit for disabled or zero-limit configurations.
  const earlyExitReason = !cfg.enabled ? 'dreaming disabled' : cfg.limit === 0 ? 'dreaming limit=0' : null;
  if (earlyExitReason) {
    const finishedAt = new Date().toISOString();
    const empty = emptyDeepPhaseSkipped();
    await writeDreamingDeepLastRun({
      workspaceDir: params.workspaceDir,
      lastRun: buildDeepLastRun({
        runId,
        startedAt,
        finishedAt,
        t0,
        ok: true,
        reason: earlyExitReason,
        config: cfg,
        memoryPath,
        deep: { candidatesRanked: 0, applied: 0, skipped: empty },
      }),
    }).catch(() => undefined);
    return { ok: true, reason: earlyExitReason, candidates: 0, applied: 0, memoryPath };
  }

  try {
    const result = await withDreamingPromotionLock(params.workspaceDir, async () => {
      const { store } = await loadDreamingStore({ workspaceDir: params.workspaceDir });

      const nowMs = now.getTime();

      const all = Object.values(store.entries ?? {}).filter((e): e is DreamingStoreEntry => {
        if (!e || typeof e !== 'object') return false;
        if (e.promotedAt) return false;
        if (!e.path || !e.path.startsWith('memory/')) return false;
        if (e.recallCount < cfg.minRecallCount) return false;
        // Require minimum unique queries to avoid single-query inflation.
        if ((e.queryHashes?.length ?? 0) < cfg.minUniqueQueries) return false;
        // Expire entries older than maxAgeDays since last recall.
        if (isExpiredEntry(e.lastRecalledAt, nowMs, cfg.maxAgeDays)) return false;
        const avg = e.recallCount > 0 ? e.totalScore / e.recallCount : 0;
        return clamp01(avg) >= cfg.minScore;
      });

      const ranked: DreamingPromotionCandidate[] = all
        .map((e) => {
          const { avgScore, score, recencyDecay } = computeCandidateScore(e, nowMs, cfg.recencyHalfLifeDays);
          return { ...e, avgScore, score, recencyDecay };
        })
        .sort(compareCandidatesByScore)
        .slice(0, cfg.limit);

      if (ranked.length === 0) {
        const z = emptyDeepPhaseSkipped();
        return { ok: true, reason: 'no eligible candidates', candidates: 0, applied: 0, memoryPath, skipped: z };
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

      const skipped: DreamingDeepPhaseSkipped = emptyDeepPhaseSkipped();
      for (const candidate of ranked) {
        if (existingMarkers.keys.has(candidate.key)) {
          skipped.alreadyPromotedKey += 1;
          // Treat as already applied; mark promotedAt for idempotency and keep going.
          const entry = store.entries[candidate.key];
          if (entry && !entry.promotedAt) {
            entry.promotedAt = now.toISOString();
          }
          continue;
        }
        const rehydrated = await rehydrateSnippet({ workspaceDir: params.workspaceDir, candidate });
        if (!rehydrated) {
          skipped.rehydrateFailed += 1;
          continue;
        }
        if (isContaminatedSnippet(rehydrated.snippet)) {
          skipped.contaminated += 1;
          continue;
        }
        const hash = snippetHash(rehydrated.snippet);
        if (existingMarkers.hashes.has(hash)) {
          skipped.hashDuplicate += 1;
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
          skipped,
        };
      }

      const day = isoDay(now);
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
        const writeResult = await params.memoryManager?.write({
          kind: 'derived_insight',
          content: c.snippet,
          source: {
            provider: 'dreaming',
            path: c.path,
            lineStart: c.startLine,
            lineEnd: c.endLine,
          },
          tags: ['dreaming', 'promoted'],
        });
        params.memoryManager?.recordSignal({
          source: 'dreaming',
          recordId: writeResult?.record?.id,
          score: c.score,
          content: c.snippet,
          metadata: {
            path: c.path,
            startLine: c.startLine,
            endLine: c.endLine,
            recallCount: c.recallCount,
            avgScore: c.avgScore,
          },
        });
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
        skipped,
      };
    });

    const finishedAt = new Date().toISOString();
    const empty = emptyDeepPhaseSkipped();
    const resultSkipped = 'skipped' in result ? result.skipped : empty;
    await writeDreamingDeepLastRun({
      workspaceDir: params.workspaceDir,
      lastRun: buildDeepLastRun({
        runId,
        startedAt,
        finishedAt,
        t0,
        ok: result.ok,
        reason: result.reason,
        config: cfg,
        memoryPath: result.memoryPath,
        deep: {
          candidatesRanked: result.candidates,
          applied: result.applied,
          skipped: resultSkipped,
        },
      }),
    }).catch(() => undefined);

    return {
      ok: result.ok,
      reason: result.reason,
      candidates: result.candidates,
      applied: result.applied,
      memoryPath: result.memoryPath,
    };
  } catch (err) {
    const finishedAt = new Date().toISOString();
    const em = err instanceof Error ? err.message : String(err);
    const z = emptyDeepPhaseSkipped();
    await writeDreamingDeepLastRun({
      workspaceDir: params.workspaceDir,
      lastRun: buildDeepLastRun({
        runId,
        startedAt,
        finishedAt,
        t0,
        ok: false,
        reason: 'error',
        config: cfg,
        memoryPath,
        errorMessage: em,
        deep: { candidatesRanked: 0, applied: 0, skipped: z },
      }),
    }).catch(() => undefined);
    throw err;
  }
}
