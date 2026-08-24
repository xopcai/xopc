import type { HomeFocusItem } from '../../query/home';

export type HomeContinueCandidate<T> = {
  value: T;
  id: string;
  kind: 'active_chat' | 'running_work' | 'recent_chat' | 'note';
  updatedAt: number;
};

const RECENT_USER_ACTIVITY_MS = 24 * 60 * 60 * 1_000;

function continueTier<T>(candidate: HomeContinueCandidate<T>, nowMs: number): number {
  const userOpened = candidate.kind === 'recent_chat' || candidate.kind === 'note';
  if (userOpened && nowMs - candidate.updatedAt <= RECENT_USER_ACTIVITY_MS) return 4;
  if (candidate.kind === 'active_chat') return 3;
  if (candidate.kind === 'running_work') return 2;
  return 1;
}

export function rankHomeContinueCandidates<T>(
  candidates: HomeContinueCandidate<T>[],
  focusedId: string | undefined,
  nowMs = Date.now(),
): T[] {
  return candidates
    .filter((candidate) => candidate.id !== focusedId)
    .sort((left, right) => (
      continueTier(right, nowMs) - continueTier(left, nowMs)
      || right.updatedAt - left.updatedAt
    ))
    .map((candidate) => candidate.value);
}

export function selectHomeFocusItem(
  items: HomeFocusItem[],
  pinnedId: string | null,
): HomeFocusItem | undefined {
  if (items[0] && !items[0].pinnable) return items[0];
  if (pinnedId) {
    const pinned = items.find((item) => item.id === pinnedId && item.pinnable);
    if (pinned) return pinned;
  }
  return items[0];
}
