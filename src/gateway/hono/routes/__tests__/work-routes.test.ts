import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  OutcomeDetailResponseSchema,
  OutcomeStartResponseSchema,
  WorkValueMetricsSchema,
} from '@xopcai/gateway-contract';
import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ConfigSchema } from '../../../../config/schema.js';
import { ProjectService } from '../../../../projects/index.js';
import {
  closeXopcDatabase,
  ensureSessionRecord,
  openXopcDatabase,
  resetXopcDatabaseSingletonForTest,
} from '../../../../storage/sqlite/index.js';
import { WorkItemService } from '../../../../work-items/index.js';
import { OutcomeExecutionStateRepository, OutcomeRepository } from '../../../../work/index.js';
import type { GatewayService } from '../../../service.js';
import { registerWorkRoutes } from '../work.js';

describe('work orchestration routes', () => {
  let stateDir: string;
  let app: Hono;
  let projects: ProjectService;
  let submitSessionInput: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    stateDir = mkdtempSync(join(tmpdir(), 'xopc-work-routes-'));
    resetXopcDatabaseSingletonForTest();
    openXopcDatabase({ path: join(stateDir, 'xopc.db') });
    projects = new ProjectService();
    const metadata = new Map<string, Record<string, unknown>>();
    submitSessionInput = vi.fn(async ({ sessionKey }: { sessionKey: string }) => ({
      ok: true as const,
      effectiveDelivery: 'next' as const,
      state: { sessionKey, inputs: [], activeRunId: 'run-1', version: 1 },
    }));
    app = new Hono();
    registerWorkRoutes(app, {
      service: {
        currentConfig: ConfigSchema.parse({}),
        projects,
        workItems: new WorkItemService(),
        enqueueOutcome: vi.fn(),
        submitSessionInput,
        sessionIndexInstance: {
          getSessionMetadata: vi.fn(async (key: string) => metadata.get(key) ?? null),
          saveMessages: vi.fn(async (key: string, _messages: unknown[], options: { metadata: Record<string, unknown> }) => {
            ensureSessionRecord(key, process.cwd());
            metadata.set(key, options.metadata);
          }),
          updateSessionMetadata: vi.fn(async (key: string, patch: Record<string, unknown>) => {
            metadata.set(key, { ...metadata.get(key), ...patch });
          }),
        },
      } as unknown as GatewayService,
      strictRateLimitMiddleware: async (_c, next) => next(),
    } as never);
  });

  afterEach(() => {
    closeXopcDatabase();
    resetXopcDatabaseSingletonForTest();
    rmSync(stateDir, { recursive: true, force: true });
  });

  it('starts one durable outcome and submits the original intent to its session', async () => {
    const requestId = '47fd2a0b-f323-4eb8-b115-83ed2c8267c0';
    const response = await app.request('/api/outcomes', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ requestId, objective: 'Prepare the September product launch' }),
    });

    expect(response.status).toBe(202);
    const started = OutcomeStartResponseSchema.parse(await response.json());
    expect(started).toMatchObject({
      accepted: true,
      outcome: { objective: 'Prepare the September product launch', internalStatus: 'captured' },
      runId: 'run-1',
    });
    expect(submitSessionInput).toHaveBeenCalledWith({
      sessionKey: started.sessionKey,
      clientMessageId: requestId,
      delivery: 'next',
      content: 'Prepare the September product launch',
    });
    expect(new OutcomeExecutionStateRepository().get(started.outcome.id)).toMatchObject({
      activeSessionKey: started.sessionKey,
      source: 'api',
    });
    expect(OutcomeDetailResponseSchema.parse(
      await (await app.request(`/api/outcomes/${started.outcome.id}`)).json(),
    ).execution).toMatchObject({
      sessionKey: started.sessionKey,
      approvedBoundaries: [],
    });
    expect(WorkValueMetricsSchema.parse((await (await app.request('/api/work/metrics')).json()).metrics))
      .toMatchObject({ outcomes: { total: 1 } });
  });

  it('replays the same request id without creating a second outcome', async () => {
    const body = JSON.stringify({
      requestId: 'e70bb76b-2741-4c94-84f7-5a02da1ae931',
      objective: 'Prepare a durable release plan',
    });
    const first = OutcomeStartResponseSchema.parse(await (await app.request('/api/outcomes', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body,
    })).json());
    const replay = OutcomeStartResponseSchema.parse(await (await app.request('/api/outcomes', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body,
    })).json());

    expect(replay.outcome.id).toBe(first.outcome.id);
    expect(new OutcomeRepository().list({ limit: 20 })).toHaveLength(1);
  });

  it('coalesces concurrent starts and rejects request id reuse with different input', async () => {
    const requestId = 'ed0e0755-f6a8-42bb-bd6c-fd52f7bcf254';
    const request = () => app.request('/api/outcomes', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ requestId, objective: 'Ship the verified launch checklist' }),
    });
    const [first, second] = await Promise.all([request(), request()]);
    const outcomes = await Promise.all([
      first.json().then((value) => OutcomeStartResponseSchema.parse(value)),
      second.json().then((value) => OutcomeStartResponseSchema.parse(value)),
    ]);

    expect(outcomes[0].outcome.id).toBe(outcomes[1].outcome.id);
    expect(new OutcomeRepository().list({ limit: 20 })).toHaveLength(1);

    const conflict = await app.request('/api/outcomes', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ requestId, objective: 'A different outcome' }),
    });
    expect(conflict.status).toBe(409);
  });

  it('does not expose the removed WorkIntake endpoints', async () => {
    expect((await app.request('/api/work/intakes', { method: 'POST' })).status).toBe(404);
    expect((await app.request('/api/work/intakes/old/confirm', { method: 'POST' })).status).toBe(404);
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
      policy: { mode: 'ask_before_action', scenarios: ['blocked_work', 'project_delivery_risk'] },
    });
  });
});
