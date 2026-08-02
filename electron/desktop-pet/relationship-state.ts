import type { DesktopPetRelationship, DesktopPetRelationshipMoment } from './types.js';

const MAX_RECENT_RUNS = 100;

export function createDesktopPetRelationship(now: number): DesktopPetRelationship {
  return {
    firstMetAt: now,
    lastSeenAt: now,
    completedTaskCount: 0,
    unlockedReactions: [],
    recentCompletedRunIds: [],
  };
}

export function normalizeDesktopPetRelationship(raw: unknown, now: number): DesktopPetRelationship {
  if (!raw || typeof raw !== 'object') return createDesktopPetRelationship(now);
  const value = raw as Partial<DesktopPetRelationship>;
  return {
    firstMetAt: Number.isFinite(value.firstMetAt) ? Number(value.firstMetAt) : now,
    lastSeenAt: Number.isFinite(value.lastSeenAt) ? Number(value.lastSeenAt) : now,
    completedTaskCount: Number.isInteger(value.completedTaskCount) && Number(value.completedTaskCount) >= 0
      ? Number(value.completedTaskCount)
      : 0,
    unlockedReactions: Array.isArray(value.unlockedReactions)
      ? value.unlockedReactions.filter((item): item is string => typeof item === 'string').slice(-10)
      : [],
    recentCompletedRunIds: Array.isArray(value.recentCompletedRunIds)
      ? value.recentCompletedRunIds.filter((item): item is string => typeof item === 'string').slice(-MAX_RECENT_RUNS)
      : [],
  };
}

function dayKey(timestamp: number): string {
  const date = new Date(timestamp);
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

export function recordDesktopPetVisit(
  relationship: DesktopPetRelationship | null,
  now: number,
): { relationship: DesktopPetRelationship; moment?: DesktopPetRelationshipMoment } {
  if (!relationship) {
    return { relationship: createDesktopPetRelationship(now), moment: 'first_meeting' };
  }
  const moment: DesktopPetRelationshipMoment | undefined = dayKey(relationship.lastSeenAt) !== dayKey(now)
    ? 'new_day'
    : now - relationship.lastSeenAt >= 6 * 60 * 60_000
      ? 'returning'
      : undefined;
  return { relationship: { ...relationship, lastSeenAt: now }, moment };
}

function unlockedForCount(count: number): string[] {
  const unlocked: string[] = [];
  if (count >= 1) unlocked.push('first_task');
  if (count >= 10) unlocked.push('steady_pair');
  if (count >= 50) unlocked.push('trusted_team');
  return unlocked;
}

export function recordDesktopPetCompletion(
  relationship: DesktopPetRelationship,
  runId: string,
  now: number,
): DesktopPetRelationship {
  const normalizedRunId = runId.trim();
  if (!normalizedRunId || relationship.recentCompletedRunIds.includes(normalizedRunId)) return relationship;
  const completedTaskCount = relationship.completedTaskCount + 1;
  return {
    ...relationship,
    lastSeenAt: now,
    completedTaskCount,
    unlockedReactions: unlockedForCount(completedTaskCount),
    recentCompletedRunIds: [...relationship.recentCompletedRunIds, normalizedRunId].slice(-MAX_RECENT_RUNS),
  };
}

export function desktopPetDaysTogether(relationship: DesktopPetRelationship, now: number): number {
  return Math.max(1, Math.floor((now - relationship.firstMetAt) / 86_400_000) + 1);
}
