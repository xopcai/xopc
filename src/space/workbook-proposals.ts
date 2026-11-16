import { randomUUID } from 'node:crypto';

import type { SpaceWorkbookProposal } from '@xopcai/gateway-contract';

import { DurableState } from '../storage/sqlite/durable-state.js';
import { runSqliteWriteTransaction } from '../storage/sqlite/transaction.js';
import { loadSpaceWorkbook, saveSpaceWorkbook, saveSpaceWorkbookSchema } from './budget-workbook.js';
import type { WorkbookEdit } from './workbook-engine.js';

type StoredProposal = SpaceWorkbookProposal & {
  conversationId: string;
  runId: string;
  edits: WorkbookEdit[];
  expiresAt: number;
  requiresReview: boolean;
  appliedVersionId?: string;
};

const proposals = new DurableState<StoredProposal>('space.workbook-proposals');
const latestProposals = new DurableState<string>('space.workbook-latest-proposal');

export function createWorkbookProposal(input: Pick<StoredProposal, 'id' | 'versionId' | 'conversationId' | 'runId' | 'changes' | 'effects' | 'edits' | 'requiresReview'>) {
  const proposal: StoredProposal = { ...input, proposalId: randomUUID(), expiresAt: Date.now() + 24 * 60 * 60 * 1000 };
  runSqliteWriteTransaction(db => {
    db.prepare(`DELETE FROM durable_state WHERE namespace = ? AND scope = ''
      AND json_extract(payload, '$.appliedVersionId') IS NULL AND json_extract(payload, '$.expiresAt') <= ?`).run(proposals.namespace, Date.now());
    proposals.set(proposal.proposalId, proposal);
    latestProposals.set(proposal.conversationId, proposal.proposalId);
  });
  return proposal;
}

export function isLatestWorkbookProposal(proposal: StoredProposal) {
  return latestProposals.get(proposal.conversationId) === proposal.proposalId;
}

export function purgeWorkbookProposals(id: string) {
  runSqliteWriteTransaction(db => {
    db.prepare(`DELETE FROM durable_state WHERE namespace = ? AND scope = '' AND json_extract(payload, '$') IN (
      SELECT key FROM durable_state WHERE namespace = ? AND scope = '' AND json_extract(payload, '$.id') = ?
    )`).run(latestProposals.namespace, proposals.namespace, id);
    db.prepare(`DELETE FROM durable_state WHERE namespace = ? AND scope = '' AND json_extract(payload, '$.id') = ?`)
      .run(proposals.namespace, id);
  });
}

export function findWorkbookProposal(proposalId: string) {
  const proposal = proposals.get(proposalId);
  return proposal && (proposal.appliedVersionId || proposal.expiresAt > Date.now()) ? proposal : undefined;
}

export function workbookProposalView({ id, versionId, proposalId, appliedVersionId, changes, effects }: StoredProposal): SpaceWorkbookProposal {
  return { id, versionId, proposalId, appliedVersionId, changes, effects };
}

export async function applyWorkbookProposal(proposal: StoredProposal, options: { allowReviewedChanges: boolean; assertWritable: () => void }) {
  options.assertWritable();
  const currentProposal = findWorkbookProposal(proposal.proposalId);
  if (!currentProposal) return 'missing';
  if (currentProposal.appliedVersionId) return { id: proposal.id, versionId: currentProposal.appliedVersionId };
  const stored = loadSpaceWorkbook(proposal.id);
  if (!stored) return 'missing';
  if (stored.versionId !== proposal.versionId) return 'conflict';
  if (proposal.requiresReview && !options.allowReviewedChanges) return 'review';
  const { simulateWorkbookEdits } = await import('./workbook-engine.js');
  const preview = await simulateWorkbookEdits(stored, proposal.edits);
  if (preview.requiresReview && !options.allowReviewedChanges) return 'review';
  if (JSON.stringify(preview.changes) !== JSON.stringify(proposal.changes)
    || JSON.stringify(preview.effects) !== JSON.stringify(proposal.effects)) return 'conflict';
  options.assertWritable();
  return runSqliteWriteTransaction(() => {
    const latest = findWorkbookProposal(proposal.proposalId);
    if (!latest) return 'missing';
    if (latest.appliedVersionId) return { id: latest.id, versionId: latest.appliedVersionId };
    if (loadSpaceWorkbook(proposal.id)?.versionId !== proposal.versionId) return 'conflict';
    const result = saveSpaceWorkbook(proposal.id, saveSpaceWorkbookSchema.parse({ baseVersionId: proposal.versionId, snapshot: preview.snapshot }));
    if (typeof result !== 'string') proposals.set(proposal.proposalId, { ...latest, appliedVersionId: result.versionId });
    return result;
  });
}
