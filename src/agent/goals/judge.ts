import type { UserMessage } from '@earendil-works/pi-ai';
import { complete } from '@earendil-works/pi-ai';

import { getApiKey, resolveModel } from '../../providers/index.js';

import type { GoalUiLocale } from './goal-locale.js';
import {
  goalUiLocaleOrFallback,
  judgeFreeformBuiltinMessages,
  JUDGE_REASON_EN,
  judgeResponseLanguageNote,
  localizeJudgeReasonText,
} from './goal-locale.js';

const JUDGE_RESPONSE_SNIPPET_CHARS = 4000;

/**
 * Extract visible text from a pi-ai `AssistantMessage.content` array.
 * Handles `TextContent` (`type: 'text'`) and falls back to `ThinkingContent`
 * (`type: 'thinking'`) when the text blocks are empty — reasoning models
 * (DeepSeek-R1, Qwen-thinking, etc.) may place the entire response inside
 * thinking blocks, leaving the text portion blank.
 */
export function extractAssistantText(content: unknown): string {
  if (!Array.isArray(content)) return '';

  let textParts = '';
  let thinkingParts = '';

  for (const block of content) {
    if (!block || typeof block !== 'object') continue;
    const typed = block as Record<string, unknown>;
    const blockType = typed.type;
    if (blockType === 'text' && typeof typed.text === 'string') {
      textParts += typed.text;
    } else if (blockType === 'thinking') {
      const thinking =
        typeof typed.thinking === 'string'
          ? typed.thinking
          : typeof typed.text === 'string'
            ? typed.text
            : '';
      thinkingParts += thinking;
    }
  }

  // Prefer text blocks; fall back to thinking blocks when text is empty.
  return textParts.trim() ? textParts : thinkingParts;
}

/**
 * Strip markdown code fences (opening AND closing) from raw model output.
 * Handles `` ```json ``, `` ``` ``, and trailing `` ``` `` with optional whitespace.
 */
export function stripCodeFences(raw: string): string {
  let text = raw.trim();

  // Remove opening code fence: ```<optional-lang>\n
  const openMatch = text.match(/^`{3,}[^\n]*\n?/);
  if (openMatch) {
    text = text.slice(openMatch[0].length);
  }

  // Remove closing code fence: \n```<optional-whitespace>
  const closeMatch = text.match(/\n?`{3,}\s*$/);
  if (closeMatch) {
    text = text.slice(0, -closeMatch[0].length);
  }

  return text.trim();
}

/** Mirrors `hermes_cli/goals.py` — strict judge, JSON-only reply. */
export const JUDGE_SYSTEM_PROMPT =
  'You are a strict judge evaluating whether an autonomous agent has ' +
  "achieved a user's stated goal. You receive the goal text and the " +
  "agent's most recent response. Your only job is to decide whether " +
  'the goal is fully satisfied based on that response.\n\n' +
  'A goal is DONE only when:\n' +
  '- The response explicitly confirms the goal was completed, OR\n' +
  '- The response clearly shows the final deliverable was produced, OR\n' +
  '- The response explains the goal is unachievable / blocked / needs ' +
  'user input (treat this as DONE with reason describing the block).\n\n' +
  'Otherwise the goal is NOT done — CONTINUE.\n\n' +
  'Reply ONLY with a single JSON object on one line:\n' +
  '{"done": <true|false>, "reason": "<one-sentence rationale>"}';

export const JUDGE_USER_PROMPT_TEMPLATE =
  'Goal:\n{goal}\n\n' + "Agent's most recent response:\n{response}\n\n" + 'Is the goal satisfied?';

export const DEFAULT_JUDGE_TIMEOUT_MS = 60_000;

export function truncateGoalText(text: string, limit: number): string {
  if (!text) return '';
  if (text.length <= limit) return text;
  return text.slice(0, limit) + '… [truncated]';
}

export async function resolveGoalJudgeApiKey(
  model: ReturnType<typeof resolveModel>,
): Promise<string | undefined> {
  try {
    return await getApiKey(model.provider);
  } catch {
    return undefined;
  }
}

export function getAssistantMessageErrorReason(message: unknown): string | null {
  if (!message || typeof message !== 'object') return null;

  const record = message as Record<string, unknown>;
  const stopReason = record.stopReason;
  const errorMessage = typeof record.errorMessage === 'string' ? record.errorMessage.trim() : '';

  if (stopReason === 'error') {
    return errorMessage || 'Judge model call failed.';
  }

  return null;
}

/** Parse judge JSON — fail-open to **continue** (Hermes semantics). */
export function parseJudgeResponseFailOpen(raw: string): {
  done: boolean;
  reason: string;
  parseFailed: boolean;
} {
  if (!raw?.trim()) {
    return { done: false, reason: JUDGE_REASON_EN.judge_returned_empty, parseFailed: true };
  }

  const text = stripCodeFences(raw);

  let data: Record<string, unknown> | null = null;
  try {
    data = JSON.parse(text) as Record<string, unknown>;
  } catch {
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start !== -1 && end > start) {
      try {
        data = JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>;
      } catch {
        data = null;
      }
    }
  }

  if (!data || typeof data !== 'object') {
    return { done: false, reason: JUDGE_REASON_EN.judge_reply_not_json, parseFailed: true };
  }

  const doneVal = data.done;
  let done: boolean;
  if (typeof doneVal === 'string') {
    done = ['true', 'yes', '1', 'done'].includes(doneVal.trim().toLowerCase());
  } else {
    done = Boolean(doneVal);
  }
  const reason = typeof data.reason === 'string' ? data.reason.trim() : '';
  return { done, reason: reason || JUDGE_REASON_EN.no_reason_provided, parseFailed: false };
}

export type GoalJudgeVerdict = 'done' | 'continue' | 'skipped';

/**
 * Ask the configured model whether the goal is satisfied.
 * Fail-open: any error → `continue` (Hermes — turn budget is the backstop).
 */
export async function judgeGoalHermesStyle(
  goal: string,
  lastResponse: string,
  judgeModelRef: string,
  signal?: AbortSignal,
  opts?: { judgeTimeoutMs?: number; uiLocale?: GoalUiLocale },
): Promise<{ verdict: GoalJudgeVerdict; reason: string; parseFailed: boolean }> {
  const locale = goalUiLocaleOrFallback(opts?.uiLocale);
  const b = judgeFreeformBuiltinMessages(locale);

  if (!goal.trim()) {
    return { verdict: 'skipped', reason: b.emptyGoal, parseFailed: false };
  }
  if (!lastResponse.trim()) {
    return { verdict: 'continue', reason: b.emptyResponse, parseFailed: false };
  }

  let model: ReturnType<typeof resolveModel>;
  try {
    model = resolveModel(judgeModelRef);
  } catch {
    return { verdict: 'continue', reason: b.noModel, parseFailed: false };
  }

  const userContent =
    JUDGE_USER_PROMPT_TEMPLATE.replace('{goal}', truncateGoalText(goal, 2000)).replace(
      '{response}',
      truncateGoalText(lastResponse, JUDGE_RESPONSE_SNIPPET_CHARS),
    ) + judgeResponseLanguageNote(locale);

  const timeoutMs =
    typeof opts?.judgeTimeoutMs === 'number' && Number.isFinite(opts.judgeTimeoutMs)
      ? Math.max(5_000, Math.min(120_000, Math.floor(opts.judgeTimeoutMs)))
      : DEFAULT_JUDGE_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const merged = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;

  try {
    const combinedUser: UserMessage = {
      role: 'user',
      content: `${JUDGE_SYSTEM_PROMPT}\n\n${userContent}`,
      timestamp: Date.now(),
    };

    const apiKey = await resolveGoalJudgeApiKey(model);
    const result = await complete(
      model,
      {
        messages: [combinedUser],
      },
      { apiKey, maxTokens: 200, temperature: 0, signal: merged },
    );
    const errorReason = getAssistantMessageErrorReason(result);
    if (errorReason) {
      return { verdict: 'continue', reason: b.callFailed, parseFailed: false };
    }

    const text = extractAssistantText(result.content);
    const { done, reason, parseFailed } = parseJudgeResponseFailOpen(text);
    const reasonOut = localizeJudgeReasonText(reason, locale);
    return { verdict: done ? 'done' : 'continue', reason: reasonOut, parseFailed };
  } catch {
    return { verdict: 'continue', reason: b.callFailed, parseFailed: false };
  } finally {
    clearTimeout(timer);
  }
}
