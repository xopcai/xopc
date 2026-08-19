import type { WorkValueMetrics } from '@xopcai/gateway-contract';

import { getSqliteDatabase } from '../storage/sqlite/index.js';

function ratio(numerator: number, denominator: number): number {
  return denominator > 0 ? numerator / denominator : 0;
}

function count(value: number | null | undefined): number {
  return Number(value ?? 0);
}

export class WorkValueMetricsService {
  get(): WorkValueMetrics {
    const weekStart = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const outcomes = getSqliteDatabase().prepare(
      `WITH ranked_receipts AS (
         SELECT execution_receipts.*,
                ROW_NUMBER() OVER (
                  PARTITION BY outcome_id
                  ORDER BY COALESCE(completed_at, updated_at) DESC, started_at DESC
                ) AS rank
         FROM execution_receipts
         WHERE outcome_id IS NOT NULL AND status != 'running'
       ), latest_receipts AS (
         SELECT * FROM ranked_receipts WHERE rank = 1
       )
       SELECT
         COUNT(outcomes.outcome_id) AS total,
         SUM(CASE WHEN latest_receipts.completion_verdict = 'achieved' THEN 1 ELSE 0 END) AS achieved,
         SUM(CASE WHEN latest_receipts.completion_verdict = 'partial' THEN 1 ELSE 0 END) AS partial,
         SUM(CASE WHEN latest_receipts.completion_verdict = 'not_achieved' THEN 1 ELSE 0 END) AS not_achieved,
         SUM(CASE WHEN EXISTS (
           SELECT 1 FROM execution_receipts correction
           WHERE correction.outcome_id = outcomes.outcome_id
             AND correction.completion_verdict_source = 'user'
         ) THEN 1 ELSE 0 END) AS user_corrected,
         SUM(CASE WHEN outcomes.internal_status = 'completed'
                    AND latest_receipts.completion_verdict = 'achieved'
                    AND latest_receipts.verification_status = 'passed'
                    AND latest_receipts.completion_verdict_source != 'user'
                    AND COALESCE(latest_receipts.feedback_outcome, 'helpful') != 'not_helpful'
                  THEN 1 ELSE 0 END) AS trusted,
         SUM(CASE WHEN outcomes.updated_at >= ?
                    AND outcomes.internal_status = 'completed'
                    AND latest_receipts.completion_verdict = 'achieved'
                    AND latest_receipts.verification_status = 'passed'
                    AND latest_receipts.completion_verdict_source != 'user'
                    AND COALESCE(latest_receipts.feedback_outcome, 'helpful') != 'not_helpful'
                  THEN 1 ELSE 0 END) AS weekly_trusted
       FROM outcomes
       LEFT JOIN latest_receipts ON latest_receipts.outcome_id = outcomes.outcome_id`,
    ).get(weekStart) as Record<string, number | null>;
    const outcomeTotal = count(outcomes.total);
    const achieved = count(outcomes.achieved);
    const userCorrected = count(outcomes.user_corrected);
    const trusted = count(outcomes.trusted);
    const weeklyTrustedProgress = count(outcomes.weekly_trusted);
    const hasWeeklyActivity = getSqliteDatabase().prepare(
      `SELECT 1 FROM sessions
       WHERE COALESCE(last_interaction_at, updated_at) >= ?
       LIMIT 1`,
    ).get(weekStart) !== undefined;
    const weeklyActiveUsers = hasWeeklyActivity ? 1 : 0;
    return {
      northStar: {
        weeklyTrustedProgress,
        weeklyActiveUsers,
        trustedProgressPerWeeklyActiveUser: ratio(weeklyTrustedProgress, weeklyActiveUsers),
      },
      outcomes: {
        total: outcomeTotal,
        achieved,
        partial: count(outcomes.partial),
        notAchieved: count(outcomes.not_achieved),
        userCorrected,
        achievementRate: ratio(achieved, outcomeTotal),
        correctionRate: ratio(userCorrected, outcomeTotal),
        trusted,
        trustedRate: ratio(trusted, outcomeTotal),
      },
    };
  }
}
