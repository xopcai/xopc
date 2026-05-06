import { fetchJson } from '@/lib/fetch';
import { apiUrl } from '@/lib/url';

/** Mirrors server `PersistentGoalState` subset for UI. */
export type WebchatPersistentGoalWire = {
  goal: string;
  status: 'active' | 'paused' | 'done' | 'cleared';
  turnsUsed: number;
  maxTurns: number;
  createdAt: number;
  lastTurnAt: number;
  lastVerdict?: 'done' | 'continue' | 'skipped';
  lastReason?: string;
  pausedReason?: string;
  judgeModelRef?: string;
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

export async function fetchWebchatGoal(sessionKey: string): Promise<GetWebchatGoalResponse> {
  const q = new URLSearchParams({ sessionKey });
  return fetchJson<GetWebchatGoalResponse>(apiUrl(`/api/goals/webchat?${q.toString()}`));
}

export async function postWebchatGoalAction(
  sessionKey: string,
  action: GoalWebchatAction,
): Promise<PostWebchatGoalActionResponse> {
  return fetchJson<PostWebchatGoalActionResponse>(apiUrl('/api/goals/webchat'), {
    method: 'POST',
    body: JSON.stringify({ sessionKey, action }),
  });
}
