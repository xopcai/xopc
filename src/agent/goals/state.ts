import {
  CHECKLIST_ITEM_PENDING,
  TERMINAL_CHECKLIST_STATUSES,
  type ChecklistItemAddedBy,
  type ChecklistItemStatus,
  type GoalChecklistItem,
} from './checklist-types.js';

import type { GoalUiLocale } from './goal-locale.js';

/** Persisted under `SessionMetadata.customData.persistentGoal`. */
export const PERSISTENT_GOAL_CUSTOM_KEY = 'persistentGoal';

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

function coerceStatus(s: unknown): PersistentGoalStatus | undefined {
  if (s === 'active' || s === 'paused' || s === 'done' || s === 'cleared') return s;
  return undefined;
}

function coerceChecklistItem(raw: unknown): GoalChecklistItem | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const text = typeof r.text === 'string' ? r.text.trim() : '';
  if (!text) return null;
  const st = typeof r.status === 'string' ? r.status.trim().toLowerCase() : '';
  const status: ChecklistItemStatus =
    st === 'completed' || st === 'impossible' || st === 'pending' ? st : CHECKLIST_ITEM_PENDING;
  const ab = typeof r.addedBy === 'string' ? r.addedBy.trim().toLowerCase() : '';
  const addedBy: ChecklistItemAddedBy = ab === 'user' ? 'user' : 'judge';
  const addedAt =
    typeof r.addedAt === 'number' && Number.isFinite(r.addedAt) ? Math.floor(r.addedAt) : Date.now();
  const completedAt =
    typeof r.completedAt === 'number' && Number.isFinite(r.completedAt) ? Math.floor(r.completedAt) : undefined;
  const evidence = typeof r.evidence === 'string' ? r.evidence : undefined;
  return { text, status, addedBy, addedAt, completedAt, evidence };
}

export function readPersistentGoal(customData: Record<string, unknown> | undefined): PersistentGoalState | null {
  if (!customData || typeof customData !== 'object') return null;

  const raw = customData[PERSISTENT_GOAL_CUSTOM_KEY];
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    const o = raw as Record<string, unknown>;
    const goal = typeof o.goal === 'string' ? o.goal.trim() : '';
    if (!goal) return null;
    const status = coerceStatus(o.status) ?? 'active';
    const maxTurns =
      typeof o.maxTurns === 'number' && Number.isFinite(o.maxTurns)
        ? Math.max(1, Math.min(500, Math.floor(o.maxTurns)))
        : 20;
    const turnsUsed =
      typeof o.turnsUsed === 'number' && Number.isFinite(o.turnsUsed)
        ? Math.max(0, Math.floor(o.turnsUsed))
        : 0;
    const createdAt =
      typeof o.createdAt === 'number' && Number.isFinite(o.createdAt) ? o.createdAt : Date.now();
    const lastTurnAt =
      typeof o.lastTurnAt === 'number' && Number.isFinite(o.lastTurnAt) ? o.lastTurnAt : 0;
    const lastVerdict =
      o.lastVerdict === 'done' ||
      o.lastVerdict === 'continue' ||
      o.lastVerdict === 'skipped' ||
      o.lastVerdict === 'decompose'
        ? o.lastVerdict
        : undefined;
    const lastReason = typeof o.lastReason === 'string' ? o.lastReason : undefined;
    const pausedReason = typeof o.pausedReason === 'string' ? o.pausedReason : undefined;
    const judgeModelRef = typeof o.judgeModelRef === 'string' ? o.judgeModelRef.trim() : undefined;
    const consecutiveParseFailures =
      typeof o.consecutiveParseFailures === 'number' && Number.isFinite(o.consecutiveParseFailures)
        ? Math.max(0, Math.floor(o.consecutiveParseFailures))
        : 0;
    const decomposed = Boolean(o.decomposed);
    const uiLocale = o.uiLocale === 'zh' || o.uiLocale === 'en' ? o.uiLocale : undefined;
    const checklistRaw = o.checklist;
    const checklist: GoalChecklistItem[] = [];
    if (Array.isArray(checklistRaw)) {
      for (const row of checklistRaw) {
        const it = coerceChecklistItem(row);
        if (it) checklist.push(it);
      }
    }
    return {
      goal,
      status,
      turnsUsed,
      maxTurns,
      createdAt,
      lastTurnAt,
      lastVerdict,
      lastReason,
      pausedReason,
      judgeModelRef: judgeModelRef || undefined,
      consecutiveParseFailures,
      decomposed: decomposed || undefined,
      checklist: checklist.length ? checklist : undefined,
      uiLocale,
    };
  }

  return null;
}

export function serializePersistentGoal(s: PersistentGoalState): Record<string, unknown> {
  return {
    goal: s.goal,
    status: s.status,
    turnsUsed: s.turnsUsed,
    maxTurns: s.maxTurns,
    createdAt: s.createdAt,
    lastTurnAt: s.lastTurnAt,
    ...(s.lastVerdict ? { lastVerdict: s.lastVerdict } : {}),
    ...(s.lastReason ? { lastReason: s.lastReason } : {}),
    ...(s.pausedReason ? { pausedReason: s.pausedReason } : {}),
    ...(s.judgeModelRef ? { judgeModelRef: s.judgeModelRef } : {}),
    ...(s.consecutiveParseFailures ? { consecutiveParseFailures: s.consecutiveParseFailures } : {}),
    ...(s.decomposed ? { decomposed: true } : {}),
    ...(s.uiLocale ? { uiLocale: s.uiLocale } : {}),
    ...(s.checklist?.length
      ? {
          checklist: s.checklist.map((it) => ({
            text: it.text,
            status: it.status,
            addedBy: it.addedBy,
            addedAt: it.addedAt,
            ...(it.completedAt !== undefined ? { completedAt: it.completedAt } : {}),
            ...(it.evidence ? { evidence: it.evidence } : {}),
          })),
        }
      : {}),
  };
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


export function mergeCustomDataPatch(
  existingCustom: Record<string, unknown> | undefined,
  patch: Record<string, unknown>,
): Record<string, unknown> {
  return { ...(existingCustom ?? {}), ...patch };
}
