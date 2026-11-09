import { randomUUID } from 'node:crypto';
import { once } from 'node:events';

import { serve } from '@hono/node-server';
import { expect, it, vi } from 'vitest';

import { AutomationService } from '../../../../automations/service/automation-service.js';
import { settleTask } from '../../../../home-intelligence/__tests__/routine-fixture.js';
import { ConfigSchema } from '../../../../config/schema.js';
import { HomeIntelligenceHost } from '../../../../home-intelligence/host.js';
import { HomeSnapshotBuilder, type HomeContextSnapshot } from '../../../../home-intelligence/snapshot.js';
import { appendTranscriptEntry, closeXopcDatabase, getXopcDatabase, openXopcDatabase, resetXopcDatabaseSingletonForTest } from '../../../../storage/sqlite/index.js';
import { createConversation } from '../../../../storage/sqlite/conversation-repository.js';
import { TaskRepository } from '../../../../tasks/task-repository.js';
import { buckets } from '../../../rate-limit/index.js';
import type { GatewayService } from '../../../service.js';
import { createHonoApp } from '../../app.js';

it('connects durable observation, scoped feedback and private Task trials through authenticated lazy Gateway routes', async () => {
  resetXopcDatabaseSingletonForTest(); openXopcDatabase({ path: ':memory:' }); buckets.resetAllForTests();
  const id = randomUUID();
  createConversation({ agentId: 'main', sourceChannel: 'webchat', name: '发布周报', routing: { source: 'webchat', accountId: 'default', agentId: 'main', peerKind: 'direct', peerId: 'owner' } }, '', id);
  appendTranscriptEntry(id, { role: 'user', content: '请整理项目周报草稿', timestamp: Date.now() });
  const generate = vi.fn(async (snapshot: HomeContextSnapshot) => ({ modelRef: 'test/reasoning', usage: {}, result: {
    state: 'ready' as const, candidates: [{ kind: 'project_next_step' as const, title: '整理周报草稿', outcome: '一份私人周报草稿',
      rationale: '依据工作记录及发布期反馈', evidenceIds: [snapshot.evidence[0]!.id], confidence: 'high' as const,
      urgency: 'today' as const, risk: 'analysis' as const, proposedSteps: ['整理工作进展'], requiredCapabilities: [],
      verification: ['所有条目附来源'], actionPrompt: '整理私人周报草稿，每项附来源。' }],
  } }));
  const automations = new AutomationService();
  await automations.initialize();
  const host = new HomeIntelligenceHost(getXopcDatabase().db, { principal: { ownerId: 'local-owner', workspaceId: 'fixture' },
    automations, canObserve: () => true, generator: { generate }, locale: () => 'zh',
    snapshot: new HomeSnapshotBuilder({ projects: () => [], tasks: () => [], knowledge: () => [] }),
    capabilities: () => ({ agentId: 'main', connectors: new Set(), skills: new Set() }),
    resolveCapabilities: () => ({ capabilities: [], preflight: { state: 'ready' } }), publish: vi.fn(), notifyOpportunity: vi.fn(),
  });
  automations.setDeps({ executeRoutine: input => host.routines!.execute(input), onRunCompleted: vi.fn(async () => undefined) });
  const auth = { mode: 'token' as const, token: 'observation-fixture-token' };
  const config = ConfigSchema.parse({ gateway: { auth } });
  const service = { currentConfig: config, homeIntelligence: host,
    getResolvedAuth: () => auth, getEffectiveListenPort: () => 18790,
    isGatewayReady: () => true, getHealth: () => ({ status: 'healthy' }),
    sessions: { listActiveRuns: () => [], getSession: async () => null },
    projects: { list: () => ({ items: [] }) },
    automationServiceInstance: { list: async () => [], listRuns: async () => [] },
  } as unknown as GatewayService;
  const app = createHonoApp({ service });
  const listener = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: 0 });
  try {
    if (!listener.listening) await once(listener, 'listening');
    const address = listener.address(); if (!address || typeof address === 'string') throw Error('No listener');
    const base = `http://127.0.0.1:${address.port}`;
    const headers = { Authorization: `Bearer ${auth.token}`, 'Content-Type': 'application/json' };
    const post = (path: string, body: unknown) => fetch(`${base}${path}`, { method: 'POST', headers, body: JSON.stringify(body) });
    expect((await fetch(`${base}/api/home/observation/command`, { method: 'POST', body: '{}' })).status).toBe(401);
    const started = await post('/api/home/observation/command', { expectedRevision: 0, idempotencyKey: 'start', command: { kind: 'start', backfillDays: 30 } });
    expect(started.status).toBe(200);
    await vi.waitFor(() => expect(host.getAdvisor().state).toBe('ready'));
    const initial = await fetch(`${base}/api/home?locale=zh`, { headers }).then(r => r.json());
    expect(initial.observation.topics).toHaveLength(1);
    const topicId = initial.observation.topics[0].id;
    const response = await post('/api/home/observation/command', { expectedRevision: initial.observation.revision,
      idempotencyKey: 'feedback', command: { kind: 'feedback', topicId, scope: 'similar', text: '只在发布期需要，每项附来源' } });
    expect(response.status).toBe(200);
    await vi.waitFor(() => expect(host.observation.state().analyzedRevision).toBe(host.observation.state().revision));
    expect(generate.mock.calls.at(-1)![0].observation?.feedback[0]?.text).toContain('发布期');
    const current = host.getAdvisor(); if (current.state !== 'ready') throw Error('Missing suggestion');
    const request = { topicId, opportunityId: current.primary.id, expectedOpportunityRevision: current.primary.revision,
      expectedRevision: host.observation.state().revision, idempotencyKey: 'trial' };
    const trial = await post('/api/home/observation/trial', request); const result = await trial.json();
    expect(trial.status, JSON.stringify(result)).toBe(200);
    expect(result.outcome).toBe('task');
    expect(await post('/api/home/observation/trial', request).then(r => r.json())).toEqual(result);
    expect(new TaskRepository().get(result.taskId)?.contract?.constraints.join(' ')).toContain('发布期');
    expect(host.observation.state().topics[0]?.trials[0]?.taskId).toBe(result.taskId);
    const discussionRequest = { topicId, expectedRevision: host.observation.state().revision, idempotencyKey: 'discuss' };
    const discussion = await post('/api/home/observation/discussion', discussionRequest).then(r => r.json());
    expect(discussion.conversationId).toBeTypeOf('string');
    expect(await post('/api/home/observation/discussion', discussionRequest).then(r => r.json())).toEqual(discussion);
    appendTranscriptEntry(discussion.conversationId, { role: 'user', content: '以后都检查未关闭的阻塞', timestamp: Date.now() });
    host.observation.collect();
    expect(host.observation.state().topics).toHaveLength(1);
    expect(host.observation.state().topics[0]?.entries.some(e => e.text.includes('未关闭的阻塞'))).toBe(true);
    expect((await post('/api/home/observation/command', { expectedRevision: 0, idempotencyKey: 'stale', command: { kind: 'pause' } })).status).toBe(409);
    expect((await post('/api/home/observation/command', { expectedRevision: 1, idempotencyKey: 'invalid', command: { kind: 'feedback', topicId, scope: 'all', text: 'invalid' } })).status).toBe(400);
    const agreement = { topicId, trialTaskId: result.taskId, expectedTaskVersion: new TaskRepository().get(result.taskId)!.version,
      idempotencyKey: 'adopt', schedule: {kind:'interval',everyMs:86400000}, validUntil: Date.now()+86400000*30 };
    expect((await post('/api/home/routines/adopt', agreement)).status).toBe(409);
    settleTask(result.taskId);
    const adoption = await post('/api/home/routines/adopt', agreement);
    const routine = await adoption.json(); expect(adoption.status, JSON.stringify(routine)).toBe(200);
    expect((await fetch(`${base}/api/home/routines`)).status).toBe(401);
    expect((await fetch(`${base}/api/home/routines`,{headers}).then(r=>r.json())).items[0].id).toBe(routine.id);
    expect((await fetch(`${base}/api/home?locale=zh`,{headers}).then(r=>r.json())).observation.topics[0].routine.id).toBe(routine.id);
    const run = await automations.runNow(routine.automationId);
    await vi.waitFor(()=>expect(host.routines!.get(routine.id).executions).toHaveLength(1));
    settleTask(host.routines!.get(routine.id).executions[0]!.taskId);
    await vi.waitFor(async()=>expect((await automations.getRun(run.id))!.status).toBe('succeeded'));
    host.observation.collect();
    expect(host.observation.state().topics[0]!.entries.some(e=>e.kind==='execution_result')).toBe(true);
    const feedback = await post('/api/home/observation/command',{expectedRevision:host.observation.state().revision,
      idempotencyKey:'routine-feedback',command:{kind:'feedback',topicId,scope:'similar',text:'以后检查遗漏的阻塞'}});
    expect(feedback.status).toBe(200); host.routines!.refresh();
    const routineCommand = (command:unknown) => post(`/api/home/routines/${routine.id}/command`,{
      expectedRevision:host.routines!.get(routine.id).revision,idempotencyKey:randomUUID(),command});
    expect((await routineCommand({kind:'adopt_method',version:2})).status).toBe(409);
    const validation = await routineCommand({kind:'validate',version:2});
    const validating = await validation.json();expect(validation.status,JSON.stringify(validating)).toBe(200);
    settleTask(validating.methods[0].validationTaskId);
    expect((await routineCommand({kind:'adopt_method',version:2}).then(r=>r.json())).adoptedVersion).toBe(2);
    expect((await routineCommand({kind:'rollback',version:1}).then(r=>r.json())).adoptedVersion).toBe(1);
    expect((await routineCommand({kind:'pause'}).then(r=>r.json())).status).toBe('paused');

  } finally {
    host.stop(); await automations.stop(); await new Promise<void>((resolve, reject) => listener.close(e => e ? reject(e) : resolve()));
    closeXopcDatabase(); resetXopcDatabaseSingletonForTest();
  }
});
