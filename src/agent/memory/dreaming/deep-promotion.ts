import { createLogger } from '../../../utils/logger.js';
import {
  appendMemorySignal,
  appendMemoryTraceEvent,
  listMemoryRecords,
  listMemorySignals,
  setMemoryRecordStatus,
} from '../../../storage/sqlite/index.js';
import type { DreamingDeepConfig } from './config.js';
import { resolveDeepDefaults } from './utils.js';

const log = createLogger('Dreaming:Deep');
const MEMORY_STORE_URI = 'sqlite://memory_records';

export type { DreamingDeepConfig } from './config.js';

type RankedCandidate = {
  recordId: string;
  score: number;
  recallCount: number;
  uniqueQueries: number;
  content: string;
};

/** Consolidate useful candidates from structured recall and injection signals. */
export async function runDreamingDeepPromotion(params: {
  agentId: string;
  workspaceDir: string;
  config?: Partial<DreamingDeepConfig>;
  sensitiveWritePolicy?: 'deny' | 'confirm' | 'allow';
  promotionWritePolicy?: 'deny' | 'confirm' | 'allow';
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
  const started = Date.now();
  if (!cfg.enabled || cfg.limit === 0) {
    const reason = !cfg.enabled ? 'dreaming disabled' : 'dreaming limit=0';
    trace(params, reason, [], 0, started);
    return { ok: true, reason, candidates: 0, applied: 0, memoryPath: MEMORY_STORE_URI };
  }

  try {
    const cutoff = now.getTime() - cfg.maxAgeDays * 86_400_000;
    const records = listMemoryRecords({
      providerId: 'local',
      workspaceId: params.workspaceDir,
      status: 'candidate',
      limit: 500,
    });
    const signals = listMemorySignals({ workspaceId: params.workspaceDir, limit: 500 });
    const byRecord = new Map<string, typeof signals>();
    for (const signal of signals) {
      if (!signal.recordId || Date.parse(signal.createdAt) < cutoff) continue;
      const group = byRecord.get(signal.recordId) ?? [];
      group.push(signal);
      byRecord.set(signal.recordId, group);
    }

    const ranked: RankedCandidate[] = records.flatMap((record) => {
      if ((record.sensitivity ?? 'normal') !== 'normal' && params.sensitiveWritePolicy !== 'allow') return [];
      const recallSignals = (byRecord.get(record.id) ?? []).filter((signal) =>
        signal.source === 'search_recall' || signal.source === 'context_injection');
      const queries = new Set(recallSignals.map((signal) => String(signal.metadata.query ?? '')).filter(Boolean));
      const avgScore = recallSignals.length
        ? recallSignals.reduce((sum, signal) => sum + (signal.score ?? 0), 0) / recallSignals.length
        : 0;
      const ageDays = Math.max(0, (now.getTime() - Date.parse(record.updatedAt)) / 86_400_000);
      const score = Math.max(0, Math.min(1, avgScore * Math.pow(0.5, ageDays / cfg.recencyHalfLifeDays)));
      if (recallSignals.length < cfg.minRecallCount || queries.size < cfg.minUniqueQueries || score < cfg.minScore) return [];
      return [{ recordId: record.id, score, recallCount: recallSignals.length, uniqueQueries: queries.size, content: record.content }];
    }).sort((left, right) => right.score - left.score).slice(0, cfg.limit);

    const policy = params.promotionWritePolicy ?? 'deny';
    let applied = 0;
    if (policy === 'allow') {
      for (const candidate of ranked) {
        if (!setMemoryRecordStatus(candidate.recordId, 'active', now.getTime())) continue;
        applied += 1;
        appendMemorySignal({
          signal: {
            source: 'dreaming',
            recordId: candidate.recordId,
            score: candidate.score,
            content: candidate.content,
            metadata: { phase: 'deep', recallCount: candidate.recallCount, uniqueQueries: candidate.uniqueQueries },
          },
          providerId: 'local',
          sourceAgentId: params.agentId,
          workspaceId: params.workspaceDir,
        });
      }
    }
    const reason = ranked.length === 0
      ? 'no eligible candidates'
      : policy === 'allow'
        ? 'candidate consolidation complete'
        : policy === 'confirm'
          ? 'candidates retained for user review'
          : 'analysis complete; writes denied by policy';
    trace(params, reason, ranked.map((candidate) => candidate.recordId), applied, started);
    log.info({ workspaceDir: params.workspaceDir, candidates: ranked.length, applied, policy }, 'Dreaming deep consolidation complete');
    return { ok: true, reason, candidates: ranked.length, applied, memoryPath: MEMORY_STORE_URI };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    appendMemoryTraceEvent({
      phase: 'dreaming_deep', providerId: 'local', sourceAgentId: params.agentId,
      request: { workspaceId: params.workspaceDir }, error, durationMs: Date.now() - started,
    });
    log.error({ err, workspaceDir: params.workspaceDir }, `Dreaming deep consolidation failed: ${error}`);
    return { ok: false, reason: error, candidates: 0, applied: 0, memoryPath: MEMORY_STORE_URI };
  }
}

function trace(
  params: { agentId: string; workspaceDir: string }, reason: string,
  selectedRecordIds: string[], applied: number, started: number,
): void {
  appendMemoryTraceEvent({
    phase: 'dreaming_deep', providerId: 'local', sourceAgentId: params.agentId,
    request: { workspaceId: params.workspaceDir, reason, applied },
    resultCount: selectedRecordIds.length, selectedRecordIds, durationMs: Date.now() - started,
  });
}
