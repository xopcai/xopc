import { existsSync, readFileSync } from 'node:fs';

import { loadConfig } from '../../../../config/loader.js';
import type { Config } from '../../../../config/schema.js';
import { resolveCronDir, resolveCronJobsPath } from '../../../../config/paths.js';
import { JobDataSchema } from '../../../../cron/validation.js';
import type { CheckResult, DoctorContext } from '../types.js';

export async function checkCronHealth(ctx: DoctorContext): Promise<CheckResult> {
  if (!existsSync(ctx.configPath)) {
    return {
      id: 'cron-health',
      label: 'Cron',
      status: 'skip',
      message: 'No config file; skipped.',
      hints: [],
    };
  }

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

  const cronDir = resolveCronDir();
  if (!existsSync(cronDir)) {
    return {
      id: 'cron-health',
      label: 'Cron',
      status: 'warn',
      message: 'Cron directory does not exist.',
      hints: [cronDir, 'Run: xopc init (creates cron directory)'],
    };
  }

  const jobsPath = resolveCronJobsPath();
  if (!existsSync(jobsPath)) {
    return {
      id: 'cron-health',
      label: 'Cron',
      status: 'warn',
      message: 'Cron jobs file is missing.',
      hints: [jobsPath],
    };
  }

  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(jobsPath, 'utf-8'));
  } catch {
    return {
      id: 'cron-health',
      label: 'Cron',
      status: 'warn',
      message: 'Cron jobs file is not valid JSON.',
      hints: [jobsPath],
    };
  }

  if (!raw || typeof raw !== 'object' || !('jobs' in raw) || !Array.isArray((raw as { jobs: unknown }).jobs)) {
    return {
      id: 'cron-health',
      label: 'Cron',
      status: 'warn',
      message: 'Cron jobs file has invalid structure (expected { jobs: [] }).',
      hints: [jobsPath],
    };
  }

  const jobs = (raw as { jobs: unknown[] }).jobs;
  const hints: string[] = [];
  let valid = 0;
  let enabled = 0;
  let scheduleMissing = 0;

  for (const j of jobs) {
    const r = JobDataSchema.safeParse(j);
    if (r.success) {
      valid++;
      if (r.data.enabled) {
        enabled++;
        const sched = r.data.schedule?.trim();
        if (!sched) {
          scheduleMissing++;
          hints.push(`Job "${r.data.name || r.data.id}" is enabled but has no schedule.`);
        }
      }
    } else {
      hints.push('One or more job entries failed validation (check jobs.json).');
      break;
    }
  }

  if (valid !== jobs.length) {
    return {
      id: 'cron-health',
      label: 'Cron',
      status: 'warn',
      message: 'Some cron jobs are invalid or could not be validated.',
      hints: hints.length ? hints.slice(0, 5) : [jobsPath],
    };
  }

  if (scheduleMissing > 0) {
    return {
      id: 'cron-health',
      label: 'Cron',
      status: 'warn',
      message: `${scheduleMissing} enabled job(s) are missing a schedule.`,
      hints: hints.slice(0, 5),
    };
  }

  return {
    id: 'cron-health',
    label: 'Cron',
    status: 'pass',
    message: `Cron jobs file is valid (${enabled} enabled, ${jobs.length} total).`,
    hints: [jobsPath],
  };
}
