import { formatShortMonthDateTime } from '@/lib/date-formatters';

const time = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const shortDate = {
  zh: new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric' }),
  en: new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }),
};

export function formatPersonalTaskTime(timestamp: number, zh: boolean, dateInHeading = false, now = new Date()): string {
  if (dateInHeading || new Date(timestamp).toDateString() === now.toDateString()) return time.format(timestamp);
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (new Date(timestamp).toDateString() === yesterday.toDateString()) return zh ? '昨天' : 'Yesterday';
  return shortDate[zh ? 'zh' : 'en'].format(timestamp);
}

export function formatPersonalScheduleTime(timestamp: number, zh: boolean, now = new Date()): string {
  if (new Date(timestamp).toDateString() === now.toDateString()) return `${zh ? '今天' : 'Today'} ${time.format(timestamp)}`;
  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);
  if (new Date(timestamp).toDateString() === tomorrow.toDateString()) return `${zh ? '明天' : 'Tomorrow'} ${time.format(timestamp)}`;
  return formatShortMonthDateTime(timestamp, zh ? 'zh' : 'en');
}
