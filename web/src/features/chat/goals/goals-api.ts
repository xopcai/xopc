import { fetchJson } from '@/lib/fetch';
import { apiUrl } from '@/lib/url';
import type { StoredLanguage } from '@/lib/storage';

export type WebchatChecklistItemWire = {
  id: string;
  goalId: string;
  text: string;
  status: 'pending' | 'completed' | 'impossible';
  addedBy: 'judge' | 'user';
  addedAt?: number;
  completedAt?: number;
  evidenceSummary?: string;
};

export type WebchatGoalRunVerdict = 'done' | 'continue' | 'blocked' | 'needs_input' | 'decompose';

export type WebchatGoalRunWire = {
  id: string;
  goalId: string;
  sessionKey: string;
  source: 'chat' | 'cli' | 'cron' | 'workflow' | 'channel' | 'api';
  status: 'running' | 'succeeded' | 'failed' | 'aborted';
  startedAt: number;
  finishedAt?: number;
  verdict?: WebchatGoalRunVerdict;
  reason?: string;
  nextAction?: string;
  assistantPreview?: string;
  checklistProgress?: { done: number; total: number };
  at: number;
  turnsUsed: number;
  maxTurns: number;
  statusAfter: WebchatPersistentGoalWire['status'];
  willContinue: boolean;
};

export type GoalQueueItemWire = {
  id: string;
  goalId: string;
  status: 'queued' | 'running' | 'retry_waiting' | 'succeeded' | 'failed' | 'skipped';
  source: 'manual' | 'cron' | 'workflow' | 'api';
  message?: string;
  enqueuedAt: number;
  startedAt?: number;
  finishedAt?: number;
  nextRunAt?: number;
  attempts: number;
  maxRetries: number;
  sessionKey?: string;
  error?: string;
};

export type WebchatPersistentGoalWire = {
  id: string;
  title: string;
  description?: string;
  status: 'active' | 'paused' | 'blocked' | 'needs_input' | 'done' | 'archived';
  turnsUsed: number;
  maxTurns: number;
  createdAt: number;
  updatedAt: number;
  completedAt?: number;
  archivedAt?: number;
  activeSessionKey?: string;
  currentRunId?: string;
  nextAction?: string;
  blockedReason?: string;
  judgeModelRef?: string;
  checklist: WebchatChecklistItemWire[];
  latestRun?: WebchatGoalRunWire;
  lastTurnAt: number;
  lastVerdict?: WebchatGoalRunVerdict;
  lastReason?: string;
  uiLocale?: 'en' | 'zh';
};

export type GoalWebchatAction = 'pause' | 'resume' | 'clear' | 'restart' | 'detach';

export type GetWebchatGoalResponse = {
  ok: true;
  goal: WebchatPersistentGoalWire | null;
};

export type PostWebchatGoalActionResponse = {
  ok: true;
  goal: WebchatPersistentGoalWire | null;
};

export type ListGoalsResponse = {
  ok: true;
  goals: WebchatPersistentGoalWire[];
};

export type GetGoalQueueResponse = {
  ok: true;
  queue: GoalQueueItemWire[];
};

export type ChecklistMutationOp =
  | { op: 'add'; text: string }
  | { op: 'remove'; index: number }
  | { op: 'mark'; index: number; status: 'pending' | 'completed' | 'impossible' }
  | { op: 'reset' };

export type PostWebchatChecklistResponse = {
  ok: true;
  goal: WebchatPersistentGoalWire | null;
};

export type GetWebchatGoalRunsResponse = {
  ok: true;
  runs: WebchatGoalRunWire[];
};

function normalizeRun(raw: WebchatGoalRunWire, goal?: WebchatPersistentGoalWire): WebchatGoalRunWire {
  const at = raw.finishedAt ?? raw.startedAt ?? raw.at;
  const verdict = raw.verdict;
  return {
    ...raw,
    at,
    turnsUsed: goal?.turnsUsed ?? raw.turnsUsed ?? 0,
    maxTurns: goal?.maxTurns ?? raw.maxTurns ?? 0,
    statusAfter: goal?.status ?? raw.statusAfter ?? 'active',
    willContinue: verdict === 'continue' || verdict === 'decompose',
  };
}

function normalizeGoal(raw: WebchatPersistentGoalWire | null): WebchatPersistentGoalWire | null {
  if (!raw) return null;
  const latestRun = raw.latestRun ? normalizeRun(raw.latestRun, raw) : undefined;
  return {
    ...raw,
    checklist: raw.checklist ?? [],
    latestRun,
    lastTurnAt: raw.updatedAt ?? raw.lastTurnAt ?? raw.createdAt,
    lastVerdict: latestRun?.verdict ?? raw.lastVerdict,
    lastReason: latestRun?.reason ?? raw.lastReason ?? raw.blockedReason,
  };
}

export async function fetchWebchatGoal(
  sessionKey: string,
  _opts?: { uiLocale?: StoredLanguage },
): Promise<GetWebchatGoalResponse> {
  const q = new URLSearchParams({ sessionKey });
  const res = await fetchJson<GetWebchatGoalResponse>(apiUrl(`/api/goals/current?${q.toString()}`));
  return { ok: true, goal: normalizeGoal(res.goal) };
}

export async function createWebchatGoal(
  sessionKey: string,
  title: string,
  opts?: { uiLocale?: StoredLanguage },
): Promise<PostWebchatGoalActionResponse> {
  const res = await fetchJson<PostWebchatGoalActionResponse>(apiUrl('/api/goals'), {
    method: 'POST',
    body: JSON.stringify({ sessionKey, title, ...(opts?.uiLocale ? { uiLocale: opts.uiLocale } : {}) }),
  });
  return { ok: true, goal: normalizeGoal(res.goal) };
}

export async function listWebchatGoals(opts?: {
  status?: string;
  sessionKey?: string;
  limit?: number;
}): Promise<ListGoalsResponse> {
  const q = new URLSearchParams();
  q.set('status', opts?.status ?? 'active,paused,blocked,needs_input');
  q.set('limit', String(opts?.limit ?? 50));
  if (opts?.sessionKey) q.set('sessionKey', opts.sessionKey);
  const res = await fetchJson<ListGoalsResponse>(apiUrl(`/api/goals?${q.toString()}`));
  return { ok: true, goals: res.goals.map((goal) => normalizeGoal(goal)).filter((goal): goal is WebchatPersistentGoalWire => goal != null) };
}

export async function fetchGoalQueue(): Promise<GetGoalQueueResponse> {
  const res = await fetchJson<GetGoalQueueResponse>(apiUrl('/api/goals/queue'));
  return { ok: true, queue: res.queue ?? [] };
}

export async function postWebchatGoalAction(
  sessionKey: string,
  action: GoalWebchatAction,
  opts?: { uiLocale?: StoredLanguage },
): Promise<PostWebchatGoalActionResponse> {
  const current = await fetchWebchatGoal(sessionKey, opts);
  const goal = current.goal;
  if (!goal) return { ok: true, goal: null };
  const path =
    action === 'pause'
      ? `/api/goals/${encodeURIComponent(goal.id)}/pause`
      : action === 'clear'
        ? `/api/goals/${encodeURIComponent(goal.id)}/archive`
        : action === 'detach'
          ? `/api/goals/${encodeURIComponent(goal.id)}/detach`
        : `/api/goals/${encodeURIComponent(goal.id)}/continue`;
  const res = await fetchJson<PostWebchatGoalActionResponse>(apiUrl(path), {
    method: 'POST',
    body: JSON.stringify({ sessionKey, ...(opts?.uiLocale ? { uiLocale: opts.uiLocale } : {}) }),
  });
  return { ok: true, goal: normalizeGoal(res.goal) };
}

export async function attachWebchatGoal(
  sessionKey: string,
  goalId: string,
): Promise<PostWebchatGoalActionResponse> {
  const res = await fetchJson<PostWebchatGoalActionResponse>(
    apiUrl(`/api/goals/${encodeURIComponent(goalId)}/attach`),
    {
      method: 'POST',
      body: JSON.stringify({ sessionKey }),
    },
  );
  return { ok: true, goal: normalizeGoal(res.goal) };
}

export async function detachWebchatGoal(goalId: string): Promise<PostWebchatGoalActionResponse> {
  const res = await fetchJson<PostWebchatGoalActionResponse>(
    apiUrl(`/api/goals/${encodeURIComponent(goalId)}/detach`),
    { method: 'POST', body: JSON.stringify({}) },
  );
  return { ok: true, goal: normalizeGoal(res.goal) };
}

export async function postWebchatChecklistMutation(
  sessionKey: string,
  mutation: ChecklistMutationOp,
  opts?: { uiLocale?: StoredLanguage },
): Promise<PostWebchatChecklistResponse> {
  const current = await fetchWebchatGoal(sessionKey, opts);
  const goal = current.goal;
  if (!goal) return { ok: true, goal: null };
  if (mutation.op === 'reset') {
    await Promise.all(
      goal.checklist.map((item) =>
        apiUrl(`/api/goals/${encodeURIComponent(goal.id)}/checklist/${encodeURIComponent(item.id)}`),
      ).map((url) => fetchJson(url, { method: 'DELETE' })),
    );
    return fetchWebchatGoal(sessionKey, opts);
  }
  if (mutation.op === 'add') {
    const res = await fetchJson<PostWebchatChecklistResponse>(apiUrl(`/api/goals/${encodeURIComponent(goal.id)}/checklist`), {
      method: 'POST',
      body: JSON.stringify({ text: mutation.text }),
    });
    return { ok: true, goal: normalizeGoal(res.goal) };
  }
  const item = goal.checklist[mutation.index - 1];
  if (!item) return { ok: true, goal };
  if (mutation.op === 'remove') {
    const res = await fetchJson<PostWebchatChecklistResponse>(
      apiUrl(`/api/goals/${encodeURIComponent(goal.id)}/checklist/${encodeURIComponent(item.id)}`),
      { method: 'DELETE' },
    );
    return { ok: true, goal: normalizeGoal(res.goal) };
  }
  const res = await fetchJson<PostWebchatChecklistResponse>(
    apiUrl(`/api/goals/${encodeURIComponent(goal.id)}/checklist/${encodeURIComponent(item.id)}`),
    {
      method: 'PATCH',
      body: JSON.stringify({ status: mutation.status }),
    },
  );
  return { ok: true, goal: normalizeGoal(res.goal) };
}

export async function fetchWebchatGoalRuns(
  sessionKey: string,
  opts?: { limit?: number },
): Promise<GetWebchatGoalRunsResponse> {
  const current = await fetchWebchatGoal(sessionKey);
  const goal = current.goal;
  if (!goal) return { ok: true, runs: [] };
  const q = new URLSearchParams();
  if (opts?.limit != null && Number.isFinite(opts.limit)) {
    q.set('limit', String(Math.min(500, Math.max(1, Math.floor(opts.limit)))));
  }
  const suffix = q.toString() ? `?${q.toString()}` : '';
  const res = await fetchJson<GetWebchatGoalRunsResponse>(
    apiUrl(`/api/goals/${encodeURIComponent(goal.id)}/runs${suffix}`),
  );
  return { ok: true, runs: res.runs.map((run) => normalizeRun(run, goal)) };
}
