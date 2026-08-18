import {
  ConfirmedWorkSchema,
  OutcomeReceiptSchema,
  OutcomeSchema,
  WorkIntakeProposalSchema,
  parseWorkHomeResponse,
  type ConfirmedWork,
  type Outcome,
  type OutcomeAction,
  type OutcomeReceipt,
  type WorkIntakeProposal,
  type WorkHomeAttention,
  type WorkHomeChat,
  type WorkHomeDecision,
  type WorkHomeItem,
  type WorkHomeResponse,
} from '@xopcai/gateway-contract';

import { fetchJson } from '@/lib/fetch';
import { apiUrl } from '@/lib/url';

export type { WorkHomeAttention, WorkHomeChat, WorkHomeDecision, WorkHomeItem, WorkHomeResponse };
export type { ConfirmedWork, WorkIntakeProposal };

export type OutcomeDetail = {
  outcome: Outcome;
  receipts: OutcomeReceipt[];
};

export async function fetchOutcome(outcomeId: string): Promise<OutcomeDetail> {
  const response = await fetchJson<{ outcome?: unknown; receipts?: unknown }>(
    apiUrl(`/api/outcomes/${encodeURIComponent(outcomeId)}`),
  );
  return {
    outcome: OutcomeSchema.parse(response.outcome),
    receipts: OutcomeReceiptSchema.array().parse(response.receipts),
  };
}

export async function actOnOutcome(outcomeId: string, action: OutcomeAction): Promise<Outcome> {
  const response = await fetchJson<{ outcome?: unknown }>(
    apiUrl(`/api/outcomes/${encodeURIComponent(outcomeId)}/actions`),
    { method: 'POST', body: JSON.stringify({ action }) },
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

export async function proposeWorkIntake(objective: string): Promise<WorkIntakeProposal> {
  const response = await fetchJson<{ proposal?: unknown }>(apiUrl('/api/work/intakes'), {
    method: 'POST',
    body: JSON.stringify({ idempotencyKey: crypto.randomUUID(), objective }),
  });
  return WorkIntakeProposalSchema.parse(response.proposal);
}

export async function confirmWorkIntake(proposalId: string): Promise<ConfirmedWork> {
  const response = await fetchJson<{ work?: unknown }>(apiUrl(`/api/work/intakes/${encodeURIComponent(proposalId)}/confirm`), {
    method: 'POST',
    body: JSON.stringify({ executionMode: 'run_now' }),
  });
  return ConfirmedWorkSchema.parse(response.work);
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
