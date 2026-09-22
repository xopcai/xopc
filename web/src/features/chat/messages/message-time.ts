export function formatChatMessageTime(ts?: number): string {
  if (!ts) return '';
  return new Date(ts).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });
}

const CHAT_TIME_SEPARATOR_GAP_MS = 30 * 60 * 1000;

function isSameLocalDay(left: Date, right: Date): boolean {
  return left.getFullYear() === right.getFullYear()
    && left.getMonth() === right.getMonth()
    && left.getDate() === right.getDate();
}

export function shouldShowChatTimeSeparator(
  timestamp: number | undefined,
  previousTimestamp: number | undefined,
): boolean {
  if (!timestamp) return false;
  if (!previousTimestamp) return true;
  const current = new Date(timestamp);
  const previous = new Date(previousTimestamp);
  return !isSameLocalDay(current, previous)
    || timestamp - previousTimestamp >= CHAT_TIME_SEPARATOR_GAP_MS;
}

export function formatChatTimeSeparator(
  timestamp: number,
  nowTimestamp: number,
  language: 'en' | 'zh',
): string {
  const date = new Date(timestamp);
  const now = new Date(nowTimestamp);
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);

  const day = isSameLocalDay(date, now)
    ? language === 'zh' ? '今天' : 'Today'
    : isSameLocalDay(date, yesterday)
      ? language === 'zh' ? '昨天' : 'Yesterday'
      : new Intl.DateTimeFormat(language === 'zh' ? 'zh-CN' : 'en', {
          month: 'short',
          day: 'numeric',
          year: date.getFullYear() === now.getFullYear() ? undefined : 'numeric',
        }).format(date);
  const time = new Intl.DateTimeFormat(language === 'zh' ? 'zh-CN' : 'en', {
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
  return `${day} ${time}`;
}
