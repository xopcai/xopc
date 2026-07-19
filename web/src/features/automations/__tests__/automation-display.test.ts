import { describe, expect, it } from 'vitest';

import { messages } from '@/i18n/messages';

import {
  automationLastRunLabel,
  automationNextRunLabel,
  automationTriggerLabel,
  automationIntervalMs,
  convertAutomationIntervalValue,
  formatAutomationInterval,
  formatAutomationRelativeDateTime,
} from '../automation-display';
import type { Automation } from '../automation-api';

function automation(overrides: Partial<Automation> = {}): Automation {
  return {
    id: 'automation-1',
    name: 'Daily brief',
    enabled: true,
    trigger: { kind: 'schedule', schedule: { kind: 'interval', everyMs: 86_400_000 } },
    action: { kind: 'agent', instruction: 'Prepare a brief' },
    state: {},
    createdAtMs: 1,
    updatedAtMs: 1,
    ...overrides,
  };
}

describe('automation display labels', () => {
  it('uses natural, exact units for interval schedules', () => {
    expect(formatAutomationInterval(15 * 60_000, 'zh')).toBe('每 15 分钟运行一次');
    expect(formatAutomationInterval(90 * 60_000, 'zh')).toBe('每 1 小时 30 分钟运行一次');
    expect(formatAutomationInterval(1_440 * 60_000, 'zh')).toBe('每 24 小时运行一次');
    expect(formatAutomationInterval(2_880 * 60_000, 'zh')).toBe('每 2 天运行一次');
    expect(formatAutomationInterval(10_080 * 60_000, 'zh')).toBe('每 1 周运行一次');
  });

  it('keeps English pluralization readable', () => {
    expect(formatAutomationInterval(90 * 60_000, 'en')).toBe('Runs every 1 hour and 30 minutes');
  });

  it('preserves the actual interval when switching form units', () => {
    expect(convertAutomationIntervalValue('1440', 'minute', 'hour')).toBe('24');
    expect(convertAutomationIntervalValue('90', 'minute', 'hour')).toBe('1.5');
    expect(automationIntervalMs('1.5', 'hour')).toBe(90 * 60_000);
  });

  it('uses familiar labels for known product events', () => {
    const labels = messages('zh').automations;
    const cronLabels = messages('zh').cron;
    expect(automationTriggerLabel({
      kind: 'event',
      eventType: 'goal.status_changed',
      source: 'goals',
      payloadMatch: { status: 'blocked' },
    }, labels, cronLabels, 'zh')).toBe('当目标变为「阻塞」时运行');
    expect(automationTriggerLabel({
      kind: 'event',
      eventType: 'custom.record.ready',
    }, labels, cronLabels, 'zh')).toBe('当 custom.record.ready 事件发生时运行');
  });

  it('uses relative labels for nearby dates', () => {
    const now = new Date(2026, 6, 19, 12, 0).getTime();
    expect(formatAutomationRelativeDateTime(new Date(2026, 6, 20, 22, 39).getTime(), 'zh', now))
      .toBe('明天 22:39');
  });

  it('explains paused, upcoming, and previous run states', () => {
    const labels = messages('zh').automations;
    const now = new Date(2026, 6, 19, 12, 0).getTime();
    expect(automationNextRunLabel(automation({ enabled: false }), labels, 'zh', now))
      .toBe('已暂停，不会自动运行');
    expect(automationLastRunLabel(automation(), labels, 'zh', now)).toBe('尚未运行');
    expect(automationLastRunLabel(automation({
      state: {
        lastRunAtMs: new Date(2026, 6, 19, 10, 30).getTime(),
        lastRunStatus: 'failed',
      },
    }), labels, 'zh', now)).toBe('今天 10:30 · 失败');
  });
});
