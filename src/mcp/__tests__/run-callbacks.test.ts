import { createHmac, randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';

import { expect, it, vi } from 'vitest';

import { closeXopcDatabase, openXopcDatabase } from '../../storage/sqlite/connection.js';
import { DurableState } from '../../storage/sqlite/durable-state.js';
import { TaskApplicationService } from '../../tasks/task-application-service.js';
import { TaskRunRepository } from '../../tasks/task-run-repository.js';
import { createMcpConnection, revokeMcpConnection } from '../connection-grants.js';
import { subscribeToMcpRunCallback } from '../run-callback-subscriptions.js';
import { McpRunCallbackDispatcher } from '../run-callbacks.js';

const { httpsRequest, assertSafeUrl } = vi.hoisted(() => ({ httpsRequest: vi.fn(), assertSafeUrl: vi.fn() }));
vi.mock('node:https', async importOriginal => ({ ...await importOriginal<typeof import('node:https')>(), request: httpsRequest }));
vi.mock('../../media-shared/http/ssrf-guard.js', () => ({ assertSafeUrl }));

it('retries persisted signed lifecycle callbacks with the same event ID and stops on grant revocation', async () => {
  const dir = await import('node:fs/promises').then(fs => fs.mkdtemp('/tmp/xopc-mcp-callback-'));
  vi.stubEnv('XOPC_STATE_DIR', dir);
  vi.stubEnv('XOPC_CALLBACK_TEST_SECRET', 'test-signing-secret');
  vi.useFakeTimers({ toFake: ['Date'] });
  const worker = new McpRunCallbackDispatcher();
  const restarted = new McpRunCallbackDispatcher();
  const config = { url: 'https://callback.example/events', secretEnv: 'XOPC_CALLBACK_TEST_SECRET' };
  const subscription = new DurableState<{ attempts: number; sequence: number }>('mcp-run-callback');
  const deliveries: Array<{ headers: Record<string, string>; body: string }> = [];
  assertSafeUrl.mockResolvedValue({ resolvedIp: '8.8.8.8', family: 4 });
  const statuses = [503, 204];
  httpsRequest.mockImplementation((options, onResponse) => {
    expect(options).toMatchObject({ hostname: '8.8.8.8', servername: 'callback.example', path: '/events' });
    return Object.assign(new EventEmitter(), { end(body: string) {
      deliveries.push({ headers: options.headers, body });
      onResponse({ statusCode: statuses.shift(), destroy() {} });
    } });
  });
  try {
    openXopcDatabase({ path: `${dir}/xopc.db` });
    const { connectionId } = createMcpConnection(['xopc.agent_runs.start']);
    const principalId = `mcp:${connectionId}`;
    // An external executor fixture exercises the same durable task event journal as an Agent.
    const run = new TaskApplicationService().create({
      idempotencyKey: randomUUID(), title: 'Webhook fixture', context: [], authorityGrants: [], dependencies: [],
      activation: { mode: 'start', executor: { kind: 'external', provider: 'test', config: {} } },
      contract: { objective: 'Emit a callback', expectedOutputs: [], acceptanceCriteria: [], constraints: [],
        approvalRequired: [], assumptions: [], risks: [], acceptancePolicy: 'verified_then_review', outputDestinations: [] },
    }, { kind: 'integration', id: principalId });
    if (!run.ok || !run.runId) throw new Error('Fixture run was not queued');
    const runId = run.runId;
    expect(subscribeToMcpRunCallback(runId, principalId, config)).toBe(true);
    const tasks = new TaskRunRepository();
    tasks.createWait({ taskId: run.model.task.id, taskRunId: runId, kind: 'user_input', reason: 'The question stays in xopc' });
    worker.dispatch(() => config);
    await vi.waitFor(() => expect(subscription.get(runId)?.attempts).toBe(1));
    worker.stop();
    vi.setSystemTime(Date.now() + 5_000);
    restarted.dispatch(() => config);
    await vi.waitFor(() => expect(subscription.get(runId)).toMatchObject({ attempts: 0, sequence: 2 }));
    expect(deliveries).toHaveLength(2);
    expect(deliveries[0].headers['X-Xopc-Event-Id']).toBe(deliveries[1].headers['X-Xopc-Event-Id']);
    expect(deliveries[0].body).toBe(deliveries[1].body);
    for (const { headers, body } of deliveries) {
      expect(JSON.parse(body)).toEqual({ runId, eventId: headers['X-Xopc-Event-Id'], sequence: 2,
        type: 'task_run.wait_created', occurredAt: expect.any(Number) });
      const signature = createHmac('sha256', 'test-signing-secret').update(`${headers['X-Xopc-Timestamp']}.${body}`).digest('hex');
      expect(headers['X-Xopc-Signature']).toBe(`sha256=${signature}`);
    }
    revokeMcpConnection(connectionId);
    vi.setSystemTime(Date.now() + 5_000);
    restarted.dispatch(() => config);
    expect(subscription.get(runId)).toBeUndefined();
    expect(deliveries).toHaveLength(2);
  } finally {
    worker.stop();
    restarted.stop();
    closeXopcDatabase();
    vi.useRealTimers();
    vi.unstubAllEnvs();
    await import('node:fs/promises').then(fs => fs.rm(dir, { recursive: true, force: true }));
  }
});
