export interface NoteTimeLabels {
  justNow: string;
  minutesAgo: string;
  today: string;
  yesterday: string;
  daysAgo: string;
  locale: string;
}

const MINUTE = 60_000;
const HOUR = 3_600_000;
const DAY = 86_400_000;

function startOfDay(ts: number): number {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** Short relative time for note cards. */
export function formatRelativeTime(ts: number, now: number, labels: NoteTimeLabels): string {
  const diff = now - ts;

  if (diff < MINUTE) return labels.justNow;
  if (diff < HOUR) {
    const mins = Math.floor(diff / MINUTE);
    return labels.minutesAgo.replace('{{n}}', String(mins));
  }

  const todayStart = startOfDay(now);
  if (ts >= todayStart) {
    return labels.today + ' ' + new Date(ts).toLocaleTimeString(labels.locale, { hour: '2-digit', minute: '2-digit' });
  }

  const yesterdayStart = todayStart - DAY;
  if (ts >= yesterdayStart) {
    return labels.yesterday + ' ' + new Date(ts).toLocaleTimeString(labels.locale, { hour: '2-digit', minute: '2-digit' });
  }

  if (diff < 7 * DAY) {
    const days = Math.floor(diff / DAY);
    return labels.daysAgo.replace('{{n}}', String(days));
  }

  return new Date(ts).toLocaleDateString(labels.locale, { month: 'short', day: 'numeric' });
}

/** Date group label for list separators. */
export function formatDateGroup(ts: number, now: number, labels: NoteTimeLabels): string {
  const todayStart = startOfDay(now);
  if (ts >= todayStart) return labels.today;

  const yesterdayStart = todayStart - DAY;
  if (ts >= yesterdayStart) return labels.yesterday;

  const d = new Date(ts);
  const nowDate = new Date(now);
  if (d.getFullYear() === nowDate.getFullYear()) {
    return d.toLocaleDateString(labels.locale, { month: 'long', day: 'numeric' });
  }
  return d.toLocaleDateString(labels.locale, { year: 'numeric', month: 'long', day: 'numeric' });
}

/** Group key — same day = same group. */
export function dateGroupKey(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
