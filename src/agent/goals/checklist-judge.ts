import type { UserMessage } from '@earendil-works/pi-ai';
import { complete } from '@earendil-works/pi-ai';

import { resolveModel } from '../../providers/index.js';

import {
  DEFAULT_JUDGE_TIMEOUT_MS,
  extractAssistantText,
  getAssistantMessageErrorReason,
  resolveGoalJudgeApiKey,
  stripCodeFences,
  truncateGoalText,
} from './judge.js';
import type { GoalUiLocale } from './goal-locale.js';
import {
  goalUiLocaleOrFallback,
  judgeReasonText,
  judgeResponseLanguageNote,
  JUDGE_REASON_EN,
  localizeJudgeReasonText,
} from './goal-locale.js';

const GOAL_TRUNC = 4000;
const RESPONSE_SNIPPET = 4000;
const HISTORY_TRUNC = 24_000;

const DECOMPOSE_SYSTEM = (
  'You break a user goal into an EXTREMELY detailed checklist of concrete, verifiable completion criteria. ' +
  'Bias toward more items. Each item is one factual statement about finished work.\n\n' +
  'If existing acceptance criteria are provided, return only missing supplemental criteria. ' +
  'Do not repeat, rewrite, or replace existing criteria.\n\n' +
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
  'Reply ONLY with one JSON object on one line:\n' +
  '{"verdict":"continue|done|blocked|needs_input","confidence":0.0,"reason":"...",' +
  '"nextAction":"...","missingEvidence":["..."],"userQuestion":"...",' +
  '"updates":[{"index":1,"status":"completed|impossible","evidence":"short citation"}],' +
  '"new_items":[{"text":"..."}]}\n' +
  'Use verdict=done only when all checklist criteria are complete/impossible. ' +
  'Use needs_input when the next step requires user input. Use blocked when external progress is impossible.'
);

function extractJsonObject(raw: string): Record<string, unknown> | null {
  if (!raw?.trim()) return null;
  const text = stripCodeFences(raw);
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
  existingChecklist?: string;
  judgeModelRef: string;
  signal?: AbortSignal;
  judgeTimeoutMs?: number;
  uiLocale?: GoalUiLocale;
}): Promise<DecomposeChecklistResult> {
  const locale = goalUiLocaleOrFallback(opts.uiLocale);
  const goal = opts.goal.trim();
  if (!goal)
    return { items: [], parseFailed: false, errorReason: judgeReasonText('empty_goal', locale) };

  let model: ReturnType<typeof resolveModel>;
  try {
    model = resolveModel(opts.judgeModelRef);
  } catch {
    return {
      items: [],
      parseFailed: false,
      errorReason: judgeReasonText('judge_model_not_configured', locale),
    };
  }

  const timeoutMs =
    typeof opts.judgeTimeoutMs === 'number' && Number.isFinite(opts.judgeTimeoutMs)
      ? Math.max(5_000, Math.min(120_000, Math.floor(opts.judgeTimeoutMs)))
      : DEFAULT_JUDGE_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const merged = opts.signal ? AbortSignal.any([opts.signal, controller.signal]) : controller.signal;

  try {
    const existingChecklist = opts.existingChecklist?.trim();
    const decomposeUser = DECOMPOSE_USER.replace('{goal}', truncateGoalText(goal, GOAL_TRUNC)) +
      (existingChecklist
        ? `\n\nExisting acceptance criteria:\n${truncateGoalText(existingChecklist, GOAL_TRUNC)}\n\nReturn only missing supplemental criteria as JSON.`
        : '');
    const user: UserMessage = {
      role: 'user',
      content:
        `${DECOMPOSE_SYSTEM}\n\n${decomposeUser}` +
        judgeResponseLanguageNote(locale),
      timestamp: Date.now(),
    };
    const apiKey = await resolveGoalJudgeApiKey(model);
    const result = await complete(
      model,
      { messages: [user] },
      { apiKey, maxTokens: 2000, temperature: 0, signal: merged },
    );
    const errorReason = getAssistantMessageErrorReason(result);
    if (errorReason) {
      return {
        items: [],
        parseFailed: false,
        errorReason: judgeReasonText('decompose_call_failed', locale),
      };
    }

    const text = extractAssistantText(result.content);
    const data = extractJsonObject(text);
    if (!data)
      return {
        items: [],
        parseFailed: true,
        errorReason: judgeReasonText('decompose_reply_not_json', locale),
      };
    const rawItems = data.items ?? data.checklist;
    if (!Array.isArray(rawItems))
      return {
        items: [],
        parseFailed: true,
        errorReason: judgeReasonText('missing_items_array', locale),
      };
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
    if (!items.length)
      return { items: [], parseFailed: true, errorReason: judgeReasonText('empty_checklist', locale) };
    return { items, parseFailed: false };
  } catch {
    return {
      items: [],
      parseFailed: false,
      errorReason: judgeReasonText('decompose_call_failed', locale),
    };
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
  verdict: 'continue' | 'done' | 'blocked' | 'needs_input';
  confidence: number;
  updates: ChecklistJudgeUpdate[];
  newItems: { text: string }[];
  reason: string;
  nextAction?: string;
  missingEvidence?: string[];
  userQuestion?: string;
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
  goalContextExcerpt?: string;
  judgeModelRef: string;
  signal?: AbortSignal;
  judgeTimeoutMs?: number;
  uiLocale?: GoalUiLocale;
}): Promise<EvaluateChecklistResult> {
  const locale = goalUiLocaleOrFallback(opts.uiLocale);
  let model: ReturnType<typeof resolveModel>;
  try {
    model = resolveModel(opts.judgeModelRef);
  } catch {
    return {
      parsed: {
        verdict: 'continue',
        confidence: 0,
        updates: [],
        newItems: [],
        reason: judgeReasonText('judge_model_not_configured', locale),
      },
      parseFailed: false,
    };
  }

  const userBody =
    `Goal:\n${truncateGoalText(opts.goal, 2000)}\n\n` +
    `Current checklist (1-based indices):\n${opts.numberedChecklist}\n\n` +
    `Original goal context and attachments:\n${truncateGoalText(opts.goalContextExcerpt ?? '', 4000) || '(none)'}\n\n` +
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
      content: `${EVALUATE_CHECKLIST_SYSTEM}\n\n${userBody}` + judgeResponseLanguageNote(locale),
      timestamp: Date.now(),
    };
    const apiKey = await resolveGoalJudgeApiKey(model);
    const result = await complete(
      model,
      { messages: [user] },
      { apiKey, maxTokens: 1500, temperature: 0, signal: merged },
    );
    const errorReason = getAssistantMessageErrorReason(result);
    if (errorReason) {
      return {
        parsed: {
          verdict: 'continue',
          confidence: 0,
          updates: [],
          newItems: [],
          reason: judgeReasonText('judge_call_failed', locale),
        },
        parseFailed: false,
      };
    }

    const text = extractAssistantText(result.content);
    const data = extractJsonObject(text);
    if (!data) {
      return {
        parsed: {
          verdict: 'continue',
          confidence: 0,
          updates: [],
          newItems: [],
          reason: judgeReasonText('judge_reply_not_json', locale),
        },
        parseFailed: true,
      };
    }
    const updatesRaw = data.updates;
    const newRaw = data.new_items ?? data.newItems;
    const verdictRaw = String(data.verdict ?? '').trim().toLowerCase();
    const verdict =
      verdictRaw === 'done' || verdictRaw === 'blocked' || verdictRaw === 'needs_input'
        ? verdictRaw
        : 'continue';
    const confidenceRaw = Number(data.confidence);
    const confidence = Number.isFinite(confidenceRaw) ? Math.max(0, Math.min(1, confidenceRaw)) : 0;
    const nextAction = typeof data.nextAction === 'string' ? data.nextAction.trim() : undefined;
    const userQuestion = typeof data.userQuestion === 'string' ? data.userQuestion.trim() : undefined;
    const missingEvidenceRaw = data.missingEvidence ?? data.missing_evidence;
    const trimmed = typeof data.reason === 'string' ? data.reason.trim() : '';
    const inner = trimmed || JUDGE_REASON_EN.no_reason_provided;
    const reason = localizeJudgeReasonText(inner, locale);
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
    const missingEvidence: string[] = [];
    if (Array.isArray(missingEvidenceRaw)) {
      for (const item of missingEvidenceRaw) {
        if (typeof item === 'string' && item.trim()) missingEvidence.push(item.trim());
      }
    }
    return {
      parsed: {
        verdict,
        confidence,
        updates,
        newItems,
        reason: reason || judgeReasonText('no_reason_provided', locale),
        ...(nextAction ? { nextAction } : {}),
        ...(missingEvidence.length ? { missingEvidence } : {}),
        ...(userQuestion ? { userQuestion } : {}),
      },
      parseFailed: false,
    };
  } catch {
    return {
      parsed: {
        verdict: 'continue',
        confidence: 0,
        updates: [],
        newItems: [],
        reason: judgeReasonText('judge_call_failed', locale),
      },
      parseFailed: false,
    };
  } finally {
    clearTimeout(timer);
  }
}
