import {
  appendMemorySignal,
  appendMemoryTraceEvent,
  listMemoryRecords,
  listMemorySignals,
} from '../../../storage/sqlite/index.js';
import type { DreamingLightConfig } from './config.js';

function resolveConfig(overrides?: Partial<DreamingLightConfig>): DreamingLightConfig {
  return {
    enabled: overrides?.enabled === true,
    cron: typeof overrides?.cron === 'string' ? overrides.cron : '0 */6 * * *',
    lookbackDays: Math.max(1, Math.floor(Number(overrides?.lookbackDays) || 2)),
    limit: Math.max(0, Math.floor(Number(overrides?.limit) || 100)),
  };
}

/** Stage recent structured records as consolidation observations. */
export async function runLightSweep(params: {
  workspaceDir: string;
  config?: Partial<DreamingLightConfig>;
  now?: Date;
}): Promise<{
  ok: boolean;
  reason: string;
  scannedEntries: number;
  newSignals: number;
  deduped: number;
}> {
  const cfg = resolveConfig(params.config);
  const now = params.now ?? new Date();
  const started = Date.now();
  if (!cfg.enabled) {
    trace(params.workspaceDir, 'light sweep disabled', 0, [], started);
    return { ok: true, reason: 'light sweep disabled', scannedEntries: 0, newSignals: 0, deduped: 0 };
  }

  try {
    const cutoff = now.getTime() - cfg.lookbackDays * 86_400_000;
    const records = listMemoryRecords({ providerId: 'local', workspaceId: params.workspaceDir, limit: 500 })
      .filter((record) => Date.parse(record.updatedAt) >= cutoff)
      .slice(0, cfg.limit);
    const existing = listMemorySignals({ workspaceId: params.workspaceDir, limit: 500 });
    const staged = new Set(existing.filter((signal) =>
      signal.source === 'dreaming' && signal.metadata.phase === 'light' && Date.parse(signal.createdAt) >= cutoff,
    ).map((signal) => signal.recordId).filter((id): id is string => Boolean(id)));
    let newSignals = 0;
    for (const record of records) {
      if (staged.has(record.id)) continue;
      appendMemorySignal({
        signal: {
          source: 'dreaming',
          recordId: record.id,
          score: record.importance,
          content: record.content,
          metadata: { phase: 'light', recordStatus: record.status ?? 'active' },
        },
        providerId: 'local',
        sourceAgentId: record.provenance.sourceAgentId,
        workspaceId: params.workspaceDir,
      });
      newSignals += 1;
    }
    const deduped = records.length - newSignals;
    trace(params.workspaceDir, 'light sweep complete', newSignals, records.map((record) => record.id), started);
    return { ok: true, reason: 'light sweep complete', scannedEntries: records.length, newSignals, deduped };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    appendMemoryTraceEvent({
      phase: 'dreaming_light', providerId: 'local', request: { workspaceId: params.workspaceDir },
      error: reason, durationMs: Date.now() - started,
    });
    return { ok: false, reason, scannedEntries: 0, newSignals: 0, deduped: 0 };
  }
}

function trace(workspaceId: string, reason: string, resultCount: number, selectedRecordIds: string[], started: number): void {
  appendMemoryTraceEvent({
    phase: 'dreaming_light', providerId: 'local', request: { workspaceId, reason },
    resultCount, selectedRecordIds, durationMs: Date.now() - started,
  });
}
