import { fetchJson } from '@/lib/fetch';
import { apiUrl } from '@/lib/url';
import type { StoredLanguage } from '@/lib/storage';

/** Mirrors server checklist rows for UI. */
export type WebchatChecklistItemWire = {
  text: string;
  status: 'pending' | 'completed' | 'impossible';
  addedBy: 'judge' | 'user';
  addedAt?: number;
  evidence?: string;
};

/** Mirrors server `PersistentGoalState` subset for UI. */
export type WebchatPersistentGoalWire = {
  goal: string;
  status: 'active' | 'paused' | 'done' | 'cleared';
  turnsUsed: number;
  maxTurns: number;
  createdAt: number;
  lastTurnAt: number;
  lastVerdict?: 'done' | 'continue' | 'skipped' | 'decompose';
  lastReason?: string;
  pausedReason?: string;
  judgeModelRef?: string;
  decomposed?: boolean;
  consecutiveParseFailures?: number;
  checklist?: WebchatChecklistItemWire[];
  /** Gateway console language — drives judge reason language and system copy. */
  uiLocale?: 'en' | 'zh';
};

export type GoalWebchatAction = 'pause' | 'resume' | 'clear' | 'restart';

export type GetWebchatGoalResponse = {
  ok: true;
  sessionKey: string;
  persistentGoal: WebchatPersistentGoalWire | null;
};

export type PostWebchatGoalActionResponse =
  | {
      ok: true;
      sessionKey: string;
      action: GoalWebchatAction;
      persistentGoal: WebchatPersistentGoalWire | null;
    }
  | {
      ok: true;
      sessionKey: string;
      noop: true;
      message: string;
      persistentGoal: WebchatPersistentGoalWire | null;
    };

export type ChecklistMutationOp =
  | { op: 'add'; text: string }
  | { op: 'remove'; index: number }
  | { op: 'mark'; index: number; status: 'pending' | 'completed' | 'impossible' }
  | { op: 'reset' };

export type PostWebchatChecklistResponse =
  | {
      ok: true;
      sessionKey: string;
      op: string;
      persistentGoal: WebchatPersistentGoalWire | null;
    }
  | {
      ok: true;
      sessionKey: string;
      noop: true;
      message: string;
      persistentGoal: WebchatPersistentGoalWire | null;
    };

export async function fetchWebchatGoal(
  sessionKey: string,
  opts?: { uiLocale?: StoredLanguage },
): Promise<GetWebchatGoalResponse> {
  const q = new URLSearchParams({ sessionKey });
  if (opts?.uiLocale) q.set('uiLocale', opts.uiLocale);
  return fetchJson<GetWebchatGoalResponse>(apiUrl(`/api/goals/webchat?${q.toString()}`));
}

export async function postWebchatGoalAction(
  sessionKey: string,
  action: GoalWebchatAction,
  opts?: { uiLocale?: StoredLanguage },
): Promise<PostWebchatGoalActionResponse> {
  return fetchJson<PostWebchatGoalActionResponse>(apiUrl('/api/goals/webchat'), {
    method: 'POST',
    body: JSON.stringify({ sessionKey, action, ...(opts?.uiLocale ? { uiLocale: opts.uiLocale } : {}) }),
  });
}

export async function postWebchatChecklistMutation(
  sessionKey: string,
  mutation: ChecklistMutationOp,
  opts?: { uiLocale?: StoredLanguage },
): Promise<PostWebchatChecklistResponse> {
  const body: Record<string, unknown> = { sessionKey, op: mutation.op };
  if (mutation.op === 'add') body.text = mutation.text;
  if (mutation.op === 'remove' || mutation.op === 'mark') body.index = mutation.index;
  if (mutation.op === 'mark') body.status = mutation.status;
  if (opts?.uiLocale) body.uiLocale = opts.uiLocale;
  return fetchJson<PostWebchatChecklistResponse>(apiUrl('/api/goals/webchat/checklist'), {
    method: 'POST',
    body: JSON.stringify(body),
  });
}
