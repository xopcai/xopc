import { apiFetch, formatApiHttpError } from '../api/client';
import type { Language } from '../stores/preferences-store';

export type WebchatChecklistItemWire = {
  text: string;
  status: 'pending' | 'completed' | 'impossible';
  addedBy: 'judge' | 'user';
  addedAt?: number;
  evidence?: string;
};

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
  uiLocale?: 'en' | 'zh';
};

export type GoalWebchatAction = 'pause' | 'resume' | 'clear' | 'restart';

export type ChecklistMutationOp =
  | { op: 'add'; text: string }
  | { op: 'remove'; index: number }
  | { op: 'mark'; index: number; status: 'pending' | 'completed' | 'impossible' }
  | { op: 'reset' };

export type WebchatGoalRunVerdict = 'done' | 'continue' | 'skipped' | 'inactive' | 'decompose';

export type WebchatGoalRunWire = {
  id: string;
  at: number;
  goalTitle: string;
  turnsUsed: number;
  maxTurns: number;
  verdict: WebchatGoalRunVerdict;
  statusAfter: 'active' | 'paused' | 'done' | 'cleared';
  reason?: string;
  willContinue: boolean;
  checklistProgress?: { done: number; total: number };
  assistantPreview?: string;
};

type GetWebchatGoalResponse = {
  ok: true;
  sessionKey: string;
  persistentGoal: WebchatPersistentGoalWire | null;
};

type PostWebchatGoalActionResponse =
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

type PostWebchatChecklistResponse =
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

type GetWebchatGoalRunsResponse = {
  ok: true;
  sessionKey: string;
  runs: WebchatGoalRunWire[];
};

async function parseErrorBody(res: Response): Promise<unknown> {
  return res.json().catch(() => ({}));
}

function throwApiError(res: Response, body: unknown): never {
  const b = body as { error?: { message?: string } } | null;
  throw new Error(formatApiHttpError(res.status, res.statusText, b?.error?.message));
}

export async function fetchWebchatGoal(
  sessionKey: string,
  opts?: { uiLocale?: Language },
): Promise<GetWebchatGoalResponse> {
  const q = new URLSearchParams({ sessionKey });
  if (opts?.uiLocale) q.set('uiLocale', opts.uiLocale);
  const res = await apiFetch(`/api/goals/webchat?${q.toString()}`);
  if (!res.ok) throwApiError(res, await parseErrorBody(res));
  return res.json() as Promise<GetWebchatGoalResponse>;
}

export async function postWebchatGoalAction(
  sessionKey: string,
  action: GoalWebchatAction,
  opts?: { uiLocale?: Language },
): Promise<PostWebchatGoalActionResponse> {
  const res = await apiFetch('/api/goals/webchat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionKey, action, ...(opts?.uiLocale ? { uiLocale: opts.uiLocale } : {}) }),
  });
  if (!res.ok) throwApiError(res, await parseErrorBody(res));
  return res.json() as Promise<PostWebchatGoalActionResponse>;
}

export async function postWebchatChecklistMutation(
  sessionKey: string,
  mutation: ChecklistMutationOp,
  opts?: { uiLocale?: Language },
): Promise<PostWebchatChecklistResponse> {
  const body: Record<string, unknown> = { sessionKey, op: mutation.op };
  if (mutation.op === 'add') body.text = mutation.text;
  if (mutation.op === 'remove' || mutation.op === 'mark') body.index = mutation.index;
  if (mutation.op === 'mark') body.status = mutation.status;
  if (opts?.uiLocale) body.uiLocale = opts.uiLocale;

  const res = await apiFetch('/api/goals/webchat/checklist', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throwApiError(res, await parseErrorBody(res));
  return res.json() as Promise<PostWebchatChecklistResponse>;
}

export async function fetchWebchatGoalRuns(
  sessionKey: string,
  opts?: { limit?: number },
): Promise<GetWebchatGoalRunsResponse> {
  const q = new URLSearchParams({ sessionKey });
  if (opts?.limit != null && Number.isFinite(opts.limit)) {
    q.set('limit', String(Math.min(500, Math.max(1, Math.floor(opts.limit)))));
  }
  const res = await apiFetch(`/api/goals/webchat/runs?${q.toString()}`);
  if (!res.ok) throwApiError(res, await parseErrorBody(res));
  return res.json() as Promise<GetWebchatGoalRunsResponse>;
}
