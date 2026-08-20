import { listMemoryRecords, listMemorySignals } from '../../../storage/sqlite/index.js';
import type { DreamingDeepConfig } from './config.js';
import { resolveDeepDefaults } from './utils.js';

type PreviewItem = {
  recordId: string;
  content: string;
  score: number;
  avgScore: number;
  recallCount: number;
  uniqueQueries: number;
  recencyDecay: number;
  skippedReason: string | null;
};

export async function previewDreamingDeepPromotion(params: {
  workspaceDir: string;
  config?: Partial<DreamingDeepConfig>;
  limit?: number;
  now?: Date;
}): Promise<{ ok: boolean; reason: string; items: PreviewItem[]; memoryPath: string }> {
  const cfg = resolveDeepDefaults(params.config);
  const memoryPath = 'sqlite://memory_records';
  if (!cfg.enabled) return { ok: true, reason: 'dreaming disabled', items: [], memoryPath };
  const now = params.now ?? new Date();
  const cutoff = now.getTime() - cfg.maxAgeDays * 86_400_000;
  const signals = listMemorySignals({ workspaceId: params.workspaceDir, limit: 500 });
  const limit = Math.min(Math.max(params.limit ?? 20, 1), 50);
  const items = listMemoryRecords({ providerId: 'local', workspaceId: params.workspaceDir, status: 'candidate', limit: 500 })
    .map((record) => {
      const recalls = signals.filter((signal) => signal.recordId === record.id && Date.parse(signal.createdAt) >= cutoff
        && (signal.source === 'search_recall' || signal.source === 'context_injection'));
      const uniqueQueries = new Set(recalls.map((signal) => String(signal.metadata.query ?? '')).filter(Boolean));
      const avgScore = recalls.length ? recalls.reduce((sum, signal) => sum + (signal.score ?? 0), 0) / recalls.length : 0;
      const ageDays = Math.max(0, (now.getTime() - Date.parse(record.updatedAt)) / 86_400_000);
      const recencyDecay = Math.pow(0.5, ageDays / cfg.recencyHalfLifeDays);
      const score = Math.max(0, Math.min(1, avgScore * recencyDecay));
      const skippedReason = recalls.length < cfg.minRecallCount ? 'insufficient recalls'
        : uniqueQueries.size < cfg.minUniqueQueries ? 'insufficient query diversity'
          : score < cfg.minScore ? 'score below threshold' : null;
      return {
        recordId: record.id, content: record.content,
        score, avgScore, recallCount: recalls.length, uniqueQueries: uniqueQueries.size, recencyDecay,
        skippedReason,
      };
    })
    .sort((left, right) => right.score - left.score)
    .slice(0, limit);
  return { ok: true, reason: 'ok', items, memoryPath };
}
