import type {
  WebchatChecklistItemWire,
  WebchatGoalRunVerdict,
  WebchatGoalRunWire,
  WebchatPersistentGoalWire,
} from '@/features/chat/goals-api';
import type { messages } from '@/i18n/messages';

export type GoalMessages = ReturnType<typeof messages>['chat']['goal'];

export function shouldShowGoal(g: WebchatPersistentGoalWire | null): g is WebchatPersistentGoalWire {
  return g !== null && g.status !== 'cleared';
}

export function checklistStats(g: WebchatPersistentGoalWire): { total: number; done: number } {
  const items = g.checklist ?? [];
  const total = items.length;
  const done = items.filter((i) => i.status === 'completed' || i.status === 'impossible').length;
  return { total, done };
}

export function statusLabel(g: WebchatPersistentGoalWire, t: GoalMessages): string {
  if (g.status === 'active') return t.statusActive;
  if (g.status === 'paused') return t.statusPaused;
  if (g.status === 'done') return t.statusDone;
  return g.status;
}

export function verdictLabel(v: WebchatPersistentGoalWire['lastVerdict'], t: GoalMessages): string {
  if (v === 'done') return t.verdictDone;
  if (v === 'continue') return t.verdictContinue;
  if (v === 'skipped') return t.verdictSkipped;
  if (v === 'decompose') return t.verdictDecompose;
  return v ?? '';
}

export function runVerdictLabel(v: WebchatGoalRunVerdict, t: GoalMessages): string {
  if (v === 'inactive') return t.verdictInactive;
  return verdictLabel(v, t);
}

export function statusAfterLabel(s: WebchatGoalRunWire['statusAfter'], t: GoalMessages): string {
  if (s === 'active') return t.statusActive;
  if (s === 'paused') return t.statusPaused;
  if (s === 'done') return t.statusDone;
  return s;
}

export function collapsedStorageKey(sk: string): string {
  return `xopc:goalBannerCollapsed:${sk}`;
}

export function itemMarker(it: WebchatChecklistItemWire): string {
  if (it.status === 'completed') return '✓';
  if (it.status === 'impossible') return '!';
  return '○';
}
