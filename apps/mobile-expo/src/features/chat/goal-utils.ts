import type {
  WebchatChecklistItemWire,
  WebchatGoalRunVerdict,
  WebchatGoalRunWire,
  WebchatPersistentGoalWire,
} from '../../query/goals';
import type { MessageBundle } from '../../i18n/messages';

export type GoalMessages = MessageBundle['chat']['goal'];

export type GoalUiPhase = 'agent_running' | 'paused' | 'done' | 'judge_recently_completed' | 'idle';

export function shouldShowGoal(g: WebchatPersistentGoalWire | null): g is WebchatPersistentGoalWire {
  return g !== null && g.status !== 'cleared';
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
  if (g.status === 'paused') return 'paused';
  if (g.status === 'done') return 'done';
  if (g.lastVerdict) return 'judge_recently_completed';
  return 'idle';
}

export function phaseLabel(phase: GoalUiPhase, t: GoalMessages): string {
  if (phase === 'agent_running') return t.phaseAgentRunning;
  if (phase === 'paused') return t.phasePaused;
  if (phase === 'done') return t.phaseDone;
  if (phase === 'judge_recently_completed') return t.phaseJudged;
  return t.missionHeading;
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

export function groupedChecklistItems(items: WebchatChecklistItemWire[]): {
  pending: Array<WebchatChecklistItemWire & { index1Based: number }>;
  completed: Array<WebchatChecklistItemWire & { index1Based: number }>;
  impossible: Array<WebchatChecklistItemWire & { index1Based: number }>;
} {
  const groups = {
    pending: [] as Array<WebchatChecklistItemWire & { index1Based: number }>,
    completed: [] as Array<WebchatChecklistItemWire & { index1Based: number }>,
    impossible: [] as Array<WebchatChecklistItemWire & { index1Based: number }>,
  };
  items.forEach((item, index) => {
    groups[item.status].push({ ...item, index1Based: index + 1 });
  });
  return groups;
}

export function itemMarker(it: WebchatChecklistItemWire): string {
  if (it.status === 'completed') return '✓';
  if (it.status === 'impossible') return '!';
  return '○';
}

export function formatGoalElapsedMs(ms: number): string {
  const safe = Math.max(0, Math.floor(ms));
  const totalSeconds = Math.floor(safe / 1000);
  const seconds = totalSeconds % 60;
  const minutes = Math.floor(totalSeconds / 60) % 60;
  const hours = Math.floor(totalSeconds / 3600);
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

export function computeGoalWallElapsedMs(g: WebchatPersistentGoalWire, now = Date.now()): number {
  const start = Number.isFinite(g.createdAt) ? g.createdAt : now;
  const end = g.status === 'active' || g.status === 'paused' ? now : g.lastTurnAt || now;
  return Math.max(0, end - start);
}

/** Cap expanded goal panel height so long checklists can scroll to runs below. */
export function goalMissionExpandedMaxHeight(windowHeight: number): number {
  return Math.max(220, Math.min(460, Math.round(windowHeight * 0.48)));
}
