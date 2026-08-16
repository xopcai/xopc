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
    const intake = getSqliteDatabase().prepare(
      `SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN status = 'proposed' THEN 1 ELSE 0 END) AS proposed,
        SUM(CASE WHEN status = 'confirmed' THEN 1 ELSE 0 END) AS confirmed,
        SUM(CASE WHEN status = 'expired' THEN 1 ELSE 0 END) AS expired,
        SUM(CASE WHEN status = 'confirmed' AND execution_mode = 'run_now' THEN 1 ELSE 0 END) AS run_now,
        SUM(CASE WHEN status = 'confirmed' AND execution_mode = 'create_only' THEN 1 ELSE 0 END) AS create_only,
        SUM(CASE WHEN queue_id IS NOT NULL THEN 1 ELSE 0 END) AS queued,
        SUM(CASE WHEN status = 'confirmed' AND execution_mode = 'run_now' AND queue_id IS NULL THEN 1 ELSE 0 END) AS pending_queue
       FROM work_intakes`,
    ).get() as Record<string, number | null>;
    const outcomes = getSqliteDatabase().prepare(
      `SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN completion_verdict = 'achieved' THEN 1 ELSE 0 END) AS achieved,
        SUM(CASE WHEN completion_verdict = 'partial' THEN 1 ELSE 0 END) AS partial,
        SUM(CASE WHEN completion_verdict = 'not_achieved' THEN 1 ELSE 0 END) AS not_achieved,
        SUM(CASE WHEN completion_verdict_source = 'user' THEN 1 ELSE 0 END) AS user_corrected,
        SUM(CASE WHEN completion_verdict = 'achieved'
                    AND verification_status = 'passed'
                    AND completion_verdict_source != 'user'
                    AND COALESCE(feedback_outcome, 'helpful') != 'not_helpful'
                  THEN 1 ELSE 0 END) AS trusted,
        SUM(CASE WHEN updated_at >= ?
                    AND completion_verdict = 'achieved'
                    AND verification_status = 'passed'
                    AND completion_verdict_source != 'user'
                    AND COALESCE(feedback_outcome, 'helpful') != 'not_helpful'
                  THEN 1 ELSE 0 END) AS weekly_trusted
       FROM execution_receipts
       WHERE status != 'running'
         AND (project_id IS NOT NULL OR goal_id IS NOT NULL OR work_item_id IS NOT NULL)`,
    ).get(weekStart) as Record<string, number | null>;
    const confirmed = count(intake.confirmed);
    const intakeTotal = count(intake.total);
    const runNow = count(intake.run_now);
    const queued = count(intake.queued);
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
      intake: {
        total: intakeTotal,
        proposed: count(intake.proposed),
        confirmed,
        expired: count(intake.expired),
        runNow,
        createOnly: count(intake.create_only),
        queued,
        pendingQueueRecovery: count(intake.pending_queue),
        confirmationRate: ratio(confirmed, intakeTotal),
        queueRate: ratio(queued, runNow),
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
