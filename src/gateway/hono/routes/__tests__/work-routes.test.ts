import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Hono } from 'hono';
import { WorkValueMetricsSchema } from '@xopcai/gateway-contract';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { GoalService } from '../../../../goals/index.js';
import { ProjectService } from '../../../../projects/index.js';
import {
  closeXopcDatabase,
  openXopcDatabase,
  resetXopcDatabaseSingletonForTest,
  updateRelationshipSettings,
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
      body: JSON.stringify({
        idempotencyKey: 'launch-intake-1',
        objective: 'Prepare the September product launch',
      }),
    });
    expect(proposed.status).toBe(201);
    const proposalPayload = await proposed.json() as {
      proposal: {
        id: string;
        monitoringSuggestion: { mode: string };
        planningContext: { supportMode: string; proactiveEnabled: boolean };
      };
    };
    const proposal = proposalPayload.proposal;
    expect(proposal).toMatchObject({
      monitoringSuggestion: { mode: 'observe' },
      planningContext: { supportMode: 'auto', proactiveEnabled: false },
    });

    const confirmed = await app.request(`/api/work/intakes/${proposal.id}/confirm`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        executionMode: 'create_only',
        nextAction: 'Draft the launch checklist',
      }),
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
      mode: 'observe',
      scenarios: ['blocked_work', 'project_delivery_risk'],
      configured: true,
    });

    const metricsResponse = await app.request('/api/work/metrics');
    const metricsPayload = await metricsResponse.json() as { metrics: unknown };
    expect(WorkValueMetricsSchema.parse(metricsPayload.metrics)).toMatchObject({
      intake: {
        total: 1,
        confirmed: 1,
        createOnly: 1,
        confirmationRate: 1,
      },
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

  it('applies the user proactive preference to new work planning', async () => {
    updateRelationshipSettings({ proactiveEnabled: true, supportMode: 'efficient' });
    const response = await app.request('/api/work/intakes', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        idempotencyKey: 'preference-aware-intake-1',
        objective: 'Prepare a customer research brief',
      }),
    });
    expect(response.status).toBe(201);
    expect((await response.json()).proposal).toMatchObject({
      monitoringSuggestion: { mode: 'ask_before_action' },
      planningContext: { supportMode: 'efficient', proactiveEnabled: true },
    });
  });

  it('persists intake proposals and confirms them idempotently across route recreation', async () => {
    const request = {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        idempotencyKey: 'persistent-intake-1',
        objective: 'Prepare a durable release plan',
      }),
    };
    const firstProposalResponse = await app.request('/api/work/intakes', request);
    const firstProposal = (await firstProposalResponse.json()).proposal as { id: string };
    const replayedProposalResponse = await app.request('/api/work/intakes', request);
    const replayedProposal = (await replayedProposalResponse.json()).proposal as { id: string };
    expect(replayedProposal.id).toBe(firstProposal.id);

    app = new Hono();
    registerWorkRoutes(app, {
      service: { projects, workItems } as GatewayService,
      strictRateLimitMiddleware: async (_c, next) => next(),
    } as never);

    const confirmationRequest = {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ executionMode: 'create_only' }),
    };
    const firstConfirmation = await app.request(
      `/api/work/intakes/${firstProposal.id}/confirm`,
      confirmationRequest,
    );
    const firstWork = (await firstConfirmation.json()).work as {
      projectId: string;
      goalId: string;
      workItemId: string;
    };
    const replayedConfirmation = await app.request(
      `/api/work/intakes/${firstProposal.id}/confirm`,
      confirmationRequest,
    );
    expect((await replayedConfirmation.json()).work).toMatchObject(firstWork);
    expect(projects.list({ limit: 20 }).items).toHaveLength(1);
    expect(new GoalService().list({ limit: 20 })).toHaveLength(1);
    expect(workItems.listWorkItems({ limit: 20 }).items).toHaveLength(1);
  });

  it('rejects reuse of an idempotency key for a different objective', async () => {
    const first = await app.request('/api/work/intakes', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        idempotencyKey: 'conflicting-intake-1',
        objective: 'Prepare the launch plan',
      }),
    });
    expect(first.status).toBe(201);

    const conflict = await app.request('/api/work/intakes', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        idempotencyKey: 'conflicting-intake-1',
        objective: 'Prepare an unrelated hiring plan',
      }),
    });
    expect(conflict.status).toBe(400);
    expect(await conflict.json()).toMatchObject({
      ok: false,
      error: 'Idempotency key was already used for a different work intake',
    });
  });

  it('queues confirmed work immediately with durable execution context', async () => {
    const enqueueGoalRun = vi.fn((goalId: string, options: unknown) => ({
      id: 'queue-intake-1',
      goalId,
      status: 'queued' as const,
      attempts: 0,
      maxRetries: 2,
      enqueuedAt: Date.now(),
      source: 'api' as const,
    }));
    app = new Hono();
    registerWorkRoutes(app, {
      service: { projects, workItems, enqueueGoalRun } as unknown as GatewayService,
      strictRateLimitMiddleware: async (_c, next) => next(),
    } as never);

    const proposed = await app.request('/api/work/intakes', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        idempotencyKey: 'run-now-intake-1',
        objective: 'Ship the verified onboarding flow',
      }),
    });
    const proposal = (await proposed.json()).proposal as { id: string };
    const confirmed = await app.request(`/api/work/intakes/${proposal.id}/confirm`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ executionMode: 'run_now' }),
    });
    expect(confirmed.status).toBe(201);
    const work = (await confirmed.json()).work as {
      goalId: string;
      workItemId: string;
      execution: { mode: string; status: string; queueId?: string };
    };
    expect(work.execution).toEqual({
      mode: 'run_now',
      status: 'queued',
      queueId: 'queue-intake-1',
    });
    expect(enqueueGoalRun).toHaveBeenCalledWith(work.goalId, {
      source: 'api',
      executionContext: {
        workItemId: work.workItemId,
        contextTraceId: proposal.id,
        triggerKind: 'user',
      },
    });
    expect(workItems.getWorkItem(work.workItemId)?.status).toBe('in_progress');
  });
});
