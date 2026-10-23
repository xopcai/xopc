import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { serve } from '@hono/node-server';
import type { TurnOutcome } from '@xopcai/gateway-contract';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { seedTestDatabase } from '../../../test/sqlite-fixture.js';
import { AgentCatalogRepository } from '../../agent-catalog/repository.js';
import { createPersonalTaskTool } from '../../agent/tools/personal-task-tool.js';
import { ConfigSchema } from '../../config/schema.js';
import { createHonoApp } from '../../gateway/hono/app.js';
import type { GatewayService } from '../../gateway/service.js';
import { saveMediaBuffer } from '../../media/store.js';
import { PersonalReplyComposer, parsePersonalReplyDraft, type PersonalReplyPacket } from '../../personal-agent/reply-composer.js';
import { personalAgentId } from '../../personal-agent/repository.js';
import { personalInstructions } from '../../personal-agent/prompts.js';
import { SessionStore } from '../../session/store.js';
import { createConversation } from '../../storage/sqlite/conversation-repository.js';
import { closeXopcDatabase, openXopcDatabase, resetXopcDatabaseSingletonForTest } from '../../storage/sqlite/index.js';
import { getSqliteDatabase } from '../../storage/sqlite/transaction.js';
import { TaskApplicationService } from '../task-application-service.js';
import { TaskConversationRepository } from '../task-conversation-repository.js';
import { TaskRepository } from '../task-repository.js';
import { TaskResultDeliveryService } from '../task-result-delivery-service.js';
import { TaskRunCoordinator } from '../task-run-coordinator.js';

vi.mock('../../personal-agent/specialist-capabilities.js', () => ({
  getAvailablePersonalAgentTools: () => ['read_file'], personalAgentModelAvailability: () => ({ available: true }),
}));

/** Frozen P0 invariants; no model calls or real accounts. */
describe('personal delivery benchmark v1', () => {
  let stateDir: string;
  beforeEach(() => {
    stateDir = mkdtempSync(join(tmpdir(), 'xopc-personal-bench-'));
    vi.stubEnv('XOPC_STATE_DIR', stateDir);
    resetXopcDatabaseSingletonForTest();
    seedTestDatabase(join(stateDir, 'xopc.db'));
    openXopcDatabase({ path: join(stateDir, 'xopc.db') });
    const catalog = new AgentCatalogRepository();
    catalog.ensureInitialized();
    for (const id of [personalAgentId('local-owner'), 'worker']) {
      catalog.create({ id, models: { chat: { primary: 'test/model', fallbacks: [] } } }, { ready: true });
    }
  });
  afterEach(() => {
    vi.restoreAllMocks(); closeXopcDatabase(); resetXopcDatabaseSingletonForTest(); vi.unstubAllEnvs();
    rmSync(stateDir, { recursive: true, force: true });
  });

  function execution() {
    const main = createConversation({ agentId: personalAgentId('local-owner'), customData: { personalAgent: true } });
    const worker = createConversation({ agentId: 'worker' });
    const result = new TaskApplicationService().create({ idempotencyKey: main.key, title: '研究报告', locale: 'zh',
      originConversationId: main.key,
      contract: { objective: '给出结论及报告', expectedOutputs: ['报告'], acceptanceCriteria: ['给出来源'],
        constraints: [], assumptions: [], approvalRequired: [], risks: [], acceptancePolicy: 'manual', outputDestinations: [] },
      dependencies: [], context: [], authorityGrants: [], activation: { mode: 'start', executor: { kind: 'agent', agentId: 'worker' } } });
    if (!result.ok || !result.runId) throw new Error('Expected run');
    const runId = result.runId;
    new TaskConversationRepository().activateExecutionSession({ taskId: result.model.task.id,
      conversationId: worker.key, agentId: 'worker', runId });
    const coordinator = TaskRunCoordinator.start({ runId, fallbackObjective: '研究报告', context: {
      runId, conversationId: worker.key, agentId: 'worker', taskId: result.model.task.id,
      channel: 'webchat', origin: 'task', triggerKind: 'user' } });
    if (!coordinator) throw new Error('Expected coordinator');
    const outcome: TurnOutcome = { version: 1, outcomeId: runId, runId, turnId: runId,
      status: 'succeeded', summary: '研究结论', deliverables: [], evidence: [], createdAt: '2026-10-14T01:00:00Z' };
    return { main, runId, coordinator, outcome };
  }

  function payload(runId: string) {
    const row = getSqliteDatabase().prepare('SELECT payload_json FROM task_result_deliveries WHERE task_run_id = ?')
      .get(runId) as { payload_json: string };
    return JSON.parse(row.payload_json);
  }

  it('D04-defaults: omitted fields retain an inspectable contract on submit', async () => {
    const main = createConversation({ agentId: personalAgentId('local-owner'), customData: { personalAgent: true } });
    const tool = createPersonalTaskTool({ getCurrentConversationId: () => main.key,
      getCurrentAgentId: () => personalAgentId('local-owner'), dispatchTaskRuns: vi.fn() });
    const input = { command: 'submit', objective: '比较方案', description: '给明确模型和逐条来源。', idempotencyKey: 'frozen-submit' };
    await tool.execute('submit', input);
    await tool.execute('retry', input);
    const tasks = new TaskRepository().list();
    expect(tasks).toHaveLength(1);
    expect(tasks[0]!.contract!.expectedOutputs).toEqual(['比较方案']);
    expect(tasks[0]!.contract!.acceptanceCriteria.length).toBeGreaterThan(0);
    expect(tasks[0]!.body).toContain(input.description);
  });

  it('D04-explicit: explicit acceptance criteria survive submission', async () => {
    const main = createConversation({ agentId: personalAgentId('local-owner'), customData: { personalAgent: true } });
    const tool = createPersonalTaskTool({ getCurrentConversationId: () => main.key,
      getCurrentAgentId: () => personalAgentId('local-owner'), dispatchTaskRuns: vi.fn() });
    await tool.execute('submit', { command: 'submit', objective: '比较方案', description: '给明确模型和逐条来源。',
      expectedOutputs: ['report.md'], acceptanceCriteria: ['结论逐条引用来源'], constraints: ['不编造报价'] });
    expect(new TaskRepository().list()[0]!.contract).toMatchObject({ expectedOutputs: ['report.md'],
      acceptanceCriteria: ['结论逐条引用来源'], constraints: ['不编造报价'] });
  });

  it('B01-partial: partial research stays partial after delivery and composition', async () => {
    const { main, runId, coordinator, outcome } = execution();
    coordinator.captureOutcome({ ...outcome, status: 'partial' });
    coordinator.finalize({ status: 'succeeded', summary: '缺报价依据', assistantText: '模型适配已确认，报价仍待核实。' });
    expect(payload(runId).outcome.status).toBe('partial');
    await new TaskResultDeliveryService().drain(vi.fn());
    await new PersonalReplyComposer(async () => '模型适配已确认，报价仍待核实。').drain(vi.fn());
    const messages = (await new SessionStore(stateDir).getMessagePage(main.key, { includeContextRows: true }))!.session.messages;
    expect(messages.at(-1)!.content).toContain('只完成了部分');
    expect(messages.at(-1)!.content).toContain('报价仍待核实');
  });

  it('B01-failed: a failed outcome cannot become success from run completion', () => {
    const { runId, coordinator, outcome } = execution();
    coordinator.captureOutcome({ ...outcome, status: 'failed' });
    coordinator.finalize({ status: 'succeeded', summary: '未取得依据', assistantText: '未取得可核实资料。' });
    expect(payload(runId).outcome.status).toBe('failed');
  });

  it('S02-reference: rejects an invented host download link', () => {
    const packet = { report: '结论未附文件。' } as PersonalReplyPacket;
    expect(() => parsePersonalReplyDraft('[报告](/Users/worker/report.md)', packet))
      .toThrow(/file reference/);
  });

  it('S02-fallback: worker paths do not reappear in fallback or claim full delivery', async () => {
    const { main, runId, coordinator, outcome } = execution();
    coordinator.captureOutcome(outcome);
    coordinator.finalize({ status: 'succeeded', summary: '结论可用',
      assistantText: '部分报价仍未核实。\n\nMEDIA:/Users/worker/report.md\n[报告](/Users/worker/report.md)' });
    await new TaskResultDeliveryService().drain(vi.fn());
    await new PersonalReplyComposer(async () => { throw new Error('Fixed composer outage'); }).drain(vi.fn());
    const messages = (await new SessionStore(stateDir).getMessagePage(main.key, { includeContextRows: true }))!.session.messages;
    const text = messages.at(-1)!.content;
    expect(text).toContain('部分报价仍未核实');
    expect(text).not.toContain('MEDIA:');
    expect(text).not.toContain('/Users/worker');
    expect(payload(runId).outcome.status).toBe('partial');
  });

  it('F02-download: a published report is readable only through its authenticated original chat', async () => {
    const { main, runId, coordinator, outcome } = execution();
    const content = '# 结论\n\n月销售额：150、210；环比：40%。\n';
    const file = await saveMediaBuffer(Buffer.from(content), { bucket: 'outbound', contentType: 'text/markdown' });
    outcome.deliverables = [{ artifactId: file.id, title: 'report.md', kind: 'document',
      availability: 'available', location: 'artifact_store', uri: file.uri, capabilities: ['preview', 'download'] }];
    coordinator.captureOutcome(outcome);
    coordinator.finalize({ status: 'succeeded', summary: '月销售额已计算', assistantText: '销售额从150增至210，环比40%。' });
    await new TaskResultDeliveryService().drain(vi.fn());
    const store = new SessionStore(stateDir);
    const token = 'frozen-benchmark-token';
    const app = createHonoApp({ service: { currentConfig: ConfigSchema.parse({ gateway: { auth: { mode: 'token', token } } }),
      getResolvedAuth: () => ({ mode: 'token', token }), getAuthToken: () => token, isGatewayReady: () => true,
      getExtensionLoader: () => null, sessionIndexInstance: store,
      sessions: { getMessagePage: store.getMessagePage.bind(store), getSession: store.get.bind(store) },
    } as unknown as GatewayService });
    const server = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: 0 });
    try {
      if (!server.listening) await once(server, 'listening');
      const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
      const query = `/api/media/read?uri=${encodeURIComponent(file.uri)}&conversationId=`;
      const headers = { Authorization: `Bearer ${token}` };
      expect((await fetch(base + query + main.key)).status).toBe(401);
      const response = await fetch(base + query + main.key, { headers });
      expect(response.status).toBe(200);
      expect(await response.text()).toBe(content);
      const other = createConversation({ agentId: 'other' });
      expect((await fetch(base + query + other.key, { headers })).status).toBe(404);
      const history = await fetch(`${base}/api/sessions/${main.key}/history?view=compact`, { headers });
      expect(history.status).toBe(200);
      expect(JSON.stringify(await history.json())).toContain(file.uri);
      expect(payload(runId).outcome.status).toBe('succeeded');
    } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
  });

  it('H03-policy: concise default and artifact fallback preserve explicit detail requests', async () => {
    const instructions = personalInstructions();
    expect(instructions).toContain('Be concise by default');
    expect(instructions).toContain('answer narrow follow-ups narrowly');
    expect(instructions).toContain('Requests for detail, exact text, code, tables, reports, or complete lists take precedence');
    expect(instructions).toContain('keep required facts and uncertainty');
    const { main, coordinator, outcome } = execution();
    const file = await saveMediaBuffer(Buffer.from('# 完整报告'), { bucket: 'outbound', contentType: 'text/markdown' });
    outcome.deliverables = [{ artifactId: file.id, title: 'report.md', kind: 'document', availability: 'available',
      location: 'artifact_store', uri: file.uri, capabilities: ['download'] }];
    coordinator.captureOutcome(outcome);
    coordinator.finalize({ status: 'succeeded', summary: '结果可用', assistantText: '完整报告内容。'.repeat(3000) });
    await new TaskResultDeliveryService().drain(vi.fn());
    await new PersonalReplyComposer(async () => { throw new Error('Fixed format failure'); }).drain(vi.fn());
    const text = (await new SessionStore(stateDir).getMessagePage(main.key, { includeContextRows: true }))!.session.messages.at(-1)!.content;
    expect(text.length).toBeLessThan(100);
    expect(text).toContain('完整结果与限制');
    expect(text).not.toContain('完整报告内容');
  });
});
