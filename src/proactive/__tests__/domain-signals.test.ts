import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { AutomationService } from '../../automations/service/automation-service.js';
import { ProjectService } from '../../projects/project-service.js';
import { closeXopcDatabase, openXopcDatabase, resetXopcDatabaseSingletonForTest } from '../../storage/sqlite/index.js';
import { WorkItemService } from '../../work-items/work-item-service.js';
import { ProactiveScenarioService } from '../scenarios/service.js';
import { ProactiveEventService } from '../service.js';

async function waitUntil(check: () => boolean): Promise<void> {
  const deadline = Date.now() + 2_000;
  while (!check() && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 20));
}

describe('proactive domain signals', () => {
  let stateDir: string;
  let scenarios: ProactiveScenarioService;
  let signals: ProactiveEventService;
  let automations: AutomationService | undefined;

  beforeEach(() => {
    stateDir = mkdtempSync(join(tmpdir(), 'xopc-proactive-domain-'));
    resetXopcDatabaseSingletonForTest(); openXopcDatabase({ path: join(stateDir, 'xopc.db') });
    scenarios = new ProactiveScenarioService();
    for (const scenarioKey of ['project_delivery_risk', 'blocked_work', 'automation_failure_impact']) {
      scenarios.subscribe({ scenarioKey, workspaceId: 'default', scopeKind: 'workspace', scopeId: 'default', enabled: true });
    }
    signals = new ProactiveEventService(() => scenarios.routes());
  });

  it('routes an explicit blocked transition only to the blocked-work scenario', () => {
    const projects = new ProjectService(undefined, signals);
    const project = projects.create({ name: 'Launch' });
    const workItems = new WorkItemService(undefined, signals);
    const item = workItems.createProjectWorkItem(project.id, { title: 'Ship release' });
    workItems.updateWorkItem(item.id, { status: 'blocked', blockedReason: 'Needs owner decision' });
    expect(signals.listBatches().filter((batch) => batch.status === 'collecting').map((batch) => batch.scenarioKey)).toEqual(['blocked_work']);
  });

  afterEach(async () => { await automations?.stop(); closeXopcDatabase(); resetXopcDatabaseSingletonForTest(); rmSync(stateDir, { recursive: true, force: true }); });

  it('publishes project and work-item changes directly into scoped scenario batches', () => {
    const projects = new ProjectService(undefined, signals);
    const workItems = new WorkItemService(undefined, signals);
    const project = projects.create({ name: 'Launch' });
    projects.update(project.id, { brief: 'Ship before quarter end' });
    const item = workItems.createProjectWorkItem(project.id, { title: 'Release review', status: 'todo' });
    workItems.updateWorkItem(item.id, { status: 'blocked', blockedReason: 'Security approval' });
    expect(signals.listEvents().map((event) => event.type).sort()).toEqual(['project.updated.v1', 'work_item.status_changed.v1']);
    expect(signals.listBatches().map((batch) => batch.scenarioKey).sort()).toEqual(['blocked_work', 'project_delivery_risk']);
    expect(signals.listBatches().find((batch) => batch.scenarioKey === 'project_delivery_risk')?.eventCount).toBe(1);
  });

  it('publishes terminal automation failure with the completed run as evidence', async () => {
    automations = new AutomationService(signals);
    automations.setDeps({ getDefaultAgentId: () => 'main', agentService: {
      turnDispatcher: { processDirect: async () => { throw new Error('provider unavailable'); } },
      getModelForSession: () => 'test/model',
    } });
    await automations.initialize();
    const automation = await automations.create({ name: 'Daily decision brief', trigger: { kind: 'manual' }, action: { kind: 'agent', instruction: 'summarize' } });
    await automations.runNow(automation.id);
    await waitUntil(() => signals.listEvents().some((event) => event.type === 'automation.run_failed.v1'));
    expect(signals.listBatches().some((batch) => batch.scenarioKey === 'automation_failure_impact')).toBe(true);
  });
});
