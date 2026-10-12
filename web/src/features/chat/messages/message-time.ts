const timeFormatters = new Map<string, Intl.DateTimeFormat>();

function chatTimeFormatter(language?: 'en' | 'zh', kind: 'time' | 'date' | 'year' = 'time'): Intl.DateTimeFormat {
  const key = `${language ?? 'default'}:${kind}`;
  let formatter = timeFormatters.get(key);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat(language === 'zh' ? 'zh-CN' : language, kind === 'time'
      ? { hour: '2-digit', minute: '2-digit' }
      : { month: 'short', day: 'numeric', year: kind === 'year' ? 'numeric' : undefined });
    timeFormatters.set(key, formatter);
  }
  return formatter;
}

export function formatChatMessageTime(ts?: number): string {
  if (!ts) return '';
  return chatTimeFormatter().format(ts);
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
      : chatTimeFormatter(language, date.getFullYear() === now.getFullYear() ? 'date' : 'year').format(date);
  const time = chatTimeFormatter(language).format(date);
  return `${day} ${time}`;
}
