import type { UserMessage } from '@mariozechner/pi-ai';
import { complete } from '@mariozechner/pi-ai';

import { resolveModel } from '../../providers/index.js';

const JUDGE_RESPONSE_SNIPPET_CHARS = 4000;

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

const DEFAULT_JUDGE_TIMEOUT_MS = 30_000;

function truncate(text: string, limit: number): string {
  if (!text) return '';
  if (text.length <= limit) return text;
  return text.slice(0, limit) + '… [truncated]';
}

/** Parse judge JSON — fail-open to **continue** (Hermes semantics). */
export function parseJudgeResponseFailOpen(raw: string): { done: boolean; reason: string } {
  if (!raw?.trim()) {
    return { done: false, reason: 'judge returned empty response' };
  }

  let text = raw.trim();
  if (text.startsWith('```')) {
    text = text.replace(/^`+/, '');
    const nl = text.indexOf('\n');
    if (nl !== -1) text = text.slice(nl + 1);
  }

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
    return { done: false, reason: 'judge reply was not JSON' };
  }

  const doneVal = data.done;
  let done: boolean;
  if (typeof doneVal === 'string') {
    done = ['true', 'yes', '1', 'done'].includes(doneVal.trim().toLowerCase());
  } else {
    done = Boolean(doneVal);
  }
  const reason = typeof data.reason === 'string' ? data.reason.trim() : '';
  return { done, reason: reason || 'no reason provided' };
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
): Promise<{ verdict: GoalJudgeVerdict; reason: string }> {
  if (!goal.trim()) {
    return { verdict: 'skipped', reason: 'empty goal' };
  }
  if (!lastResponse.trim()) {
    return { verdict: 'continue', reason: 'empty response (nothing to evaluate)' };
  }

  let model: ReturnType<typeof resolveModel>;
  try {
    model = resolveModel(judgeModelRef);
  } catch {
    return { verdict: 'continue', reason: 'judge model not configured' };
  }

  const userContent = JUDGE_USER_PROMPT_TEMPLATE.replace('{goal}', truncate(goal, 2000)).replace(
    '{response}',
    truncate(lastResponse, JUDGE_RESPONSE_SNIPPET_CHARS),
  );

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DEFAULT_JUDGE_TIMEOUT_MS);
  const merged = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;

  try {
    const combinedUser: UserMessage = {
      role: 'user',
      content: `${JUDGE_SYSTEM_PROMPT}\n\n${userContent}`,
      timestamp: Date.now(),
    };

    const result = await complete(
      model,
      {
        messages: [combinedUser],
      },
      { maxTokens: 200, temperature: 0, signal: merged },
    );
    let text = '';
    if (Array.isArray(result.content)) {
      for (const c of result.content) {
        if (c && typeof c === 'object' && (c as { type?: string }).type === 'text') {
          text += String((c as { text?: string }).text || '');
        }
      }
    }
    const { done, reason } = parseJudgeResponseFailOpen(text);
    return { verdict: done ? 'done' : 'continue', reason };
  } catch {
    return { verdict: 'continue', reason: 'judge call failed' };
  } finally {
    clearTimeout(timer);
  }
}
