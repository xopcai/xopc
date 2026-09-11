import type { SessionListItem } from '../../query/sessions';

export type SessionTimeGroupLabels = {
  today: string;
  yesterday: string;
  thisWeek: string;
  lastWeek: string;
  thisMonth: string;
  earlier: string;
};

export type SessionListRow =
  | { type: 'section'; key: string; title: string }
  | {
      type: 'session';
      key: string;
      session: SessionListItem;
      isFirst: boolean;
      isLast: boolean;
    };

type SessionTimeGroup = {
  key: string;
  title: string;
  sessions: SessionListItem[];
};

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function startOfWeek(date: Date): Date {
  const dayStart = startOfDay(date);
  const mondayOffset = (dayStart.getDay() + 6) % 7;
  dayStart.setDate(dayStart.getDate() - mondayOffset);
  return dayStart;
}

function monthGroupKey(date: Date): string {
  return `month:${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

/** Builds mixed section/session rows so FlashList can recycle both row shapes. */
export function buildSessionListRows(
  sessions: SessionListItem[],
  labels: SessionTimeGroupLabels,
  locale: string,
  now = new Date(),
): SessionListRow[] {
  const todayStart = startOfDay(now).getTime();
  const yesterdayStart = new Date(todayStart);
  yesterdayStart.setDate(yesterdayStart.getDate() - 1);
  const weekStart = startOfWeek(now);
  const previousWeekStart = new Date(weekStart);
  previousWeekStart.setDate(previousWeekStart.getDate() - 7);
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
  const monthFormatter = new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric' });
  const groups = new Map<string, SessionTimeGroup>();

  const addToGroup = (key: string, title: string, session: SessionListItem) => {
    const group = groups.get(key);
    if (group) {
      group.sessions.push(session);
      return;
    }
    groups.set(key, { key, title, sessions: [session] });
  };

  for (const session of sessions) {
    const timestamp = new Date(session.updatedAt).getTime();
    if (!Number.isFinite(timestamp)) {
      addToGroup('earlier', labels.earlier, session);
    } else if (timestamp >= todayStart) {
      addToGroup('today', labels.today, session);
    } else if (timestamp >= yesterdayStart.getTime()) {
      addToGroup('yesterday', labels.yesterday, session);
    } else if (timestamp >= weekStart.getTime()) {
      addToGroup('this-week', labels.thisWeek, session);
    } else if (timestamp >= previousWeekStart.getTime()) {
      addToGroup('last-week', labels.lastWeek, session);
    } else if (timestamp >= monthStart) {
      addToGroup('this-month', labels.thisMonth, session);
    } else {
      const date = new Date(timestamp);
      const key = monthGroupKey(date);
      addToGroup(key, monthFormatter.format(date), session);
    }
  }

  return [...groups.values()].flatMap<SessionListRow>((group) => [
    { type: 'section', key: `section:${group.key}`, title: group.title },
    ...group.sessions.map((session, index) => ({
      type: 'session' as const,
      key: `session:${session.key}`,
      session,
      isFirst: index === 0,
      isLast: index === group.sessions.length - 1,
    })),
  ]);
}
