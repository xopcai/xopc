import { createHash } from 'node:crypto';

import { createLogger } from '../../../utils/logger.js';
import {
  appendMemorySignal,
  appendMemoryTraceEvent,
  getMemoryRecord,
  listMemorySignals,
  recordDreamingDecision,
  type DreamingActiveMode,
} from '../../../storage/sqlite/index.js';
import type { DreamingRemConfig } from './config.js';
import { inferMemorySensitivity } from '../sensitivity.js';
import { activateRemInsight } from './promotion-lifecycle.js';

const log = createLogger('Dreaming:REM');

type RemExecutionConfig = Pick<DreamingRemConfig, 'enabled' | 'lookbackDays' | 'limit' | 'minPatternStrength'>;

function resolveConfig(overrides?: Partial<RemExecutionConfig>): RemExecutionConfig {
  return {
    enabled: overrides?.enabled === true,
    lookbackDays: Math.max(1, Math.floor(Number(overrides?.lookbackDays) || 7)),
    limit: Math.max(0, Math.floor(Number(overrides?.limit) || 10)),
    minPatternStrength: Math.max(0, Math.min(1, Number(overrides?.minPatternStrength) || 0.75)),
  };
}

/** Discover cross-session patterns from structured usage signals. */
export async function runRemPatterns(params: {
  agentId: string;
  runId: string;
  mode: DreamingActiveMode;
  workspaceDir: string;
  config?: Partial<RemExecutionConfig>;
  sensitiveWritePolicy?: 'deny' | 'confirm' | 'allow';
  now?: Date;
}): Promise<{ ok: boolean; reason: string; patternsDiscovered: number; entriesAnalyzed: number }> {
  const cfg = resolveConfig(params.config);
  const now = params.now ?? new Date();
  const started = Date.now();
  if (!cfg.enabled) {
    trace(params, 'REM patterns disabled', [], 0, started);
    return { ok: true, reason: 'REM patterns disabled', patternsDiscovered: 0, entriesAnalyzed: 0 };
  }

  try {
    const cutoff = now.getTime() - cfg.lookbackDays * 86_400_000;
    const signals = listMemorySignals({ workspaceId: params.workspaceDir, limit: 500 }).filter((signal) =>
      signal.recordId && Date.parse(signal.createdAt) >= cutoff
      && (signal.source === 'search_recall' || signal.source === 'context_injection'),
    );
    const groups = new Map<string, Set<string>>();
    for (const signal of signals) {
      const query = String(signal.metadata.query ?? '').trim().toLocaleLowerCase();
      if (!query || !signal.recordId) continue;
      const queryKey = createHash('sha256').update(query).digest('hex').slice(0, 24);
      const group = groups.get(queryKey) ?? new Set<string>();
      group.add(signal.recordId);
      groups.set(queryKey, group);
    }
    const patterns = [...groups.values()]
      .filter((recordIds) => recordIds.size >= 2)
      .map((recordIds) => [...recordIds].map((id) => getMemoryRecord(id)).filter((record) => record != null))
      .filter((records) => records.length >= 2)
      .map((records) => ({
        records,
        strength: Math.min(1, records.length / 4),
      }))
      .filter((pattern) => pattern.strength >= cfg.minPatternStrength)
      .sort((left, right) => right.strength - left.strength)
      .slice(0, cfg.limit);

    // REM creates new inferred beliefs, so even automatic mode requires user review.
    const canPropose = params.mode !== 'observe';
    let written = 0;
    for (const pattern of patterns) {
      const content = pattern.records.map((record) => record.content).join('\n');
      const sensitivity = inferMemorySensitivity(content);
      if (sensitivity !== 'normal' && params.sensitiveWritePolicy !== 'allow') {
        recordDreamingDecision({ runId: params.runId, action: 'skip', reasonCode: 'sensitive_write_blocked', score: pattern.strength });
        continue;
      }
      recordDreamingDecision({
        runId: params.runId,
        action: canPropose ? 'propose' : 'observe',
        reasonCode: 'rem_pattern_threshold_met',
        score: pattern.strength,
        evidence: { memberRecordIds: pattern.records.map((record) => record.id) },
      });
      if (canPropose) {
        const record = activateRemInsight({
          agentId: params.agentId,
          workspaceId: params.workspaceDir,
          memberKeys: pattern.records.map((record) => record.id),
          representative: pattern.records[0]!.content,
          distinctPaths: pattern.records.map((record) => record.id),
          strength: pattern.strength,
          observedAt: now.toISOString(),
          evidence: pattern.records.map((record) => record.content),
          sensitivity,
          status: 'candidate',
        });
        appendMemorySignal({
          signal: { source: 'dreaming', recordId: record.id, score: pattern.strength, content: record.content, metadata: { phase: 'rem' } },
          providerId: 'local', sourceAgentId: params.agentId, workspaceId: params.workspaceDir,
        });
        written += 1;
      }
    }
    const selected = patterns.flatMap((pattern) => pattern.records.map((record) => record.id));
    const reason = patterns.length === 0 ? 'not enough evidence for recurring patterns'
      : canPropose ? 'pattern candidates added for user review' : 'patterns analyzed in observe mode';
    trace(params, reason, selected, written, started);
    log.info({ workspaceDir: params.workspaceDir, patterns: patterns.length, written, canPropose }, 'REM pattern discovery complete');
    return { ok: true, reason, patternsDiscovered: patterns.length, entriesAnalyzed: new Set(signals.map((signal) => signal.recordId)).size };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    appendMemoryTraceEvent({
      phase: 'dreaming_rem', providerId: 'local', sourceAgentId: params.agentId,
      request: { workspaceId: params.workspaceDir }, error: reason, durationMs: Date.now() - started,
    });
    return { ok: false, reason, patternsDiscovered: 0, entriesAnalyzed: 0 };
  }
}

function trace(
  params: { agentId: string; workspaceDir: string }, reason: string,
  selectedRecordIds: string[], written: number, started: number,
): void {
  appendMemoryTraceEvent({
    phase: 'dreaming_rem', providerId: 'local', sourceAgentId: params.agentId,
    request: { workspaceId: params.workspaceDir, reason, written }, resultCount: selectedRecordIds.length,
    selectedRecordIds, durationMs: Date.now() - started,
  });
}
