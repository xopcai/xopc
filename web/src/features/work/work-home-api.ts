import {
  OutcomeDetailResponseSchema,
  OutcomeReceiptSchema,
  OutcomeSchema,
  parseWorkHomeResponse,
  type Outcome,
  type OutcomeAction,
  type OutcomeContextManifest,
  type OutcomeReceipt,
  type WorkHomeAttention,
  type WorkHomeChat,
  type WorkHomeDecision,
  type WorkHomeItem,
  type WorkHomeResponse,
} from '@xopcai/gateway-contract';

import { fetchJson } from '@/lib/fetch';
import { apiUrl } from '@/lib/url';

export type { WorkHomeAttention, WorkHomeChat, WorkHomeDecision, WorkHomeItem, WorkHomeResponse };

export type OutcomeDetail = {
  outcome: Outcome;
  receipts: OutcomeReceipt[];
  contextManifest?: OutcomeContextManifest;
};

export async function fetchOutcome(outcomeId: string): Promise<OutcomeDetail> {
  const response = OutcomeDetailResponseSchema.parse(await fetchJson<unknown>(
    apiUrl(`/api/outcomes/${encodeURIComponent(outcomeId)}`),
  ));
  return {
    outcome: response.outcome,
    receipts: response.receipts,
    contextManifest: response.contextManifest,
  };
}

export async function actOnOutcome(
  outcomeId: string,
  action: OutcomeAction,
  approvedBoundaries?: string[],
): Promise<Outcome> {
  const response = await fetchJson<{ outcome?: unknown }>(
    apiUrl(`/api/outcomes/${encodeURIComponent(outcomeId)}/actions`),
    { method: 'POST', body: JSON.stringify({ action, approvedBoundaries }) },
  );
  return OutcomeSchema.parse(response.outcome);
}

export async function submitOutcomeFeedback(
  runId: string,
  outcome: 'helpful' | 'not_helpful',
  reason?: string,
): Promise<OutcomeReceipt> {
  const response = await fetchJson<{ receipt?: unknown }>(
    apiUrl(`/api/execution-receipts/${encodeURIComponent(runId)}/feedback`),
    {
      method: 'POST',
      body: JSON.stringify({ outcome, reason: reason?.trim() || undefined }),
    },
  );
  return OutcomeReceiptSchema.parse(response.receipt);
}

export function fetchWorkHome(locale?: 'en' | 'zh'): Promise<WorkHomeResponse> {
  const suffix = locale ? `?locale=${encodeURIComponent(locale)}` : '';
  return fetchJson<unknown>(apiUrl(`/api/home${suffix}`)).then(parseWorkHomeResponse);
}

export function respondToWorkDecision(
  response: NonNullable<WorkHomeDecision['response']>,
  decision: 'approve' | 'deny',
): Promise<{ ok: true; status: string }> {
  return fetchJson(apiUrl('/api/home/decisions/respond'), {
    method: 'POST',
    body: JSON.stringify({ ...response, decision }),
  });
}

export function acknowledgeWorkAttention(
  item: Pick<WorkHomeAttention, 'kind' | 'runId'>,
): Promise<{ ok: true; status: 'acknowledged' }> {
  return fetchJson(apiUrl('/api/home/attention/acknowledge'), {
    method: 'POST',
    body: JSON.stringify(item),
  });
}

export function decideAgentJudgment(itemId: string, choice: string): Promise<{ ok: true }> {
  return fetchJson(apiUrl(`/api/inbox/judgments/${encodeURIComponent(itemId)}/decisions`), {
    method: 'POST', body: JSON.stringify({ choice }),
  });
}

export function transitionAgentJudgment(itemId: string, status: 'read' | 'snoozed' | 'resolved'): Promise<{ ok: true }> {
  return fetchJson(apiUrl(`/api/inbox/judgments/${encodeURIComponent(itemId)}/transition`), {
    method: 'POST',
    body: JSON.stringify(status === 'snoozed'
      ? { status, snoozedUntil: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString() }
      : status === 'resolved' ? { status, resolution: 'dismissed' } : { status }),
  });
}

export function instructAgentJudgment(itemId: string, instruction: string): Promise<{ ok: true; revisionId: string }> {
  return fetchJson(apiUrl(`/api/inbox/judgments/${encodeURIComponent(itemId)}/instructions`), {
    method: 'POST', body: JSON.stringify({ instruction }),
  });
}

export function retryWorkAttention(
  item: Pick<WorkHomeAttention, 'kind' | 'runId'>,
): Promise<{ ok: true; runId: string; sessionKey?: string }> {
  return fetchJson(apiUrl('/api/home/attention/retry'), {
    method: 'POST',
    body: JSON.stringify(item),
  });
}
