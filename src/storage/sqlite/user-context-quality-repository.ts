import { USER_CONTEXT_PRINCIPAL_ID } from '../../user-context/domain.js';
import { getSqliteDatabase } from './transaction.js';

export type UserUnderstandingQualityMetrics = {
  windowDays: number;
  since: string;
  records: {
    total: number;
    candidate: number;
    active: number;
    rejected: number;
    needsReview: number;
    stale: number;
    archived: number;
    agingCandidates: number;
    explicit: number;
    inferred: number;
    averageConfidence: number | null;
  };
  decisions: { total: number; acceptanceRate: number | null };
  recall: {
    total: number;
    helpful: number;
    notHelpful: number;
    mixed: number;
    irrelevant: number;
    helpfulRate: number | null;
  };
  quickUnderstanding: {
    sourcesAuthorized: number;
    sourcesCollected: number;
    sourceCoverage: number | null;
    bootstrapJobs: number;
    successfulBootstrapRate: number | null;
    medianBootstrapDurationMs: number | null;
  };
};

export type UnderstandingFeedbackSummary = {
  understandingId: string;
  helpful: number;
  irrelevant: number;
  total: number;
};

export function summarizeUnderstandingFeedback(understandingIds: string[]): UnderstandingFeedbackSummary[] {
  const ids = [...new Set(understandingIds.filter(Boolean))].slice(0, 1_000);
  if (!ids.length) return [];
  const rows = getSqliteDatabase().prepare(`
    SELECT object_id, rating, COUNT(*) AS count
    FROM context_feedback
    WHERE object_type = 'understanding' AND object_id IN (${ids.map(() => '?').join(', ')})
    GROUP BY object_id, rating
  `).all(...ids) as Array<{ object_id: string; rating: string; count: number }>;
  const summaries = new Map<string, UnderstandingFeedbackSummary>();
  for (const row of rows) {
    const current = summaries.get(row.object_id) ?? {
      understandingId: row.object_id, helpful: 0, irrelevant: 0, total: 0,
    };
    if (row.rating === 'helpful') current.helpful += row.count;
    if (row.rating === 'irrelevant') current.irrelevant += row.count;
    current.total += row.count;
    summaries.set(row.object_id, current);
  }
  return [...summaries.values()];
}

function rate(numerator: number, denominator: number): number | null {
  return denominator > 0 ? Math.round((numerator / denominator) * 10_000) / 10_000 : null;
}

function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = values.toSorted((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]!
    : Math.round((sorted[middle - 1]! + sorted[middle]!) / 2);
}

export function summarizeUserUnderstandingQuality(options: {
  windowDays?: number;
  agingCandidateDays?: number;
  nowMs?: number;
} = {}): UserUnderstandingQualityMetrics {
  const nowMs = options.nowMs ?? Date.now();
  const windowDays = Math.max(1, Math.min(365, Math.floor(options.windowDays ?? 30)));
  const sinceMs = nowMs - windowDays * 86_400_000;
  const agingDays = Math.max(1, Math.min(windowDays, Math.floor(options.agingCandidateDays ?? 7)));
  const agingCutoff = nowMs - agingDays * 86_400_000;
  const db = getSqliteDatabase();
  const rows = db.prepare(`SELECT status, explicitness, confidence, created_at, updated_at
    FROM user_understandings WHERE principal_id = ?`).all(USER_CONTEXT_PRINCIPAL_ID) as Array<{
      status: string; explicitness: string; confidence: number; created_at: number; updated_at: number;
    }>;
  const records: UserUnderstandingQualityMetrics['records'] = {
    total: rows.length, candidate: 0, active: 0, rejected: 0, needsReview: 0,
    stale: 0, archived: 0, agingCandidates: 0, explicit: 0, inferred: 0,
    averageConfidence: rows.length
      ? Math.round((rows.reduce((sum, row) => sum + row.confidence, 0) / rows.length) * 10_000) / 10_000
      : null,
  };
  for (const row of rows) {
    if (row.status === 'candidate') records.candidate += 1;
    if (row.status === 'active') records.active += 1;
    if (row.status === 'rejected') records.rejected += 1;
    if (row.status === 'needs_review') records.needsReview += 1;
    if (row.status === 'stale') records.stale += 1;
    if (row.status === 'archived') records.archived += 1;
    if (row.status === 'candidate' && row.created_at <= agingCutoff) records.agingCandidates += 1;
    if (row.explicitness === 'explicit') records.explicit += 1;
    if (row.explicitness === 'inferred') records.inferred += 1;
  }
  const recentDecisions = rows.filter((row) =>
    (row.status === 'active' || row.status === 'rejected') && row.updated_at >= sinceMs);
  const accepted = recentDecisions.filter((row) => row.status === 'active').length;
  const feedback = db.prepare(`SELECT DISTINCT f.feedback_id, f.rating
    FROM context_feedback f
    JOIN context_runs r ON r.context_run_id = f.context_run_id
    WHERE f.created_at >= ? AND EXISTS (
      SELECT 1 FROM context_run_items i
      WHERE i.context_run_id = r.context_run_id
        AND i.object_type = 'understanding' AND i.decision = 'selected'
    )`).all(sinceMs) as Array<{ feedback_id: string; rating: string }>;
  const recall: UserUnderstandingQualityMetrics['recall'] = {
    total: feedback.length,
    helpful: feedback.filter((row) => row.rating === 'helpful').length,
    notHelpful: feedback.filter((row) => ['wrong', 'stale', 'sensitive'].includes(row.rating)).length,
    mixed: 0,
    irrelevant: feedback.filter((row) => row.rating === 'irrelevant').length,
    helpfulRate: null,
  };
  recall.helpfulRate = rate(recall.helpful, recall.total);
  const sourceRows = db.prepare(`SELECT last_collected_at
    FROM understanding_source_grants WHERE status = 'active'`).all() as Array<{ last_collected_at: number | null }>;
  const bootstrapRows = db.prepare(`SELECT status, started_at, finished_at
    FROM connector_learning_jobs WHERE mode = 'bootstrap' AND created_at >= ?`)
    .all(sinceMs) as Array<{ status: string; started_at: number | null; finished_at: number | null }>;
  const completedBootstraps = bootstrapRows.filter((row) => row.status === 'completed');
  const bootstrapDurations = completedBootstraps.flatMap((row) => (
    row.started_at !== null && row.finished_at !== null && row.finished_at >= row.started_at
      ? [row.finished_at - row.started_at]
      : []
  ));
  return {
    windowDays,
    since: new Date(sinceMs).toISOString(),
    records,
    decisions: { total: recentDecisions.length, acceptanceRate: rate(accepted, recentDecisions.length) },
    recall,
    quickUnderstanding: {
      sourcesAuthorized: sourceRows.length,
      sourcesCollected: sourceRows.filter((row) => row.last_collected_at !== null).length,
      sourceCoverage: rate(sourceRows.filter((row) => row.last_collected_at !== null).length, sourceRows.length),
      bootstrapJobs: bootstrapRows.length,
      successfulBootstrapRate: rate(completedBootstraps.length, bootstrapRows.length),
      medianBootstrapDurationMs: median(bootstrapDurations),
    },
  };
}
