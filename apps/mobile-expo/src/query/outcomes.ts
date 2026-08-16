import {
  OutcomeReceiptSchema,
  OutcomeSchema,
  type Outcome,
  type OutcomeAction,
  type OutcomeReceipt,
} from '@xopcai/gateway-contract';

import { apiFetch } from '../api/client';

export type OutcomeDetail = {
  outcome: Outcome;
  receipts: OutcomeReceipt[];
};

export async function fetchOutcome(id: string): Promise<OutcomeDetail> {
  const response = await apiFetch(`/api/outcomes/${encodeURIComponent(id)}`);
  if (!response.ok) throw new Error(`Failed to fetch outcome: ${response.status}`);
  const body = await response.json() as { outcome?: unknown; receipts?: unknown };
  return {
    outcome: OutcomeSchema.parse(body.outcome),
    receipts: OutcomeReceiptSchema.array().parse(body.receipts),
  };
}

export async function actOnOutcome(id: string, action: OutcomeAction): Promise<Outcome> {
  const response = await apiFetch(`/api/outcomes/${encodeURIComponent(id)}/actions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action }),
  });
  if (!response.ok) throw new Error(`Failed to update outcome: ${response.status}`);
  const body = await response.json() as { outcome?: unknown };
  return OutcomeSchema.parse(body.outcome);
}
