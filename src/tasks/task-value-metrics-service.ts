import type { TaskValueMetrics } from '@xopcai/gateway-contract';

import { getSqliteDatabase } from '../storage/sqlite/index.js';

function ratio(numerator: number, denominator: number): number {
  return denominator > 0 ? numerator / denominator : 0;
}

function count(value: number | null | undefined): number {
  return Number(value ?? 0);
}

export class TaskValueMetricsService {
  get(): TaskValueMetrics {
    const weekStart = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const tasks = getSqliteDatabase().prepare(
      `WITH ranked_receipts AS (
         SELECT execution_receipts.*,
                ROW_NUMBER() OVER (
                  PARTITION BY task_id
                  ORDER BY COALESCE(completed_at, updated_at) DESC, started_at DESC
                ) AS rank
         FROM execution_receipts
         WHERE task_id IS NOT NULL AND status != 'running'
       ), latest_receipts AS (
         SELECT * FROM ranked_receipts WHERE rank = 1
       )
       SELECT
         COUNT(tasks.task_id) AS total,
         SUM(CASE WHEN latest_receipts.completion_verdict = 'achieved' THEN 1 ELSE 0 END) AS achieved,
         SUM(CASE WHEN latest_receipts.completion_verdict = 'partial' THEN 1 ELSE 0 END) AS partial,
         SUM(CASE WHEN latest_receipts.completion_verdict = 'not_achieved' THEN 1 ELSE 0 END) AS not_achieved,
         SUM(CASE WHEN EXISTS (
           SELECT 1 FROM execution_receipts correction
           WHERE correction.task_id = tasks.task_id
             AND correction.completion_verdict_source = 'user'
         ) THEN 1 ELSE 0 END) AS user_corrected,
         SUM(CASE WHEN tasks.status = 'completed'
                    AND latest_receipts.completion_verdict = 'achieved'
                    AND latest_receipts.verification_status = 'passed'
                    AND latest_receipts.completion_verdict_source != 'user'
                    AND COALESCE(latest_receipts.feedback_rating, 'helpful') != 'not_helpful'
                  THEN 1 ELSE 0 END) AS trusted,
         SUM(CASE WHEN tasks.updated_at >= ?
                    AND tasks.status = 'completed'
                    AND latest_receipts.completion_verdict = 'achieved'
                    AND latest_receipts.verification_status = 'passed'
                    AND latest_receipts.completion_verdict_source != 'user'
                    AND COALESCE(latest_receipts.feedback_rating, 'helpful') != 'not_helpful'
                  THEN 1 ELSE 0 END) AS weekly_trusted
       FROM tasks
       LEFT JOIN latest_receipts ON latest_receipts.task_id = tasks.task_id`,
    ).get(weekStart) as Record<string, number | null>;
    const taskTotal = count(tasks.total);
    const achieved = count(tasks.achieved);
    const userCorrected = count(tasks.user_corrected);
    const trusted = count(tasks.trusted);
    const weeklyTrustedProgress = count(tasks.weekly_trusted);
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
      tasks: {
        total: taskTotal,
        achieved,
        partial: count(tasks.partial),
        notAchieved: count(tasks.not_achieved),
        userCorrected,
        achievementRate: ratio(achieved, taskTotal),
        correctionRate: ratio(userCorrected, taskTotal),
        trusted,
        trustedRate: ratio(trusted, taskTotal),
      },
    };
  }
}
