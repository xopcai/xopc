import type { DesktopPetActivity as Activity } from './desktop-pet-session-state';
import type { DesktopPetBehaviorMode } from '@/types/electron';

const LONG_RUNNING_MS = 90_000;
const STALE_SIGNAL_MS = 30_000;
const IDLE_COMPANION_DELAY_MS = 20 * 60_000;
const IDLE_COMPANION_TTL_MS = 45_000;
export const IDLE_COMPANION_COOLDOWN_MS = 45 * 60_000;
const COMPLETION_SUMMARY_MAX_CHARS = 58;

export function isLongRunning(item: Activity, now: number): boolean {
  return (
    item.state === 'running' &&
    now - (item.startedAt ?? item.timestamp) >= LONG_RUNNING_MS
  );
}

export function hasStaleSignal(item: Activity, now: number): boolean {
  return item.state === 'running' && now - item.timestamp >= STALE_SIGNAL_MS;
}

export function activityDetailText(
  item: Activity,
  now: number,
  targetSuffix: string,
): string {
  if (item.progress) {
    const progress = `${item.progress.completed}/${item.progress.total}`;
    return item.action.includes(progress) ? '' : ` · ${progress}`;
  }
  if (item.detail && !item.action.includes(item.detail)) {
    return targetSuffix.replace(/\{\{detail\}\}/g, item.detail);
  }
  if (item.state === 'running') {
    return ` · ${Math.max(1, Math.floor((now - item.timestamp) / 1000))}s`;
  }
  return '';
}

export function activityCompletionText(
  item: Activity,
  template: string,
): string | undefined {
  if (item.state !== 'success' || !item.publicSummary) return undefined;
  const text = item.publicSummary.replace(/\s+/g, ' ').trim();
  const summary =
    text.length > COMPLETION_SUMMARY_MAX_CHARS
      ? `${text.slice(0, COMPLETION_SUMMARY_MAX_CHARS - 1)}…`
      : text;
  return template.replace(/\{\{summary\}\}/g, summary);
}

export function activityHealthText(
  item: Activity,
  now: number,
  labels: { longRunning: string; stale: string },
): string | undefined {
  if (hasStaleSignal(item, now)) return labels.stale;
  if (isLongRunning(item, now)) return labels.longRunning;
  return undefined;
}

export function activityReassuranceText(
  item: Activity,
  labels: Record<
    NonNullable<NonNullable<Activity['feedback']>['reassurance']>,
    string
  >,
): string | undefined {
  const reassurance = item.feedback?.reassurance;
  return reassurance ? labels[reassurance] : undefined;
}

export function shouldShowIdleTip(params: {
  bubbleEnabled: boolean;
  behaviorMode: DesktopPetBehaviorMode;
  proactiveTipsEnabled: boolean;
  remindersPausedUntil?: number;
  collapsed: boolean;
  queuedCount: number;
  activeCount: number;
  now: number;
  lastActivityAt: number;
  dismissedUntil: number;
}): boolean {
  const idleElapsed = params.now - params.lastActivityAt;
  const idleCycleElapsed =
    idleElapsed >= IDLE_COMPANION_DELAY_MS
      ? (idleElapsed - IDLE_COMPANION_DELAY_MS) %
        IDLE_COMPANION_COOLDOWN_MS
      : Number.POSITIVE_INFINITY;
  return (
    params.bubbleEnabled &&
    params.behaviorMode !== 'focus' &&
    params.proactiveTipsEnabled &&
    (!params.remindersPausedUntil || params.now >= params.remindersPausedUntil) &&
    !params.collapsed &&
    params.queuedCount === 0 &&
    params.activeCount === 0 &&
    idleCycleElapsed <= IDLE_COMPANION_TTL_MS &&
    params.now >= params.dismissedUntil
  );
}
