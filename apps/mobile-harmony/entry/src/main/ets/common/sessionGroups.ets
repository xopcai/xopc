import { XopcSessionGroup, XopcSessionItem } from '../model/chat';

export interface XopcSessionAge { unit: string; count: number; }

export function sessionAge(updatedAt: string, now: number = Date.now()): XopcSessionAge {
  const timestamp = Date.parse(updatedAt);
  if (!Number.isFinite(timestamp)) return { unit: 'invalid', count: 0 };
  const minutes = Math.floor((now - timestamp) / 60000);
  if (minutes < 1) return { unit: 'now', count: 0 };
  if (minutes < 60) return { unit: 'minute', count: minutes };
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return { unit: 'hour', count: hours };
  const days = Math.floor(hours / 24);
  if (days < 7) return { unit: 'day', count: days };
  const weeks = Math.floor(days / 7);
  return { unit: weeks < 5 ? 'week' : 'date', count: weeks };
}

export function groupChatSessions(items: XopcSessionItem[], now: Date = new Date()): XopcSessionGroup[] {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today); yesterday.setDate(yesterday.getDate() - 1);
  const week = new Date(today); week.setDate(week.getDate() - (week.getDay() + 6) % 7);
  const previousWeek = new Date(week); previousWeek.setDate(previousWeek.getDate() - 7);
  const month = new Date(now.getFullYear(), now.getMonth(), 1);
  const groups: XopcSessionGroup[] = [];
  const date = new Date();
  items.forEach((item: XopcSessionItem): void => {
    const time = Date.parse(item.updatedAt); date.setTime(time);
    const label = !Number.isFinite(time) ? 'earlier' : time >= today.getTime() ? 'today'
      : time >= yesterday.getTime() ? 'yesterday' : time >= week.getTime() ? 'this_week'
      : time >= previousWeek.getTime() ? 'last_week' : time >= month.getTime() ? 'this_month'
      : date.getFullYear().toString() + '-' + (date.getMonth() + 1).toString().padStart(2, '0');
    const group = groups.find((value: XopcSessionGroup): boolean => value.id === label);
    if (group) group.items.push(item); else groups.push({ id: label, label, items: [item] });
  });
  return groups;
}
