export interface ActiveHoursWindow {
  start: string;
  end: string;
  /** IANA zone (e.g. Asia/Shanghai) or omit / `local` for host local time */
  timezone?: string;
}

function parseHm(s: string): { h: number; m: number } | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(s.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h < 0 || h > 23 || min < 0 || min > 59) return null;
  return { h, m: min };
}

function currentMinuteInZone(now: Date, timezone?: string): number {
  if (!timezone || timezone === 'local') {
    return now.getHours() * 60 + now.getMinutes();
  }
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(now);
  const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? '0');
  const minute = Number(parts.find((p) => p.type === 'minute')?.value ?? '0');
  return hour * 60 + minute;
}

/**
 * Whether `now` falls inside [start, end) in the configured timezone (or local).
 * Supports windows that cross midnight when end <= start in clock terms.
 */
export function isWithinActiveHours(
  activeHours: ActiveHoursWindow,
  now = new Date(),
): boolean {
  const startP = parseHm(activeHours.start);
  const endP = parseHm(activeHours.end);
  if (!startP || !endP) return true;

  const currentMin = currentMinuteInZone(now, activeHours.timezone);
  const startMin = startP.h * 60 + startP.m;
  const endMin = endP.h * 60 + endP.m;

  if (endMin > startMin) {
    return currentMin >= startMin && currentMin < endMin;
  }
  return currentMin >= startMin || currentMin < endMin;
}
