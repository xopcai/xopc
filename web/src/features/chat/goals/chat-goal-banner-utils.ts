import type {
  WebchatChecklistItemWire,
  WebchatGoalRunVerdict,
  WebchatGoalRunWire,
  WebchatPersistentGoalWire,
} from '@/features/chat/goals/goals-api';
import type { messages } from '@/i18n/messages';

export type GoalMessages = ReturnType<typeof messages>['chat']['goal'];

export type GoalUiPhase = 'agent_running' | 'paused' | 'done' | 'judge_recently_completed' | 'idle';

type GoalMessagesWithMissionCopy = GoalMessages & {
  phaseAgentRunning?: string;
  phasePaused?: string;
  phaseDone?: string;
  phaseJudged?: string;
  missionHeading?: string;
};

export function shouldShowGoal(g: WebchatPersistentGoalWire | null): g is WebchatPersistentGoalWire {
  return g !== null && g.status !== 'archived';
}

export function checklistStats(g: WebchatPersistentGoalWire): { total: number; done: number } {
  const items = g.checklist ?? [];
  const total = items.length;
  const done = items.filter((i) => i.status === 'completed' || i.status === 'impossible').length;
  return { total, done };
}

export function goalTurnProgress(g: WebchatPersistentGoalWire): { used: number; total: number; percent: number } {
  const total = Math.max(0, g.maxTurns);
  const used = Math.max(0, g.turnsUsed);
  return { used, total, percent: total > 0 ? Math.min(100, (100 * used) / total) : 0 };
}

export function goalChecklistProgress(g: WebchatPersistentGoalWire): { done: number; total: number; percent: number } {
  const { done, total } = checklistStats(g);
  return { done, total, percent: total > 0 ? Math.min(100, (100 * done) / total) : 0 };
}

export function goalUiPhase(g: WebchatPersistentGoalWire, agentBusy: boolean): GoalUiPhase {
  if (agentBusy) return 'agent_running';
  if (g.status === 'paused' || g.status === 'blocked' || g.status === 'needs_input') return 'paused';
  if (g.status === 'done') return 'done';
  if (g.lastVerdict) return 'judge_recently_completed';
  return 'idle';
}

export function phaseLabel(phase: GoalUiPhase, t: GoalMessages): string {
  const copy = t as GoalMessagesWithMissionCopy;
  if (phase === 'agent_running') return copy.phaseAgentRunning ?? t.agentRunning;
  if (phase === 'paused') return copy.phasePaused ?? t.statusPaused;
  if (phase === 'done') return copy.phaseDone ?? t.statusDone;
  if (phase === 'judge_recently_completed') return copy.phaseJudged ?? t.lastVerdict;
  return copy.missionHeading ?? t.heading;
}

export function statusLabel(g: WebchatPersistentGoalWire, t: GoalMessages): string {
  if (g.status === 'active') return t.statusActive;
  if (g.status === 'paused' || g.status === 'blocked' || g.status === 'needs_input') return t.statusPaused;
  if (g.status === 'done') return t.statusDone;
  return g.status;
}

export function verdictLabel(v: WebchatPersistentGoalWire['lastVerdict'], t: GoalMessages): string {
  if (v === 'done') return t.verdictDone;
  if (v === 'continue') return t.verdictContinue;
  if (v === 'decompose') return t.verdictDecompose;
  if (v === 'blocked' || v === 'needs_input') return t.statusPaused;
  return v ?? '';
}

export function runVerdictLabel(v: WebchatGoalRunVerdict | undefined, t: GoalMessages): string {
  if (!v) return '';
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
