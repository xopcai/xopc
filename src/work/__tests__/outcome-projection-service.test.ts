import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ProjectService } from '../../projects/index.js';
import {
  closeXopcDatabase,
  completeExecutionReceipt,
  ensureSessionRecord,
  openXopcDatabase,
  resetXopcDatabaseSingletonForTest,
  setExecutionVerdict,
  startExecutionReceipt,
  updateExecutionReceipt,
} from '../../storage/sqlite/index.js';
import { WorkItemService } from '../../work-items/index.js';
import { OutcomeExecutionService } from '../outcome-execution-service.js';
import {
  OutcomeProjectionService,
  EXECUTION_RECEIPT_PROJECTION_VERSION,
} from '../outcome-projection-service.js';
import { OutcomeRepository } from '../outcome-repository.js';
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

  it('projects receipt state only into the canonical outcome', () => {
    const projects = new ProjectService();
    const workItems = new WorkItemService();
    const project = projects.create({ name: 'Outcome projection' });
    const execution = new OutcomeExecutionService().create({
      objective: 'Ship verified work',
      projectId: project.id,
      acceptanceCriteria: ['Checks pass'],
    });
    const workItem = workItems.createProjectWorkItem(project.id, {
      title: 'Ship verified work',
      status: 'in_progress',
    });
    startExecutionReceipt({
      runId: 'run-projection',
      sessionKey: 'session-projection',
      channel: 'webchat',
      objective: 'Ship verified work',
      context: {
        outcomeId: execution.outcomeId,
        projectId: project.id,
        workItemId: workItem.id,
        origin: 'outcome',
      },
    });
    updateExecutionReceipt({
      runId: 'run-projection',
      contract: {
        objective: 'Ship verified work',
        deliverables: ['release'],
        acceptanceCriteria: ['Checks pass'],
        constraints: [],
        approvalRequired: [],
        assumptions: [],
        risks: [],
      },
      evidence: [{
        kind: 'test',
        title: 'Verification suite',
        summary: 'All checks passed',
        verifies: ['Checks pass'],
        provenance: 'tool',
        strength: 'verified',
        observedAt: Date.now(),
      }],
    });
    const completed = completeExecutionReceipt({
      runId: 'run-projection',
      status: 'succeeded',
      summary: 'Verified work shipped',
    })!;
    const projections = new OutcomeProjectionService();
    const projected = projections.project(completed);
    expect(projected.projectionVersion).toBe(EXECUTION_RECEIPT_PROJECTION_VERSION);
    expect(new OutcomeRepository().get(execution.outcomeId)).toMatchObject({
      userStatus: 'completed',
      internalStatus: 'completed',
    });
    expect(workItems.getWorkItem(workItem.id)?.status).toBe('in_progress');

    const corrected = setExecutionVerdict({
      runId: 'run-projection',
      verdict: 'not_achieved',
      correctionText: 'Fix the production rollout before closing.',
    })!;
    projections.project(corrected);
    expect(new OutcomeRepository().get(execution.outcomeId)).toMatchObject({
      userStatus: 'needs_user',
      internalStatus: 'blocked',
    });
    expect(workItems.getWorkItem(workItem.id)?.status).toBe('in_progress');
    expect(new WorkValueMetricsService().get().outcomes).toMatchObject({
      total: 1,
      achieved: 0,
      notAchieved: 1,
      userCorrected: 1,
      correctionRate: 1,
    });
  });
});
