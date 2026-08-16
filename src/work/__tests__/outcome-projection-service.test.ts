import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { GoalService } from '../../goals/index.js';
import { ProjectService } from '../../projects/index.js';
import {
  closeXopcDatabase,
  completeTaskOutcome,
  ensureSessionRecord,
  openXopcDatabase,
  resetXopcDatabaseSingletonForTest,
  setTaskCompletionVerdict,
  startTaskOutcome,
  updateTaskOutcome,
} from '../../storage/sqlite/index.js';
import { WorkItemService } from '../../work-items/index.js';
import { OutcomeProjectionService } from '../outcome-projection-service.js';
import { WorkValueMetricsService } from '../work-value-metrics-service.js';

describe('OutcomeProjectionService', () => {
  let stateDir: string;

  beforeEach(() => {
    stateDir = mkdtempSync(join(tmpdir(), 'xopc-outcome-projection-'));
    resetXopcDatabaseSingletonForTest();
    openXopcDatabase({ path: join(stateDir, 'xopc.db') });
    ensureSessionRecord('session-projection', stateDir);
  });

  afterEach(() => {
    closeXopcDatabase();
    resetXopcDatabaseSingletonForTest();
    rmSync(stateDir, { recursive: true, force: true });
  });

  it('projects verified completion and user correction into work and goal state', () => {
    const projects = new ProjectService();
    const workItems = new WorkItemService();
    const goals = new GoalService();
    const project = projects.create({ name: 'Outcome projection' });
    const goal = goals.create({ title: 'Ship verified work', projectId: project.id });
    const workItem = workItems.createProjectWorkItem(project.id, {
      title: 'Ship verified work',
      status: 'in_progress',
    });
    startTaskOutcome({
      runId: 'run-projection',
      sessionKey: 'session-projection',
      channel: 'webchat',
      objective: 'Ship verified work',
      context: { projectId: project.id, goalId: goal.id, workItemId: workItem.id, origin: 'goal' },
    });
    updateTaskOutcome({
      runId: 'run-projection',
      contract: {
        objective: 'Ship verified work',
        deliverables: ['release'],
        acceptanceCriteria: ['Checks pass'],
        constraints: [],
        approvalRequired: [],
      },
      evidence: [{
        kind: 'test',
        title: 'Verification suite',
        summary: 'All checks passed',
        verifies: ['Checks pass'],
      }],
    });
    const completed = completeTaskOutcome({
      runId: 'run-projection',
      status: 'succeeded',
      summary: 'Verified work shipped',
    })!;
    const projections = new OutcomeProjectionService();
    const projected = projections.project(completed);
    expect(projected.projectionVersion).toBe(1);
    expect(workItems.getWorkItem(workItem.id)?.status).toBe('done');
    expect(goals.get(goal.id)?.status).toBe('done');

    const corrected = setTaskCompletionVerdict({
      runId: 'run-projection',
      verdict: 'not_achieved',
      correctionText: 'Fix the production rollout before closing.',
    })!;
    projections.project(corrected);
    expect(workItems.getWorkItem(workItem.id)).toMatchObject({
      status: 'blocked',
      nextAction: 'Fix the production rollout before closing.',
    });
    expect(goals.get(goal.id)).toMatchObject({
      status: 'blocked',
      nextAction: 'Fix the production rollout before closing.',
    });
    expect(new WorkValueMetricsService().get().outcomes).toMatchObject({
      total: 1,
      achieved: 0,
      notAchieved: 1,
      userCorrected: 1,
      correctionRate: 1,
    });
  });
});
