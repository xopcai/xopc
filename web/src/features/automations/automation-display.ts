import { formatCronExpressionLabel } from '@/features/scheduling/cron/format-cron-label';
import type { MessageBundle } from '@/i18n/messages';
import type { StoredLanguage } from '@/lib/storage';

import type { Automation, AutomationTrigger } from './automation-api';

type AutomationsMessages = MessageBundle['automations'];
type CronMessages = MessageBundle['cron'];

const SECOND_MS = 1_000;
const MINUTE_MS = 60 * SECOND_MS;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
const WEEK_MS = 7 * DAY_MS;
const EN_DURATION_LIST_FORMATTER = new Intl.ListFormat('en-US', {
  type: 'conjunction',
});
const EN_UNIT_FORMATTERS: Record<string, Intl.NumberFormat> = Object.fromEntries(
  ['second', 'minute', 'hour', 'day', 'week'].map((unit) => [
    unit,
    new Intl.NumberFormat('en-US', {
      style: 'unit',
      unit,
      unitDisplay: 'long',
    }),
  ]),
);
const AUTOMATION_DATE_TIME_FORMATTERS: Record<
  StoredLanguage,
  Intl.DateTimeFormat
> = {
  en: new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }),
  zh: new Intl.DateTimeFormat('zh-CN', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }),
};
const AUTOMATION_TIME_FORMATTERS: Record<StoredLanguage, Intl.DateTimeFormat> = {
  en: new Intl.DateTimeFormat('en-US', {
    hour: '2-digit',
    minute: '2-digit',
  }),
  zh: new Intl.DateTimeFormat('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
  }),
};

export type AutomationIntervalUnit = 'minute' | 'hour' | 'day' | 'week';

const INTERVAL_UNIT_MS: Record<AutomationIntervalUnit, number> = {
  minute: MINUTE_MS,
  hour: HOUR_MS,
  day: DAY_MS,
  week: WEEK_MS,
};

export function automationLocale(language: StoredLanguage): string {
  return language === 'zh' ? 'zh-CN' : 'en-US';
}

function formatUnit(value: number, unit: Intl.NumberFormatOptions['unit'], language: StoredLanguage): string {
  if (language === 'zh') {
    const unitLabel = unit === 'week'
      ? '周'
      : unit === 'day'
        ? '天'
        : unit === 'hour'
          ? '小时'
          : unit === 'minute'
            ? '分钟'
            : '秒';
    return `${value} ${unitLabel}`;
  }
  return EN_UNIT_FORMATTERS[String(unit)].format(value);
}

function joinDurationParts(parts: string[], language: StoredLanguage): string {
  return language === 'zh'
    ? parts.join(' ')
    : EN_DURATION_LIST_FORMATTER.format(parts);
}

export function automationIntervalMs(value: string | number, unit: AutomationIntervalUnit): number {
  const parsed = typeof value === 'number' ? value : Number.parseFloat(value);
  const safeValue = Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
  return Math.max(MINUTE_MS, Math.round(safeValue * INTERVAL_UNIT_MS[unit]));
}

export function convertAutomationIntervalValue(
  value: string | number,
  from: AutomationIntervalUnit,
  to: AutomationIntervalUnit,
): string {
  const parsed = typeof value === 'number' ? value : Number.parseFloat(value);
  const safeValue = Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
  return String(Number.parseFloat(((safeValue * INTERVAL_UNIT_MS[from]) / INTERVAL_UNIT_MS[to]).toFixed(6)));
}

export function formatAutomationDuration(everyMs: number, language: StoredLanguage): string {
  const safeMs = Math.max(SECOND_MS, Math.round(everyMs));
  const units: Array<{ unit: Intl.NumberFormatOptions['unit']; ms: number }> = safeMs === DAY_MS
    ? [{ unit: 'hour', ms: HOUR_MS }]
    : safeMs >= WEEK_MS && safeMs % WEEK_MS === 0
      ? [{ unit: 'week', ms: WEEK_MS }]
      : safeMs >= DAY_MS
        ? [
            { unit: 'day', ms: DAY_MS },
            { unit: 'hour', ms: HOUR_MS },
            { unit: 'minute', ms: MINUTE_MS },
            { unit: 'second', ms: SECOND_MS },
          ]
        : safeMs >= HOUR_MS
          ? [
              { unit: 'hour', ms: HOUR_MS },
              { unit: 'minute', ms: MINUTE_MS },
              { unit: 'second', ms: SECOND_MS },
            ]
          : safeMs >= MINUTE_MS
            ? [
                { unit: 'minute', ms: MINUTE_MS },
                { unit: 'second', ms: SECOND_MS },
              ]
            : [{ unit: 'second', ms: SECOND_MS }];

  let remainder = safeMs;
  const parts: string[] = [];
  for (const { unit, ms } of units) {
    const value = Math.floor(remainder / ms);
    if (value <= 0) continue;
    parts.push(formatUnit(value, unit, language));
    remainder %= ms;
  }
  return joinDurationParts(parts, language);
}

export function formatAutomationInterval(everyMs: number, language: StoredLanguage): string {
  const duration = formatAutomationDuration(everyMs, language);
  return language === 'zh' ? `每 ${duration}运行一次` : `Runs every ${duration}`;
}

export function formatAutomationDateTime(ms: number, language: StoredLanguage): string {
  return AUTOMATION_DATE_TIME_FORMATTERS[language].format(new Date(ms));
}

function localDateKey(date: Date): number {
  return Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
}

export function formatAutomationRelativeDateTime(
  ms: number,
  language: StoredLanguage,
  nowMs = Date.now(),
): string {
  const date = new Date(ms);
  const dayDifference = Math.round((localDateKey(date) - localDateKey(new Date(nowMs))) / DAY_MS);
  const time = AUTOMATION_TIME_FORMATTERS[language].format(date);
  if (dayDifference === 0) return language === 'zh' ? `今天 ${time}` : `today at ${time}`;
  if (dayDifference === 1) return language === 'zh' ? `明天 ${time}` : `tomorrow at ${time}`;
  if (dayDifference === -1) return language === 'zh' ? `昨天 ${time}` : `yesterday at ${time}`;
  return formatAutomationDateTime(ms, language);
}

function eventTriggerLabel(trigger: Extract<AutomationTrigger, { kind: 'event' }>, labels: AutomationsMessages): string {
  if (trigger.eventType === 'outcome.status_changed' && trigger.payloadMatch?.status === 'blocked') {
    return labels.trigger.outcomeBlockedWhen;
  }
  if (trigger.eventType === 'note.created') return labels.trigger.noteCreatedWhen;
  if (trigger.eventType === 'workflow.run.completed' && trigger.payloadMatch?.status === 'failed') {
    return labels.trigger.workflowFailedWhen;
  }
  if (trigger.eventType === 'session.transcript.updated') return labels.trigger.sessionUpdatedWhen;
  return labels.trigger.eventWithType.replace('{type}', trigger.eventType);
}

export function automationTriggerLabel(
  trigger: AutomationTrigger,
  labels: AutomationsMessages,
  cronLabels: CronMessages,
  language: StoredLanguage,
): string {
  if (trigger.kind === 'manual') return labels.trigger.manualWhen;
  if (trigger.kind === 'webhook') return labels.trigger.webhookWhen;
  if (trigger.kind === 'event') return eventTriggerLabel(trigger, labels);
  const schedule = trigger.schedule;
  if (schedule.kind === 'once') {
    return labels.trigger.onceAt.replace(
      '{time}',
      formatAutomationRelativeDateTime(Date.parse(schedule.at), language),
    );
  }
  if (schedule.kind === 'interval') return formatAutomationInterval(schedule.everyMs, language);
  return formatCronExpressionLabel(schedule.expr, automationLocale(language), cronLabels.scheduleBadge, {
    timezone: schedule.tz,
  });
}

export function automationNextRunLabel(
  automation: Automation,
  labels: AutomationsMessages,
  language: StoredLanguage,
  nowMs = Date.now(),
): string {
  if (!automation.enabled) return labels.info.pausedNoAutomaticRuns;
  if (automation.state.nextRunAtMs) {
    return formatAutomationRelativeDateTime(automation.state.nextRunAtMs, language, nowMs);
  }
  if (automation.trigger.kind === 'manual') return labels.info.noAutomaticTrigger;
  if (automation.trigger.kind === 'event' || automation.trigger.kind === 'webhook') {
    return labels.info.waitingForTrigger;
  }
  return labels.info.noUpcomingRun;
}

export function automationLastRunLabel(
  automation: Automation,
  labels: AutomationsMessages,
  language: StoredLanguage,
  nowMs = Date.now(),
): string {
  if (!automation.state.lastRunAtMs) return labels.info.notRunYet;
  const moment = formatAutomationRelativeDateTime(automation.state.lastRunAtMs, language, nowMs);
  const status = automation.state.lastRunStatus;
  return status ? `${moment} · ${labels.status[status]}` : moment;
}
