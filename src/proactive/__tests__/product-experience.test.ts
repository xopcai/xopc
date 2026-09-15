import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ProjectService } from '../../projects/index.js';
import { closeXopcDatabase, openXopcDatabase, resetXopcDatabaseSingletonForTest } from '../../storage/sqlite/index.js';
import { getSqliteDatabase } from '../../storage/sqlite/transaction.js';
import { checkDelegation, completeDeliveredProjects, delegationOverview, startDelegation } from '../experience.js';
import { claimNextRun, failRun } from '../execution/repository.js';
import { ProactiveWorker } from '../execution/worker.js';
import { getCard, performCardAction } from '../inbox/cards.js';
import { ProactiveInboxService } from '../inbox/service.js';
import { effectiveProactivePolicy, updateProactivePreferences } from '../policy/service.js';

describe('delegated project work', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'xopc-product-'));
    resetXopcDatabaseSingletonForTest(); openXopcDatabase({ path: join(dir, 'xopc.db') });
  });
  afterEach(() => { closeXopcDatabase(); resetXopcDatabaseSingletonForTest(); rmSync(dir, { recursive: true, force: true }); });

  it('saves a delegation while globally paused without claiming that checking has started', () => {
    updateProactivePreferences('workspace', { expectedRevision: 0, level: 'off' });
    const project = new ProjectService().create({ name: 'Paused launch' });
    const sub = startDelegation('workspace', { scenarioKey: 'project_delivery_risk', projectId: project.id, instructions: 'Follow delivery when resumed.' });
    expect(delegationOverview('workspace').delegations[0]).toMatchObject({ id: sub.id, effectiveEnabled: false, pending: false });
    expect(effectiveProactivePolicy(sub.id).enabled).toBe(false);
    expect(() => checkDelegation('workspace', sub.id)).toThrow(/Resume/);
  });

  async function prepare() {
    const project = new ProjectService().create({ name: 'Website launch' });
    const sub = startDelegation('workspace', { scenarioKey: 'project_delivery_risk', projectId: project.id, instructions: 'Prepare launch checks; ask before creating tasks.' });
    await new ProactiveWorker({ execute: async () => ({ text: JSON.stringify({ title: 'Check integration', summary: 'Review integration before launch', whyNow: 'Launch preparation', impact: 'Delivery', recommendation: 'Confirm acceptance', workDone: 'Reviewed project', urgency: 'high', confidence: .95, evidenceIds: [`project:${project.id}`], artifact: { kind: 'checklist', title: 'Launch checklist', content: '1. Confirm acceptance.\n2. Schedule integration.' }, decision: { question: 'Create acceptance task?', options: [{ id: 'approve', label: 'Create', consequence: 'Adds a task' }, { id: 'reject', label: 'Skip', consequence: 'No change' }] }, proposedAction: { id: 'create_project_task', risk: 'low', rationale: 'A reviewable follow-up', input: { title: 'Confirm acceptance', objective: 'Review acceptance evidence' } } }) }) }).tick();
    new ProactiveInboxService().project();
    return { project, sub, card: delegationOverview('workspace').needsDecision[0]! };
  }

  it('expedites the existing retry instead of creating a parallel check', () => {
    const project = new ProjectService().create({ name: 'Retry delivery' });
    const sub = startDelegation('workspace', { scenarioKey: 'project_delivery_risk', projectId: project.id, instructions: 'Check delivery' });
    const run = claimNextRun('test')!;
    expect(run).toBeTruthy();
    failRun(run, new Error('Temporary source failure'), true);
    expect(checkDelegation('workspace', sub.id)).toEqual({ status: 'queued' });
    const retry = claimNextRun('test')!;
    expect(retry.id).toBe(run.id);
    expect(retry.attempt).toBe(2);
    expect(getSqliteDatabase().prepare('SELECT COUNT(*) AS n FROM proactive_runs WHERE subscription_id = ?').get(sub.id)).toMatchObject({ n: 1 });
  });

  it('queues the first check immediately and prepares a usable artifact without a selected workflow', async () => {
    const { card, sub } = await prepare();
    expect(card.artifact?.content).toContain('Confirm acceptance');
    expect(card.taskDraft?.title).toBe('Confirm acceptance');
    expect(delegationOverview('workspace').delegations[0]?.latestRun).toMatchObject({ status: 'completed' });
    expect(() => checkDelegation('another-workspace', sub.id)).toThrow('not found');
    expect(() => checkDelegation('workspace', sub.id)).toThrow('minute');
    expect(getSqliteDatabase().prepare("SELECT 1 FROM sqlite_master WHERE name = 'proactive_workflow_links'").get()).toBeUndefined();
  });

  it('saves edits with a revision guard and creates exactly the task the user reviewed', async () => {
    const { card } = await prepare();
    const edited = performCardAction(card.id, 'workspace', { actionId: 'edit_artifact', expectedRevision: card.revision, idempotencyKey: 'edit-prepared-work', artifact: { ...card.artifact!, content: 'Confirm only the payment callback.' } });
    expect(edited.artifact?.content).toBe('Confirm only the payment callback.');
    expect(() => performCardAction(card.id, 'workspace', { actionId: 'decide', choice: 'approve', expectedRevision: card.revision, idempotencyKey: 'stale-approval-key' })).toThrow('changed');
    const request = { actionId: 'decide', choice: 'approve', expectedRevision: edited.revision, idempotencyKey: 'approve-reviewed-task', taskDraft: { title: 'Verify payment callback', objective: 'Check only the callback acceptance.' } };
    const result = performCardAction(card.id, 'workspace', request);
    expect(result.followUp).toMatchObject({ title: request.taskDraft.title, phase: 'backlog' });
    expect(result.decision).toBeUndefined();
    expect(result.status).toBe('read');
    expect(performCardAction(card.id, 'workspace', request).followUp?.taskId).toBe(result.followUp?.taskId);
    expect(getSqliteDatabase().prepare('SELECT COUNT(*) AS n FROM tasks').get()).toMatchObject({ n: 1 });
    getSqliteDatabase().prepare("UPDATE tasks SET phase = 'closed', resolution = 'done' WHERE task_id = ?").run(result.followUp!.taskId);
    expect(getCard(card.id, 'workspace').followUp).toMatchObject({ phase: 'closed', resolution: 'done' });
  });

  it('does not turn dismissing a card into task completion and ends only the delivered project', async () => {
    const { card, project, sub } = await prepare();
    performCardAction(card.id, 'workspace', { actionId: 'handled', expectedRevision: card.revision, idempotencyKey: 'user-already-handled' });
    expect(effectiveProactivePolicy(sub.id).enabled).toBe(true);
    expect(getSqliteDatabase().prepare('SELECT COUNT(*) AS n FROM tasks').get()).toMatchObject({ n: 0 });
    getSqliteDatabase().prepare("UPDATE projects SET status = 'completed' WHERE project_id = ?").run(project.id);
    completeDeliveredProjects();
    expect(effectiveProactivePolicy(sub.id).enabled).toBe(false);
    expect(delegationOverview('workspace').delegations[0]?.completedAt).toBeTruthy();
  });

  it('uses the same revisioned instructions and rejects duplicate or cross-workspace delegations', async () => {
    const { project } = await prepare();
    expect(() => startDelegation('workspace', { scenarioKey: 'project_delivery_risk', projectId: project.id, instructions: 'Duplicate' })).toThrow('exists');
    expect(delegationOverview('another-workspace').needsDecision).toEqual([]);
    expect(() => startDelegation('workspace', { scenarioKey: 'project_delivery_risk', instructions: 'No project' })).toThrow('Choose a project');
  });
});
