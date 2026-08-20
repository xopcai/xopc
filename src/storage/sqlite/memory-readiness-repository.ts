import { evaluateMemoryReadiness, type MemoryReadiness } from '../../user-context/memory-readiness.js';
import { getSqliteDatabase } from './transaction.js';

type FeedbackRow = {
  level: 'response' | 'record';
  rating: string;
};

export function getMemoryReadiness(options: {
  agentId: string;
  workspaceId: string;
  windowDays?: number;
  nowMs?: number;
}): MemoryReadiness {
  const nowMs = options.nowMs ?? Date.now();
  const windowDays = Math.max(1, Math.min(90, Math.floor(options.windowDays ?? 30)));
  const sinceMs = nowMs - windowDays * 86_400_000;
  const db = getSqliteDatabase();
  const feedback = db.prepare(
    `SELECT feedback.level, feedback.rating
     FROM memory_feedback AS feedback
     JOIN memory_trace_events AS trace ON trace.trace_id = feedback.trace_id
     WHERE trace.phase IN ('search', 'inject')
       AND trace.source_agent_id = ?
       AND feedback.updated_at >= ?`,
  ).all(options.agentId, sinceMs) as FeedbackRow[];
  const runs = db.prepare(
    `SELECT status FROM dreaming_runs
     WHERE agent_id = ? AND workspace_id = ? AND started_at >= ?
     ORDER BY started_at DESC LIMIT 100`,
  ).all(options.agentId, options.workspaceId, sinceMs) as Array<{ status: string }>;

  const responseFeedback = feedback.filter((item) => item.level === 'response');
  const recordFeedback = feedback.filter((item) => item.level === 'record');
  return evaluateMemoryReadiness({
    evaluatedTurns: responseFeedback.length,
    helpfulTurns: responseFeedback.filter((item) => item.rating === 'helpful').length,
    recordFeedback: recordFeedback.length,
    recordErrors: recordFeedback.filter((item) =>
      item.rating === 'incorrect' || item.rating === 'outdated' || item.rating === 'sensitive').length,
    sensitiveFeedback: recordFeedback.filter((item) => item.rating === 'sensitive').length,
    dreamingRuns: runs.length,
    dreamingFailures: runs.filter((item) => item.status === 'failed').length,
  }, { nowMs });
}
