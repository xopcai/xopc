import {
  ConfirmedWorkSchema,
  WorkIntakeProposalSchema,
  type ConfirmedWork,
  type WorkIntakeProposal,
} from '@xopcai/gateway-contract';

import { apiFetch } from '../api/client';

async function readError(res: Response): Promise<Error> {
  const body = await res.json().catch(() => ({})) as { error?: string; message?: string };
  return new Error(body.error || body.message || `HTTP ${res.status}`);
}

export async function proposeWorkIntake(input: {
  objective: string;
  projectId?: string;
}): Promise<WorkIntakeProposal> {
  const res = await apiFetch('/api/work/intakes', {
    method: 'POST',
    body: JSON.stringify({ ...input, idempotencyKey: crypto.randomUUID() }),
  });
  if (!res.ok) throw await readError(res);
  const body = await res.json() as { proposal?: unknown };
  return WorkIntakeProposalSchema.parse(body.proposal);
}

export async function confirmWorkIntake(proposalId: string): Promise<ConfirmedWork> {
  const res = await apiFetch(`/api/work/intakes/${encodeURIComponent(proposalId)}/confirm`, {
    method: 'POST',
    body: JSON.stringify({ executionMode: 'run_now' }),
  });
  if (!res.ok) throw await readError(res);
  const body = await res.json() as { work?: unknown };
  return ConfirmedWorkSchema.parse(body.work);
}
