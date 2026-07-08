import fs from 'node:fs/promises';
import path from 'node:path';

import type { DreamingDeepConfig } from './config.js';
import { MEMORY_MD_FILENAME } from './constants.js';
import { loadDreamingStore, type DreamingStoreEntry } from './short-term-store.js';
import {
  clamp01,
  compareCandidatesByScore,
  computeCandidateScore,
  extractPromotionMarkers,
  isContaminatedSnippet,
  isExpiredEntry,
  readFileLines,
  resolveDeepDefaults,
  sliceRange,
  snippetHash,
} from './utils.js';

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

export async function previewDreamingDeepPromotion(params: {
  workspaceDir: string;
  dreamingRoot: string;
  config?: Partial<DreamingDeepConfig>;
  limit?: number;
  now?: Date;
}): Promise<{ ok: boolean; reason: string; items: PreviewItem[]; memoryPath: string }> {
  const cfg = resolveDeepDefaults(params.config);
  const memoryPath = path.join(params.dreamingRoot, MEMORY_MD_FILENAME);
  if (!cfg.enabled) return { ok: true, reason: 'dreaming disabled', items: [], memoryPath };

  const { store } = await loadDreamingStore({ dreamingRoot: params.dreamingRoot });
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
      const { avgScore, score, recencyDecay } = computeCandidateScore(e, nowMs, cfg.recencyHalfLifeDays);
      return { ...e, avgScore, score, recencyDecay };
    })
    .sort(compareCandidatesByScore);

  const existing = await fs.readFile(memoryPath, 'utf-8').catch((err: unknown) => {
    if ((err as NodeJS.ErrnoException | undefined)?.code === 'ENOENT') return '';
    throw err;
  });
  const markers = extractPromotionMarkers(existing);

  const limit = Math.min(Math.max(params.limit ?? 20, 1), 50);
  const out: PreviewItem[] = [];

  // Scan more than limit so filtering doesn't yield empty previews.
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
