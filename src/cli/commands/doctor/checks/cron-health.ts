import { loadConfig } from '../../../../config/loader.js';
import type { Config } from '../../../../config/schema.js';
import type { CheckResult, DoctorContext } from '../types.js';

export async function checkCronHealth(ctx: DoctorContext): Promise<CheckResult> {
  let cfg: Config;
  try {
    cfg = loadConfig(ctx.configPath);
  } catch {
    return {
      id: 'cron-health',
      label: 'Cron',
      status: 'skip',
      message: 'Config could not be loaded; skipped.',
      hints: [],
    };
  }

  if (cfg.cron?.enabled === false) {
    return {
      id: 'cron-health',
      label: 'Cron',
      status: 'skip',
      message: 'Cron is disabled in config; skipped.',
      hints: [],
    };
  }

  return {
    id: 'cron-health',
    label: 'Cron',
    status: 'pass',
    message: 'Cron is enabled. Scheduled jobs are stored in SQLite.',
    hints: ['Run: xopc doctor --deep for SQLite integrity checks.'],
  };
}
