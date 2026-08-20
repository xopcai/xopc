import { describe, expect, it } from 'vitest';

import { formatDreamingRunTime, formatDreamingSchedule, formatTimezone } from '../dreaming-schedule-format';

describe('Dreaming schedule presentation', () => {
  it('presents semantic schedules without exposing cron', () => {
    expect(formatDreamingSchedule({ kind: 'interval', everyHours: 6, minute: 0 }, 'zh')).toBe('每 6 小时');
    expect(formatDreamingSchedule({ kind: 'daily', time: '03:00' }, 'zh')).toBe('每天 03:00');
    expect(formatDreamingSchedule({ kind: 'weekly', weekday: 0, time: '05:00' }, 'zh')).toBe('每周日 05:00');
  });

  it('formats the next run in the selected timezone', () => {
    expect(formatDreamingRunTime('2026-08-20T19:00:00.000Z', 'zh', 'Asia/Shanghai')).toContain('03:00');
    expect(formatTimezone('Asia/Shanghai', 'zh')).toContain('UTC+8');
  });
});
