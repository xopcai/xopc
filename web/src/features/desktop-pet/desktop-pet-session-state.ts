import type { PetSessionState, PetSessionUpdate } from '@/types/electron';

export type DesktopPetActivity = PetSessionUpdate & {
  expiresAt?: number;
  startedAt?: number;
};

export type DesktopPetDismissal = {
  runId: string;
  state: PetSessionState;
};

export const SUCCESS_VISIBLE_MS = 8_000;

export function mergeDesktopPetActivity(
  prior: DesktopPetActivity | undefined,
  update: PetSessionUpdate,
): DesktopPetActivity {
  const sameRun = prior?.runId === update.runId;
  const hidesPublicSummary = update.feedback?.sensitivity === 'private';
  return {
    ...(sameRun ? prior : undefined),
    ...update,
    startedAt: sameRun ? (prior.startedAt ?? prior.timestamp) : update.timestamp,
    publicSummary: hidesPublicSummary
      ? undefined
      : update.publicSummary ?? (sameRun ? prior.publicSummary : undefined),
    feedback: update.feedback ?? (sameRun ? prior.feedback : undefined),
    expiresAt: update.state === 'success' ? update.timestamp + SUCCESS_VISIBLE_MS : undefined,
  };
}

export function mergeDesktopPetActivities(
  current: Record<string, DesktopPetActivity>,
  updates: PetSessionUpdate[],
): Record<string, DesktopPetActivity> {
  const next = { ...current };
  for (const update of updates) {
    const prior = next[update.sessionKey];
    if (prior?.runId === update.runId && update.sequence <= prior.sequence) continue;
    next[update.sessionKey] = mergeDesktopPetActivity(prior, update);
  }
  return next;
}

export function isDesktopPetActivityDismissed(
  activity: DesktopPetActivity,
  dismissal: DesktopPetDismissal | undefined,
): boolean {
  return dismissal?.runId === activity.runId && dismissal.state === activity.state;
}

export function visibleDesktopPetActivities(
  values: DesktopPetActivity[],
  now: number,
): DesktopPetActivity[] {
  const rank: Record<PetSessionState, number> = { error: 0, waiting: 1, running: 2, success: 3 };
  return values
    .filter((item) => !item.expiresAt || item.expiresAt > now)
    .sort((a, b) => rank[a.state] - rank[b.state] || b.timestamp - a.timestamp)
    .slice(0, 3);
}
