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
         SELECT receipt.*, run.task_id,
                ROW_NUMBER() OVER (
                  PARTITION BY run.task_id
                  ORDER BY receipt.finalized_at DESC
                ) AS rank
         FROM task_run_receipts receipt
         JOIN task_runs run ON run.run_id = receipt.run_id
       ), latest_receipts AS (
         SELECT * FROM ranked_receipts WHERE rank = 1
       )
       SELECT
         COUNT(tasks.task_id) AS total,
         SUM(CASE WHEN latest_receipts.completion_verdict = 'achieved' THEN 1 ELSE 0 END) AS achieved,
         SUM(CASE WHEN latest_receipts.completion_verdict = 'partial' THEN 1 ELSE 0 END) AS partial,
         SUM(CASE WHEN latest_receipts.completion_verdict = 'not_achieved' THEN 1 ELSE 0 END) AS not_achieved,
         SUM(CASE WHEN EXISTS (
           SELECT 1 FROM task_run_feedback feedback
           JOIN task_runs feedback_run ON feedback_run.run_id = feedback.run_id
           WHERE feedback_run.task_id = tasks.task_id AND feedback.needs_correction = 1
         ) THEN 1 ELSE 0 END) AS user_corrected,
         SUM(CASE WHEN tasks.phase = 'closed' AND tasks.resolution = 'done'
                    AND latest_receipts.completion_verdict = 'achieved'
                    AND json_extract(latest_receipts.verification_json, '$.status') = 'passed'
                    AND NOT EXISTS (SELECT 1 FROM task_run_feedback feedback
                      WHERE feedback.run_id = latest_receipts.run_id AND feedback.rating = 'not_helpful')
                  THEN 1 ELSE 0 END) AS trusted,
         SUM(CASE WHEN tasks.updated_at >= ?
                    AND tasks.phase = 'closed' AND tasks.resolution = 'done'
                    AND latest_receipts.completion_verdict = 'achieved'
                    AND json_extract(latest_receipts.verification_json, '$.status') = 'passed'
                    AND NOT EXISTS (SELECT 1 FROM task_run_feedback feedback
                      WHERE feedback.run_id = latest_receipts.run_id AND feedback.rating = 'not_helpful')
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
