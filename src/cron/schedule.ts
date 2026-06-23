import crypto from 'node:crypto';

import { CronExpressionParser } from 'cron-parser';

import type { CronSchedule, JobData } from './types.js';

const MAX_TIMER_DELAY_MS = 2_147_483_647;
export const DEFAULT_TOP_OF_HOUR_STAGGER_MS = 5 * 60_000;

export function normalizeCronStaggerMs(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    return undefined;
  }
  return Math.floor(value);
}

export function isRecurringTopOfHourCronExpr(expr: string): boolean {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) return false;
  return parts[0] === '0' && parts[1] !== '*' && parts[2] === '*' && parts[3] === '*' && parts[4] === '*';
}

export function resolveDefaultCronStaggerMs(expr: string): number | undefined {
  return isRecurringTopOfHourCronExpr(expr) ? DEFAULT_TOP_OF_HOUR_STAGGER_MS : undefined;
}

export function resolveCronStaggerMs(schedule: CronSchedule): number {
  if (schedule.kind !== 'cron') return 0;
  const explicit = normalizeCronStaggerMs(schedule.staggerMs);
  if (explicit !== undefined) return explicit;
  return resolveDefaultCronStaggerMs(schedule.expr) ?? 0;
}

function stableOffsetMs(jobId: string, windowMs: number): number {
  if (windowMs <= 1) return 0;
  const digest = crypto.createHash('sha256').update(jobId).digest();
  return digest.readUInt32BE(0) % windowMs;
}

function parseAtMs(at: string): number {
  const ms = Date.parse(at);
  if (!Number.isFinite(ms)) {
    throw new Error(`Invalid at schedule timestamp: ${at}`);
  }
  return ms;
}

function parseCron(schedule: Extract<CronSchedule, { kind: 'cron' }>, currentDate: Date) {
  return CronExpressionParser.parse(schedule.expr, {
    currentDate,
    ...(schedule.tz ? { tz: schedule.tz } : {}),
  });
}

export function computeNextRunAtMs(job: Pick<JobData, 'id' | 'enabled' | 'schedule'>, nowMs = Date.now()): number | undefined {
  if (!job.enabled) return undefined;
  const schedule = job.schedule;
  if (schedule.kind === 'at') {
    const atMs = parseAtMs(schedule.at);
    return atMs >= nowMs ? atMs : undefined;
  }
  if (schedule.kind === 'every') {
    const everyMs = Math.max(1, Math.floor(schedule.everyMs));
    const anchorMs = Math.max(0, Math.floor(schedule.anchorMs ?? nowMs));
    if (anchorMs >= nowMs) return anchorMs;
    const elapsed = nowMs - anchorMs;
    return anchorMs + (Math.floor(elapsed / everyMs) + 1) * everyMs;
  }

  const staggerMs = resolveCronStaggerMs(schedule);
  const offsetMs = stableOffsetMs(job.id, staggerMs);
  const interval = parseCron(schedule, new Date(Math.max(0, nowMs - offsetMs)));
  return interval.next().getTime() + offsetMs;
}

export function computePreviousRunAtMs(job: Pick<JobData, 'id' | 'schedule'>, nowMs = Date.now()): number | undefined {
  const schedule = job.schedule;
  if (schedule.kind === 'at') {
    const atMs = parseAtMs(schedule.at);
    return atMs <= nowMs ? atMs : undefined;
  }
  if (schedule.kind === 'every') {
    const everyMs = Math.max(1, Math.floor(schedule.everyMs));
    const anchorMs = Math.max(0, Math.floor(schedule.anchorMs ?? nowMs));
    if (anchorMs > nowMs) return undefined;
    const elapsed = nowMs - anchorMs;
    return anchorMs + Math.floor(elapsed / everyMs) * everyMs;
  }

  const staggerMs = resolveCronStaggerMs(schedule);
  const offsetMs = stableOffsetMs(job.id, staggerMs);
  const interval = parseCron(schedule, new Date(Math.max(0, nowMs - offsetMs)));
  return interval.prev().getTime() + offsetMs;
}

export function describeSchedule(schedule: CronSchedule): string {
  if (schedule.kind === 'at') return `at ${schedule.at}`;
  if (schedule.kind === 'every') return `every ${schedule.everyMs}ms`;
  return `cron ${schedule.expr}${schedule.tz ? ` (${schedule.tz})` : ''}`;
}

export function timerDelayUntil(targetMs: number, nowMs = Date.now()): number {
  return Math.max(0, Math.min(MAX_TIMER_DELAY_MS, targetMs - nowMs));
}
