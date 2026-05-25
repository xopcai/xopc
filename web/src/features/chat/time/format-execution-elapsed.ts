import type { StoredLanguage } from '@/lib/storage';

/** Subset of persistent goal fields used for wall-clock duration in the chat banner. */
export type GoalWallClockSlice = {
  createdAt: number;
  lastTurnAt: number;
  status: 'active' | 'paused' | 'done' | 'cleared';
};

/**
 * Milliseconds from goal `createdAt` to `nowMs` while active/paused, or to `lastTurnAt` when status is `done`
 * (if `lastTurnAt` is before `createdAt`, falls back to `nowMs`).
 */
export function computeGoalWallElapsedMs(g: GoalWallClockSlice, nowMs: number): number {
  const start = g.createdAt;
  if (!Number.isFinite(start) || start <= 0) return 0;
  const last = typeof g.lastTurnAt === 'number' && Number.isFinite(g.lastTurnAt) ? g.lastTurnAt : 0;
  const end =
    g.status === 'done' && last >= start ? last : nowMs;
  return Math.max(0, end - start);
}

/** Compact elapsed time for the execution progress line (e.g. `12s`, `1分05秒`). */
export function formatExecutionElapsedMs(ms: number, language: StoredLanguage): string {
  const sec = Math.max(0, Math.floor(ms / 1000));
  if (sec < 60) {
    return language === 'zh' ? `${sec}秒` : `${sec}s`;
  }
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  if (m < 60) {
    return language === 'zh' ? `${m}分${String(s).padStart(2, '0')}秒` : `${m}m ${s}s`;
  }
  const h = Math.floor(m / 60);
  const rm = m % 60;
  return language === 'zh' ? `${h}小时${rm}分` : `${h}h ${rm}m`;
}
