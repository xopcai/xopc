import {
  CHECKLIST_ITEM_PENDING,
  TERMINAL_CHECKLIST_STATUSES,
  type ChecklistItemStatus,
  type GoalChecklistItem,
} from './checklist-types.js';

// Direct import of the underlying locale type — `goal-locale.ts` aliases this as
// `GoalUiLocale` AND imports values from `state.ts`, so going through `./goal-locale.js`
// would create a circular module cycle.
import type { ServerLocale as GoalUiLocale } from '../../i18n/locale.js';

export type PersistentGoalStatus = 'active' | 'paused' | 'done' | 'cleared';

export interface PersistentGoalState {
  goal: string;
  status: PersistentGoalStatus;
  turnsUsed: number;
  maxTurns: number;
  createdAt: number;
  lastTurnAt: number;
  lastVerdict?: 'done' | 'continue' | 'skipped' | 'decompose';
  lastReason?: string;
  pausedReason?: string;
  judgeModelRef?: string;
  /** Hermes-style: judge JSON parse failures in a row (API errors do not increment). */
  consecutiveParseFailures?: number;
  /** After first successful decomposition, checklist drives Phase-B judging. */
  decomposed?: boolean;
  checklist?: GoalChecklistItem[];
  /** Gateway console language: drives judge `reason` language and system messages. */
  uiLocale?: GoalUiLocale;
}

export function defaultMaxTurns(cfg: { maxTurns?: number } | undefined): number {
  const n = cfg?.maxTurns;
  if (typeof n === 'number' && Number.isFinite(n)) {
    return Math.max(1, Math.min(500, Math.floor(n)));
  }
  return 20;
}

/** Render checklist for continuation prompt (Hermes-style, no numbers in body). */
export function renderChecklistPlain(items: GoalChecklistItem[]): string {
  if (!items.length) return '(empty)';
  const lines: string[] = [];
  for (const it of items) {
    const marker =
      it.status === 'completed' ? '[x]' : it.status === 'impossible' ? '[!]' : '[ ]';
    let line = `${marker} ${it.text}`;
    if (it.status === 'impossible' && it.evidence) line += ` (impossible: ${it.evidence})`;
    lines.push(line);
  }
  return lines.join('\n');
}

/** Numbered checklist for judge user prompts (1-based indices). */
export function renderChecklistNumbered(items: GoalChecklistItem[]): string {
  if (!items.length) return '(empty)';
  const lines: string[] = [];
  for (let i = 0; i < items.length; i++) {
    const it = items[i]!;
    const n = i + 1;
    const marker =
      it.status === 'completed' ? '[x]' : it.status === 'impossible' ? '[!]' : '[ ]';
    let line = `${n}. ${marker} ${it.text}`;
    if (it.status === 'impossible' && it.evidence) line += ` (impossible: ${it.evidence})`;
    lines.push(line);
  }
  return lines.join('\n');
}

/**
 * After LLM decomposition, keep existing checklist rows (e.g. user-added acceptance criteria)
 * and append judge-generated items, skipping duplicate text (case-insensitive trim).
 */
export function mergeDecomposedChecklistItems(
  existing: GoalChecklistItem[],
  decomposedTexts: { text: string }[],
): GoalChecklistItem[] {
  const now = Date.now();
  const next = existing.map((it) => ({ ...it }));
  const seen = new Set(next.map((it) => it.text.trim().toLowerCase()));
  for (const row of decomposedTexts) {
    const t = row.text.trim();
    if (!t) continue;
    const key = t.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    next.push({
      text: t,
      status: CHECKLIST_ITEM_PENDING,
      addedBy: 'judge',
      addedAt: now,
    });
  }
  return next;
}

export function applyJudgeChecklistUpdates(
  items: GoalChecklistItem[],
  parsed: {
    updates: { index: number; status: ChecklistItemStatus; evidence?: string | null }[];
    newItems: { text: string }[];
  },
): GoalChecklistItem[] {
  const next = items.map((it) => ({ ...it }));
  const now = Date.now();
  for (const upd of parsed.updates) {
    const idx = upd.index;
    if (idx < 0 || idx >= next.length) continue;
    const item = next[idx]!;
    if (TERMINAL_CHECKLIST_STATUSES.has(item.status)) continue;
    if (!TERMINAL_CHECKLIST_STATUSES.has(upd.status)) continue;
    item.status = upd.status;
    item.completedAt = now;
    if (upd.evidence?.trim()) item.evidence = upd.evidence.trim();
  }
  for (const ni of parsed.newItems) {
    const t = ni.text.trim();
    if (!t) continue;
    next.push({
      text: t,
      status: CHECKLIST_ITEM_PENDING,
      addedBy: 'judge',
      addedAt: now,
    });
  }
  return next;
}
