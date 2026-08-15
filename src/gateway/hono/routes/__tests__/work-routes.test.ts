import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { GoalService } from '../../../../goals/index.js';
import { ProjectService } from '../../../../projects/index.js';
import {
  closeXopcDatabase,
  openXopcDatabase,
  resetXopcDatabaseSingletonForTest,
} from '../../../../storage/sqlite/index.js';
import { WorkItemService } from '../../../../work-items/index.js';
import { ProjectMonitoringService } from '../../../../work/index.js';
import type { GatewayService } from '../../../service.js';
import { registerWorkRoutes } from '../work.js';

describe('work orchestration routes', () => {
  let stateDir: string;
  let app: Hono;
  let projects: ProjectService;
  let workItems: WorkItemService;

  beforeEach(() => {
    stateDir = mkdtempSync(join(tmpdir(), 'xopc-work-routes-'));
    resetXopcDatabaseSingletonForTest();
    openXopcDatabase({ path: join(stateDir, 'xopc.db') });
    projects = new ProjectService();
    workItems = new WorkItemService();
    app = new Hono();
    registerWorkRoutes(app, {
      service: { projects, workItems } as GatewayService,
      strictRateLimitMiddleware: async (_c, next) => next(),
    } as never);
  });

  afterEach(() => {
    closeXopcDatabase();
    resetXopcDatabaseSingletonForTest();
    rmSync(stateDir, { recursive: true, force: true });
  });

  it('turns a confirmed intent into one project outcome and next action', async () => {
    const proposed = await app.request('/api/work/intakes', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ objective: 'Prepare the September product launch' }),
    });
    expect(proposed.status).toBe(201);
    const proposal = (await proposed.json()).proposal as { id: string };

    const confirmed = await app.request(`/api/work/intakes/${proposal.id}/confirm`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ nextAction: 'Draft the launch checklist' }),
    });
    expect(confirmed.status).toBe(201);
    const work = (await confirmed.json()).work as { projectId: string; goalId: string; workItemId: string };
    expect(projects.get(work.projectId)?.name).toContain('Prepare the September product launch');
    expect(new GoalService().get(work.goalId)).toMatchObject({
      projectId: work.projectId,
      nextAction: 'Draft the launch checklist',
    });
    expect(workItems.getWorkItem(work.workItemId)).toMatchObject({
      projectId: work.projectId,
      nextAction: 'Draft the launch checklist',
    });
    expect(new ProjectMonitoringService().get(work.projectId)).toMatchObject({
      mode: 'ask_before_action',
      scenarios: ['blocked_work', 'project_delivery_risk'],
      configured: true,
    });

    const view = await app.request(`/api/projects/${work.projectId}/operating-view`);
    expect(view.status).toBe(200);
    expect(await view.json()).toMatchObject({
      ok: true,
      view: {
        project: { id: work.projectId },
        desiredOutcomes: [{ id: work.goalId }],
        currentActions: [{ id: work.workItemId }],
      },
    });

    const updated = await app.request(`/api/projects/${work.projectId}/monitoring`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        mode: 'auto_low_risk',
        allowedActions: ['send_reminder'],
        confidenceThreshold: 0.9,
      }),
    });
    expect(updated.status).toBe(200);
    expect(await updated.json()).toMatchObject({
      ok: true,
      policy: {
        projectId: work.projectId,
        mode: 'auto_low_risk',
        allowedActions: ['send_reminder'],
        confidenceThreshold: 0.9,
      },
    });

    const fetched = await app.request(`/api/projects/${work.projectId}/monitoring`);
    expect(await fetched.json()).toMatchObject({
      ok: true,
      policy: { mode: 'auto_low_risk', configured: true },
    });
  });

  it('enables the default delivery scenarios when monitoring an existing project', async () => {
    const project = projects.create({ name: 'Existing project' });
    const response = await app.request(`/api/projects/${project.id}/monitoring`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ mode: 'ask_before_action' }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      ok: true,
      policy: {
        mode: 'ask_before_action',
        scenarios: ['blocked_work', 'project_delivery_risk'],
      },
    });
  });
});
