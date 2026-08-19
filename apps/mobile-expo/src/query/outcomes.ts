import {
  OutcomeReceiptSchema,
  OutcomeSchema,
  OutcomeStartResponseSchema,
  type Outcome,
  type OutcomeAction,
  type OutcomeReceipt,
  type OutcomeStartResponse,
} from '@xopcai/gateway-contract';

import { apiFetch } from '../api/client';

export type OutcomeDetail = {
  outcome: Outcome;
  receipts: OutcomeReceipt[];
};

export async function startOutcome(input: {
  requestId: string;
  objective: string;
  projectId?: string;
  locale?: 'en' | 'zh';
}): Promise<OutcomeStartResponse> {
  const response = await apiFetch('/api/outcomes', {
    method: 'POST',
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({})) as { error?: string };
    throw new Error(body.error || `Failed to start outcome: ${response.status}`);
  }
  return OutcomeStartResponseSchema.parse(await response.json());
}

export async function fetchOutcome(id: string): Promise<OutcomeDetail> {
  const response = await apiFetch(`/api/outcomes/${encodeURIComponent(id)}`);
  if (!response.ok) throw new Error(`Failed to fetch outcome: ${response.status}`);
  const body = await response.json() as { outcome?: unknown; receipts?: unknown };
  return {
    outcome: OutcomeSchema.parse(body.outcome),
    receipts: OutcomeReceiptSchema.array().parse(body.receipts),
  };
}

export async function actOnOutcome(
  id: string,
  action: OutcomeAction,
  approvedBoundaries?: string[],
): Promise<Outcome> {
  const response = await apiFetch(`/api/outcomes/${encodeURIComponent(id)}/actions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, approvedBoundaries }),
  });
  if (!response.ok) throw new Error(`Failed to update outcome: ${response.status}`);
  const body = await response.json() as { outcome?: unknown };
  return OutcomeSchema.parse(body.outcome);
}
