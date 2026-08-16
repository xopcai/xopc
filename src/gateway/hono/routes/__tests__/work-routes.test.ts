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
import { OutcomeRepository } from '../../../../work/index.js';
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

  it('turns a confirmed intent into one outcome without project or work-item ceremony', async () => {
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
        planningContext: { supportMode: string; proactiveEnabled: boolean };
        outcomeContract: { deliverables: string[]; acceptanceCriteria: string[] };
      };
    };
    const proposal = proposalPayload.proposal;
    expect(proposal).toMatchObject({
      planningContext: { supportMode: 'auto', proactiveEnabled: false },
      outcomeContract: {
        deliverables: ['Prepare the September product launch'],
        acceptanceCriteria: expect.arrayContaining([
          expect.stringContaining('Prepare the September product launch'),
        ]),
      },
    });

    const confirmed = await app.request(`/api/work/intakes/${proposal.id}/confirm`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ executionMode: 'create_only' }),
    });
    expect(confirmed.status).toBe(201);
    const work = (await confirmed.json()).work as { outcomeId: string; goalId: string };
    expect(new OutcomeRepository().get(work.outcomeId)?.objective).toBe('Prepare the September product launch');
    expect(new GoalService().get(work.goalId)).toMatchObject({
      outcomeId: work.outcomeId,
      nextAction: 'Complete the first verifiable result.',
      checklist: expect.arrayContaining([
        expect.objectContaining({ text: expect.stringContaining('Prepare the September product launch') }),
      ]),
    });
    expect(projects.list({ limit: 20 }).items).toHaveLength(0);
    expect(workItems.listWorkItems({ limit: 20 }).items).toHaveLength(0);

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
      outcomeId: string;
      goalId: string;
    };
    const replayedConfirmation = await app.request(
      `/api/work/intakes/${firstProposal.id}/confirm`,
      confirmationRequest,
    );
    expect((await replayedConfirmation.json()).work).toMatchObject(firstWork);
    expect(projects.list({ limit: 20 }).items).toHaveLength(0);
    expect(new GoalService().list({ limit: 20 })).toHaveLength(1);
    expect(workItems.listWorkItems({ limit: 20 }).items).toHaveLength(0);
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
    const enqueueGoalRun = vi.fn((goalId: string, _options: unknown) => ({
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
      outcomeId: string;
      goalId: string;
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
        outcomeId: work.outcomeId,
        contextTraceId: proposal.id,
        triggerKind: 'user',
      },
    });
  });

  it('pauses and resumes an outcome without exposing the underlying goal model', async () => {
    const enqueueGoalRun = vi.fn((goalId: string) => ({
      id: 'queue-resume-1',
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
      body: JSON.stringify({ idempotencyKey: 'outcome-controls-1', objective: 'Finish the outcome safely' }),
    });
    const proposalId = ((await proposed.json()) as { proposal: { id: string } }).proposal.id;
    const confirmed = await app.request(`/api/work/intakes/${proposalId}/confirm`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ executionMode: 'create_only' }),
    });
    const work = ((await confirmed.json()) as { work: { outcomeId: string; goalId: string } }).work;

    const paused = await app.request(`/api/outcomes/${work.outcomeId}/actions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'pause' }),
    });
    expect(await paused.json()).toMatchObject({
      ok: true,
      outcome: { id: work.outcomeId, internalStatus: 'paused' },
    });

    const resumed = await app.request(`/api/outcomes/${work.outcomeId}/actions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'resume' }),
    });
    expect(await resumed.json()).toMatchObject({
      ok: true,
      outcome: { id: work.outcomeId, internalStatus: 'continuing' },
      queued: { id: 'queue-resume-1', goalId: work.goalId },
    });
    expect(enqueueGoalRun).toHaveBeenCalledWith(work.goalId, expect.objectContaining({
      executionContext: expect.objectContaining({ outcomeId: work.outcomeId, triggerKind: 'retry' }),
    }));
  });
});
