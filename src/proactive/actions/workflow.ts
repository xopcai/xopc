import { randomUUID } from 'node:crypto';

import { z } from 'zod';

import { getSqliteDatabase, runSqliteWriteTransaction } from '../../storage/sqlite/transaction.js';
import type { WorkflowRunService } from '../../workflows/service/workflow-run-service.js';
import { getCard } from '../inbox/cards.js';
import { effectiveProactivePolicy, ProactiveConflict } from '../policy/service.js';
import { requireSubscription } from '../scenarios/control.js';

const StartSchema = z.object({ expectedRevision: z.number().int().positive(), retry: z.boolean().default(false) }).strict();
export async function prepareCardWorkflow(workspace: string, cardId: string, value: unknown, agentId: string, workflows: WorkflowRunService) {
  const input = StartSchema.parse(value);
  const card = getCard(cardId, workspace);
  const policy = effectiveProactivePolicy(card.subscriptionId);
  const sub = requireSubscription(card.subscriptionId, workspace);
  if (!policy.enabled || card.status === 'withdrawn' || card.status === 'expired') throw new Error('Card is no longer actionable');
  if (card.revision !== input.expectedRevision) throw new ProactiveConflict('Card changed; refresh before acting');
  const definitionId = policy.settings.preparationWorkflowId;
  if (!definitionId) throw new Error('Choose a preparation workflow in the subscription settings first');
  const claim = runSqliteWriteTransaction((db) => {
    const previous = db.prepare('SELECT * FROM proactive_workflow_links WHERE inbox_item_id = ?').get(cardId) as
      { run_id: string | null; definition_id: string; attempt_key: string; status: string; lease_until: number | null; agent_id: string } | undefined;
    if (previous?.lease_until && previous.lease_until > Date.now()) throw new ProactiveConflict('Workflow request is already running');
    if (previous?.run_id && !input.retry) return { existing: true, ...previous };
    if (previous && previous.definition_id !== definitionId) throw new Error('Workflow selection changed; open the existing run to recover it');
    const attemptKey = (previous?.status === 'starting' || (previous?.status === 'failed' && !previous.run_id)) ? previous.attempt_key : `proactive-prepare:${cardId}:${randomUUID()}`;
    db.prepare(`INSERT INTO proactive_workflow_links(inbox_item_id, definition_id, agent_id, attempt_key, status, lease_until)
      VALUES (?, ?, ?, ?, 'starting', ?) ON CONFLICT(inbox_item_id) DO UPDATE SET status = 'starting', attempt_key = excluded.attempt_key, lease_until = excluded.lease_until, error = NULL`)
      .run(cardId, definitionId, agentId, attemptKey, Date.now() + 120000);
    return { existing: false, run_id: previous?.run_id ?? null, agent_id: previous?.agent_id ?? agentId, attempt_key: attemptKey };
  });
  if (claim.existing) return workflowForCard(cardId, workspace, workflows);
  try {
    if (input.retry && claim.run_id) {
      const previous = await workflows.createRunStore(claim.agent_id).readRunView(claim.run_id);
      if (previous && !['failed', 'cancelled', 'interrupted'].includes(previous.run.status)) throw new Error('Only failed or interrupted workflows can be retried');
    }
    if (['withdrawn', 'expired'].includes(getCard(cardId, workspace).status) || !effectiveProactivePolicy(card.subscriptionId).enabled) throw new Error('Card permissions changed');
    const result = await workflows.startWorkflowRun({ agentId: claim.agent_id, definitionId, preparationOnly: true, writebackPolicy: { targets: [] },
      ...(sub.scopeKind === 'project' ? { projectId: sub.scopeId } : {}),
      goal: `Prepare a reviewable checklist for this user-selected card. Do not send messages or publish results.\n${card.title}\n${card.summary}\n${card.recommendation}`,
      input: { cardId, evidence: card.evidence, purpose: 'preparation_checklist' },
      source: { kind: 'webui' }, concurrency: 1, tokenBudget: 5000,
      idempotencyKey: claim.attempt_key, ...(input.retry && claim.run_id ? { retryOfRunId: claim.run_id } : {}),
    });
    if (result.ok === false) throw new Error(result.message);
    getSqliteDatabase().prepare("UPDATE proactive_workflow_links SET status = 'started', run_id = ?, session_key = ?, lease_until = NULL WHERE inbox_item_id = ? AND attempt_key = ?")
      .run(result.runId, result.sessionKey, cardId, claim.attempt_key);
    return workflowForCard(cardId, workspace, workflows);
  } catch (error) {
    getSqliteDatabase().prepare("UPDATE proactive_workflow_links SET status = 'failed', lease_until = NULL, error = ? WHERE inbox_item_id = ? AND attempt_key = ?").run(error instanceof Error ? error.message.slice(0, 500) : 'Workflow failed', cardId, claim.attempt_key);
    throw error;
  }
}
export async function workflowForCard(cardId: string, workspace: string, workflows: WorkflowRunService) {
  const card = getCard(cardId, workspace);
  if (card.status === 'withdrawn') return null;
  const row = getSqliteDatabase().prepare('SELECT run_id AS runId, agent_id AS agentId, session_key AS sessionKey, status, error FROM proactive_workflow_links WHERE inbox_item_id = ?').get(cardId) as { runId: string | null; agentId: string; sessionKey: string | null; status: string; error: string | null } | undefined;
  if (!row) return null;
  if (!row.runId) return row;
  const view = await workflows.createRunStore(row.agentId).readRunView(row.runId);
  return { ...row, status: view?.run.status ?? row.status };
}
