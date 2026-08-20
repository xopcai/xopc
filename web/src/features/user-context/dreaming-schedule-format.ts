import type { DreamingSchedule } from './user-context-api';

const WEEKDAYS = {
  zh: ['周日', '周一', '周二', '周三', '周四', '周五', '周六'],
  en: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
} as const;

export function formatDreamingSchedule(schedule: DreamingSchedule, language: 'en' | 'zh'): string {
  if (schedule.kind === 'interval') {
    const base = language === 'zh' ? `每 ${schedule.everyHours} 小时` : `Every ${schedule.everyHours} hours`;
    if (schedule.minute === 0) return base;
    return language === 'zh' ? `${base}，整点后 ${schedule.minute} 分` : `${base}, at :${String(schedule.minute).padStart(2, '0')}`;
  }
  if (schedule.kind === 'daily') return language === 'zh' ? `每天 ${schedule.time}` : `Daily at ${schedule.time}`;
  const weekday = WEEKDAYS[language][schedule.weekday];
  return language === 'zh' ? `每${weekday} ${schedule.time}` : `Every ${weekday} at ${schedule.time}`;
}

export function formatDreamingRunTime(
  value: string | undefined,
  language: 'en' | 'zh',
  timezone: string,
): string {
  if (!value) return language === 'zh' ? '暂无计划' : 'Not scheduled';
  return new Intl.DateTimeFormat(language === 'zh' ? 'zh-CN' : 'en-US', {
    timeZone: timezone,
    month: 'short',
    day: 'numeric',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(value));
}

export function formatTimezone(timezone: string, language: 'en' | 'zh'): string {
  const offset = new Intl.DateTimeFormat('en', {
    timeZone: timezone,
    timeZoneName: 'shortOffset',
  }).formatToParts().find((part) => part.type === 'timeZoneName')?.value;
  const name = language === 'zh' && timezone === 'Asia/Shanghai' ? '中国标准时间' : timezone;
  return offset ? `${name} (${offset.replace('GMT', 'UTC')})` : name;
}
