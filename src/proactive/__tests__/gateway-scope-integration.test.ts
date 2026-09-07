import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { mapProductEventToProactive } from '../events/product-event-bridge.js';
import { ProactiveScenarioService } from '../scenarios/service.js';
import { ProactiveEventService } from '../service.js';
import { closeXopcDatabase, openXopcDatabase, resetXopcDatabaseSingletonForTest } from '../../storage/sqlite/index.js';
import { ProjectMonitoringService } from '../../tasks/project-monitoring-service.js';
import { ProjectService } from '../../projects/project-service.js';

describe('proactive gateway scope integration', () => {
  let stateDir: string;

  beforeEach(() => {
    stateDir = mkdtempSync(join(tmpdir(), 'xopc-proactive-scope-'));
    resetXopcDatabaseSingletonForTest();
    openXopcDatabase({ path: join(stateDir, 'xopc.db') });
  });

  afterEach(() => {
    closeXopcDatabase();
    resetXopcDatabaseSingletonForTest();
    rmSync(stateDir, { recursive: true, force: true });
  });

  it('routes task product events through a project monitoring subscription in the same workspace', () => {
    const workspaceId = '/workspace';
    const projectId = new ProjectService().create({ name: 'Project' }).id;
    const db = new ProactiveScenarioService();
    const events = new ProactiveEventService(() => db.routes());

    new ProjectMonitoringService(workspaceId).configure({
      projectId,
      mode: 'ask_before_action',
      scenarios: ['blocked_work'],
    });

    const input = mapProductEventToProactive({
      event: {
        type: 'task.attention_required.v2',
        source: 'tasks',
        occurredAtMs: 1,
        payload: { taskId: 'task-1', projectId, reason: 'blocked' },
      },
      workspaceId,
      defaultAgentId: 'main',
    });
    expect(input).not.toBeNull();
    events.publish(input!);

    expect(events.listBatches()).toHaveLength(1);
    expect(events.listBatches()[0]).toMatchObject({
      scenarioKey: 'blocked_work',
      aggregationKey: `project:${projectId}`,
    });
  });
});
