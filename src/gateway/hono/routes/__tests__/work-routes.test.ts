import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Hono } from 'hono';
import { WorkValueMetricsSchema } from '@xopcai/gateway-contract';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ProjectService } from '../../../../projects/index.js';
import {
  closeXopcDatabase,
  openXopcDatabase,
  resetXopcDatabaseSingletonForTest,
  updateRelationshipSettings,
} from '../../../../storage/sqlite/index.js';
import { WorkItemService } from '../../../../work-items/index.js';
import { OutcomeExecutionStateRepository, OutcomeRepository } from '../../../../work/index.js';
import { WorkIntakeService } from '../../../../work/work-intake-service.js';
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
      service: { projects, workItems, enqueueOutcome: vi.fn() } as unknown as GatewayService,
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
    const work = (await confirmed.json()).work as { outcomeId: string };
    expect(new OutcomeRepository().get(work.outcomeId)?.objective).toBe('Prepare the September product launch');
    expect(new OutcomeExecutionStateRepository().get(work.outcomeId)).toMatchObject({
      nextAction: 'Complete the first verifiable result.',
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
      service: { projects, workItems, enqueueOutcome: vi.fn() } as unknown as GatewayService,
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
    };
    const replayedConfirmation = await app.request(
      `/api/work/intakes/${firstProposal.id}/confirm`,
      confirmationRequest,
    );
    expect((await replayedConfirmation.json()).work).toMatchObject(firstWork);
    expect(projects.list({ limit: 20 }).items).toHaveLength(0);
    expect(new OutcomeRepository().list({ limit: 20 })).toHaveLength(1);
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
    const enqueueOutcome = vi.fn((outcomeId: string, _options: unknown) => ({
      id: 'queue-intake-1',
      outcomeId,
      status: 'queued' as const,
      attempts: 0,
      maxRetries: 2,
      enqueuedAt: Date.now(),
      source: 'api' as const,
    }));
    app = new Hono();
    registerWorkRoutes(app, {
      service: { projects, workItems, enqueueOutcome } as unknown as GatewayService,
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
      execution: { mode: string; status: string; queueId?: string };
    };
    expect(work.execution).toEqual({
      mode: 'run_now',
      status: 'queued',
      queueId: 'queue-intake-1',
    });
    expect(enqueueOutcome).toHaveBeenCalledWith(work.outcomeId, {
      source: 'api',
      executionContext: {
        contextTraceId: proposal.id,
        triggerKind: 'user',
      },
    });
  });

  it('requires the one blocking decision before starting material work', async () => {
    const enqueue = vi.fn((outcomeId: string) => ({
      id: 'queue-approved-intake',
      outcomeId,
      status: 'queued' as const,
      attempts: 0,
      maxRetries: 2,
      enqueuedAt: Date.now(),
      source: 'api' as const,
    }));
    const intake = new WorkIntakeService(projects, { enqueue }, {
      plan: async ({ objective }) => ({
        objective,
        deliverables: ['Published release'],
        acceptanceCriteria: ['Production reports the new version'],
        constraints: [],
        approvalRequired: ['Publish to production', 'Use the release budget'],
        assumptions: [],
        risks: [],
      }),
    });
    const proposal = await intake.propose({
      idempotencyKey: 'blocking-decision-intake',
      objective: 'Ship the release safely',
    });

    expect(proposal.executionReadiness).toMatchObject({
      canStartImmediately: false,
      blockingDecision: { id: 'approve-execution-boundaries' },
    });
    expect(() => intake.confirm({
      proposalId: proposal.id,
      executionMode: 'run_now',
    })).toThrow('The required execution decision must be approved');
    expect(enqueue).not.toHaveBeenCalled();

    const work = intake.confirm({
      proposalId: proposal.id,
      executionMode: 'run_now',
      blockingDecisionId: proposal.executionReadiness.blockingDecision?.id,
    });
    expect(work?.execution.status).toBe('queued');
    expect(enqueue).toHaveBeenCalledOnce();
  });

  it('cannot bypass execution boundary approval from outcome actions', async () => {
    const intake = new WorkIntakeService(projects, { enqueue: vi.fn() }, {
      plan: async ({ objective }) => ({
        objective,
        deliverables: ['Published release'],
        acceptanceCriteria: ['Production reports the new version'],
        constraints: [],
        approvalRequired: ['Publish to production'],
        assumptions: [],
        risks: [],
      }),
    });
    const proposal = await intake.propose({
      idempotencyKey: 'action-boundary-intake',
      objective: 'Publish the release',
    });
    const work = intake.confirm({ proposalId: proposal.id, executionMode: 'create_only' });
    expect(work).toBeDefined();

    const rejected = await app.request(`/api/outcomes/${work!.outcomeId}/actions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'run' }),
    });
    expect(rejected.status).toBe(409);
    expect(await rejected.json()).toMatchObject({
      error: 'Required execution boundaries must be approved',
      requiredBoundaries: ['Publish to production'],
    });

    const approved = await app.request(`/api/outcomes/${work!.outcomeId}/actions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        action: 'run',
        approvedBoundaries: ['Publish to production'],
      }),
    });
    expect(approved.status).toBe(200);
    expect(new OutcomeExecutionStateRepository().get(work!.outcomeId)?.approvedBoundaries)
      .toEqual(['Publish to production']);
  });

  it('pauses and resumes an outcome through the outcome model', async () => {
    const enqueueOutcome = vi.fn((outcomeId: string) => ({
      id: 'queue-resume-1',
      outcomeId,
      status: 'queued' as const,
      attempts: 0,
      maxRetries: 2,
      enqueuedAt: Date.now(),
      source: 'api' as const,
    }));
    app = new Hono();
    registerWorkRoutes(app, {
      service: { projects, workItems, enqueueOutcome } as unknown as GatewayService,
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
    const work = ((await confirmed.json()) as { work: { outcomeId: string } }).work;

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
      queued: { id: 'queue-resume-1', outcomeId: work.outcomeId },
    });
    expect(enqueueOutcome).toHaveBeenCalledWith(work.outcomeId, expect.objectContaining({
      executionContext: expect.objectContaining({ triggerKind: 'retry' }),
    }));
  });
});
