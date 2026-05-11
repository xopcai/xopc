import type { UserMessage } from '@earendil-works/pi-ai';
import { complete } from '@earendil-works/pi-ai';

import { resolveModel } from '../../providers/index.js';

import { DEFAULT_JUDGE_TIMEOUT_MS, truncateGoalText } from './judge.js';

const GOAL_TRUNC = 4000;
const RESPONSE_SNIPPET = 4000;
const HISTORY_TRUNC = 24_000;

const DECOMPOSE_SYSTEM = (
  'You break a user goal into an EXTREMELY detailed checklist of concrete, verifiable completion criteria. ' +
  'Bias toward more items. Each item is one factual statement about finished work.\n\n' +
  'Reply ONLY with a single JSON object on one line:\n' +
  '{"items":[{"text":"..."},...]}\n' +
  'Use at least 3 items when the goal warrants it.'
);

const DECOMPOSE_USER = 'Goal:\n{goal}\n\nReturn JSON only.';

const EVALUATE_CHECKLIST_SYSTEM = (
  'You evaluate an autonomous agent\'s progress on a goal with a numbered checklist.\n' +
  'For each pending item, decide if evidence in the agent snippet and/or history excerpt shows it is satisfied.\n' +
  'Flip pending→completed only with clear evidence; pending→impossible only if truly unachievable here.\n' +
  'Do not regress completed/impossible items — omit them from updates.\n\n' +
  'Reply ONLY with one JSON object on one line. Field "updates" is an array of ' +
  '{"index": <1-based number>, "status": "completed" or "impossible", "evidence": "short citation"}. ' +
  'Field "new_items" is an array of {"text": "..."} for missing criteria. ' +
  'Field "reason" is one sentence. updates and new_items may be empty arrays.'
);

function extractJsonObject(raw: string): Record<string, unknown> | null {
  if (!raw?.trim()) return null;
  let text = raw.trim();
  if (text.startsWith('```')) {
    text = text.replace(/^`+/, '');
    const nl = text.indexOf('\n');
    if (nl !== -1) text = text.slice(nl + 1);
  }
  try {
    const data = JSON.parse(text) as unknown;
    return data && typeof data === 'object' && !Array.isArray(data) ? (data as Record<string, unknown>) : null;
  } catch {
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start === -1 || end <= start) return null;
    try {
      const data = JSON.parse(text.slice(start, end + 1)) as unknown;
      return data && typeof data === 'object' && !Array.isArray(data) ? (data as Record<string, unknown>) : null;
    } catch {
      return null;
    }
  }
}

export type DecomposeChecklistResult = {
  items: { text: string }[];
  parseFailed: boolean;
  errorReason?: string;
};

export async function decomposeGoalChecklist(opts: {
  goal: string;
  judgeModelRef: string;
  signal?: AbortSignal;
  judgeTimeoutMs?: number;
}): Promise<DecomposeChecklistResult> {
  const goal = opts.goal.trim();
  if (!goal) return { items: [], parseFailed: false, errorReason: 'empty goal' };

  let model: ReturnType<typeof resolveModel>;
  try {
    model = resolveModel(opts.judgeModelRef);
  } catch {
    return { items: [], parseFailed: false, errorReason: 'judge model not configured' };
  }

  const timeoutMs =
    typeof opts.judgeTimeoutMs === 'number' && Number.isFinite(opts.judgeTimeoutMs)
      ? Math.max(5_000, Math.min(120_000, Math.floor(opts.judgeTimeoutMs)))
      : DEFAULT_JUDGE_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const merged = opts.signal ? AbortSignal.any([opts.signal, controller.signal]) : controller.signal;

  try {
    const user: UserMessage = {
      role: 'user',
      content: `${DECOMPOSE_SYSTEM}\n\n${DECOMPOSE_USER.replace('{goal}', truncateGoalText(goal, GOAL_TRUNC))}`,
      timestamp: Date.now(),
    };
    const result = await complete(model, { messages: [user] }, { maxTokens: 2000, temperature: 0, signal: merged });
    let text = '';
    if (Array.isArray(result.content)) {
      for (const c of result.content) {
        if (c && typeof c === 'object' && (c as { type?: string }).type === 'text') {
          text += String((c as { text?: string }).text || '');
        }
      }
    }
    const data = extractJsonObject(text);
    if (!data) return { items: [], parseFailed: true, errorReason: 'decompose reply was not JSON' };
    const rawItems = data.items ?? data.checklist;
    if (!Array.isArray(rawItems)) return { items: [], parseFailed: true, errorReason: 'missing items array' };
    const items: { text: string }[] = [];
    for (const row of rawItems) {
      if (typeof row === 'string') {
        const t = row.trim();
        if (t) items.push({ text: t });
      } else if (row && typeof row === 'object' && !Array.isArray(row)) {
        const t = String((row as { text?: string }).text ?? '').trim();
        if (t) items.push({ text: t });
      }
    }
    if (!items.length) return { items: [], parseFailed: true, errorReason: 'empty checklist' };
    return { items, parseFailed: false };
  } catch {
    return { items: [], parseFailed: false, errorReason: 'decompose call failed' };
  } finally {
    clearTimeout(timer);
  }
}

export type ChecklistJudgeUpdate = {
  index: number;
  status: 'completed' | 'impossible';
  evidence?: string | null;
};

export type ChecklistEvaluateParsed = {
  updates: ChecklistJudgeUpdate[];
  newItems: { text: string }[];
  reason: string;
};

export type EvaluateChecklistResult = {
  parsed: ChecklistEvaluateParsed;
  parseFailed: boolean;
};

export async function evaluateGoalChecklistJudge(opts: {
  goal: string;
  numberedChecklist: string;
  lastResponse: string;
  historyExcerpt: string;
  judgeModelRef: string;
  signal?: AbortSignal;
  judgeTimeoutMs?: number;
}): Promise<EvaluateChecklistResult> {
  let model: ReturnType<typeof resolveModel>;
  try {
    model = resolveModel(opts.judgeModelRef);
  } catch {
    return {
      parsed: { updates: [], newItems: [], reason: 'judge model not configured' },
      parseFailed: false,
    };
  }

  const userBody =
    `Goal:\n${truncateGoalText(opts.goal, 2000)}\n\n` +
    `Current checklist (1-based indices):\n${opts.numberedChecklist}\n\n` +
    `Agent's most recent response (snippet):\n${truncateGoalText(opts.lastResponse, RESPONSE_SNIPPET)}\n\n` +
    `Recent conversation excerpt (JSON or text, may be truncated):\n` +
    `${truncateGoalText(opts.historyExcerpt, HISTORY_TRUNC) || '(none)'}`;

  const timeoutMs =
    typeof opts.judgeTimeoutMs === 'number' && Number.isFinite(opts.judgeTimeoutMs)
      ? Math.max(5_000, Math.min(120_000, Math.floor(opts.judgeTimeoutMs)))
      : DEFAULT_JUDGE_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const merged = opts.signal ? AbortSignal.any([opts.signal, controller.signal]) : controller.signal;

  try {
    const user: UserMessage = {
      role: 'user',
      content: `${EVALUATE_CHECKLIST_SYSTEM}\n\n${userBody}`,
      timestamp: Date.now(),
    };
    const result = await complete(model, { messages: [user] }, { maxTokens: 1500, temperature: 0, signal: merged });
    let text = '';
    if (Array.isArray(result.content)) {
      for (const c of result.content) {
        if (c && typeof c === 'object' && (c as { type?: string }).type === 'text') {
          text += String((c as { text?: string }).text || '');
        }
      }
    }
    const data = extractJsonObject(text);
    if (!data) {
      return {
        parsed: { updates: [], newItems: [], reason: 'judge reply was not JSON' },
        parseFailed: true,
      };
    }
    const updatesRaw = data.updates;
    const newRaw = data.new_items ?? data.newItems;
    const reason = typeof data.reason === 'string' ? data.reason.trim() : 'no reason provided';
    const updates: ChecklistJudgeUpdate[] = [];
    if (Array.isArray(updatesRaw)) {
      for (const u of updatesRaw) {
        if (!u || typeof u !== 'object' || Array.isArray(u)) continue;
        const rec = u as Record<string, unknown>;
        const idx1 = Number(rec.index);
        if (!Number.isFinite(idx1)) continue;
        const idx0 = Math.floor(idx1) - 1;
        const st = String(rec.status ?? '').trim().toLowerCase();
        if (st !== 'completed' && st !== 'impossible') continue;
        const evidence = typeof rec.evidence === 'string' ? rec.evidence : null;
        updates.push({ index: idx0, status: st, evidence });
      }
    }
    const newItems: { text: string }[] = [];
    if (Array.isArray(newRaw)) {
      for (const row of newRaw) {
        if (typeof row === 'string') {
          const t = row.trim();
          if (t) newItems.push({ text: t });
        } else if (row && typeof row === 'object' && !Array.isArray(row)) {
          const t = String((row as { text?: string }).text ?? '').trim();
          if (t) newItems.push({ text: t });
        }
      }
    }
    return { parsed: { updates, newItems, reason: reason || 'no reason provided' }, parseFailed: false };
  } catch {
    return {
      parsed: { updates: [], newItems: [], reason: 'judge call failed' },
      parseFailed: false,
    };
  } finally {
    clearTimeout(timer);
  }
}
