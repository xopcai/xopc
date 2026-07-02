import { CronExpressionParser } from 'cron-parser';

import type { Automation, AutomationSchedule } from './types.js';

function parseAtMs(value: string): number | undefined {
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : undefined;
}

export function computeNextAutomationRunAtMs(
  automation: Pick<Automation, 'enabled' | 'trigger'>,
  fromMs = Date.now(),
): number | undefined {
  if (!automation.enabled || automation.trigger.kind !== 'schedule') {
    return undefined;
  }
  return computeNextScheduleRunAtMs(automation.trigger.schedule, fromMs);
}

export function computeNextScheduleRunAtMs(
  schedule: AutomationSchedule,
  fromMs = Date.now(),
): number | undefined {
  if (schedule.kind === 'once') {
    const atMs = parseAtMs(schedule.at);
    return atMs != null && atMs > fromMs ? atMs : undefined;
  }
  if (schedule.kind === 'interval') {
    const anchor = schedule.anchorMs ?? fromMs;
    if (anchor > fromMs) return anchor;
    const elapsed = fromMs - anchor;
    return anchor + (Math.floor(elapsed / schedule.everyMs) + 1) * schedule.everyMs;
  }
  try {
    return CronExpressionParser.parse(schedule.expr, {
      currentDate: new Date(fromMs),
      tz: schedule.tz,
    }).next().getTime();
  } catch {
    return undefined;
  }
}

export function timerDelayUntil(targetMs: number, nowMs = Date.now()): number {
  return Math.max(0, Math.min(targetMs - nowMs, 2 ** 31 - 1));
}

