import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { serve } from '@hono/node-server';

assert.equal(process.env.XOPC_TASK_ROUTING_LIVE, '1', 'Enable real model usage with XOPC_TASK_ROUTING_LIVE=1');
const source = process.env.XOPC_STATE_DIR ?? join(homedir(), '.xopc');
const config = JSON.parse(readFileSync(process.env.XOPC_CONFIG_PATH ?? join(source, 'xopc.json'), 'utf8'));
const model = 'qwen-token-plan-cn/qwen3.8-flash';
const root = mkdtempSync(join(tmpdir(), 'xopc-task-routing-'));
const token = randomUUID();
const configPath = join(root, 'xopc.json');
const credentials = process.env.XOPC_CREDENTIALS_DIR ?? join(source, 'credentials');
Object.assign(process.env, {
  XOPC_STATE_DIR: root, XOPC_CONFIG: configPath, XOPC_CONFIG_PATH: configPath,
  XOPC_WORKSPACE: join(root, 'workspace'), XOPC_CREDENTIALS_DIR: credentials,
  XOPC_LOG_DIR: join(root, 'logs'), XOPC_LOG_LEVEL: 'error',
});
writeFileSync(configPath, JSON.stringify({
  providers: config.providers,
  gateway: { auth: { mode: 'token', token }, tailscale: { mode: 'off' } },
  userContext: { enabled: false },
}), { mode: 0o600 });
const modelCache = join(source, 'cache/model-catalog');
if (existsSync(modelCache)) cpSync(modelCache, join(root, 'cache/model-catalog'), { recursive: true });
const { openXopcDatabase, closeXopcDatabase, getSqliteDatabase, setSessionConfig } = await import('../src/storage/sqlite/index.js');
const { seedTestAgentCatalog } = await import('../src/agent-catalog/test-support.js');
const { createConversation } = await import('../src/storage/sqlite/conversation-repository.js');
const { personalAgentId, personalConversationId } = await import('../src/personal-agent/repository.js');
const { GatewayService } = await import('../src/gateway/service.js');
const { createHonoApp } = await import('../src/gateway/hono/app.js');
const { TaskOriginRepository } = await import('../src/tasks/task-origin-repository.js');
const { TaskCollaborationRepository } = await import('../src/tasks/task-collaboration-repository.js');
const { TaskRunRepository } = await import('../src/tasks/task-run-repository.js');
const { getTaskHandoff } = await import('../src/tasks/task-handoff.js');
const { loadTranscriptRowsForSession } = await import('../src/storage/sqlite/transcript-repository.js');

const agentId = personalAgentId('local-owner');
const conversationId = personalConversationId('local-owner');
const workerId = 'routing-worker';
const workspace = join(root, 'workspace');
mkdirSync(workspace, { recursive: true });
openXopcDatabase({ path: join(root, 'xopc.db') });
seedTestAgentCatalog({ defaults: { models: { chat: { primary: model, fallbacks: [] },
  background: { primary: model, fallbacks: [] } } }, agents: [
  { id: agentId, workspace, profile: { name: 'Personal' } },
  { id: workerId, workspace, profile: { name: workerId } },
] });
createConversation({ agentId, sourceChannel: 'webchat', name: 'Task routing smoke',
  customData: { personalAgent: true } }, workspace, conversationId);
setSessionConfig(conversationId, { modelOverride: model, fixedModel: true, thinkingLevel: 'medium' }, workspace);

const service = new GatewayService({ configPath, enableHotReload: false, listenPort: 0 });
const db = getSqliteDatabase();
const board = new TaskCollaborationRepository();
const runs = new TaskRunRepository();
const origins = new TaskOriginRepository();
let server: ReturnType<typeof serve> | undefined;
let state: (() => unknown) | undefined;
try {
  await service.start();
  server = serve({ fetch: createHonoApp({ service }).fetch, hostname: '127.0.0.1', port: 0 });
  if (!server.listening) await once(server, 'listening');
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  async function eventually<T>(label: string, check: () => T | undefined): Promise<T> {
    const end = Date.now() + 90_000;
    while (Date.now() < end) {
      const value = check();
      if (value !== undefined) return value;
      await sleep(250);
    }
    throw new Error(`Timed out waiting for ${label}`);
  }
  let sequence = 0;
  async function append(content: string) {
    const clientMessageId = `routing-smoke-${++sequence}`;
    const session = db.prepare('SELECT active_transcript_id FROM sessions WHERE conversation_id = ?').get(conversationId);
    const configRow = db.prepare('SELECT updated_at FROM session_config WHERE conversation_id = ?').get(conversationId);
    const response = await fetch(`${base}/api/sessions/${conversationId}/inputs`, {
      method: 'POST', headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ kind: 'append', clientMessageId, expectedTranscriptId: session?.active_transcript_id,
        configVersion: configRow?.updated_at, delivery: 'next', interrupt: false, input: { content }, origin: { type: 'system', source: 'cli' } }),
      signal: AbortSignal.timeout(15_000),
    });
    assert.ok(response.ok, `Input rejected: ${response.status} ${await response.text()}`);
    return clientMessageId;
  }
  async function waitForInput(id: string) {
    await eventually(id, () => {
      const row = db.prepare('SELECT status, error FROM session_inputs WHERE conversation_id = ? AND client_message_id = ?').get(conversationId, id);
      if (row?.status === 'failed' || row?.status === 'cancelled') throw new Error(`${id} ended as ${row.status}: ${row.error}`);
      return row?.status === 'completed' ? true : undefined;
    });
  }
  const tasks = () => origins.list(conversationId).items;
  state = () => tasks().map(({ id, title }) => ({
    id, title, runs: runs.listByTask(id).map(({ id, status, startedAt }) => ({ id, status, started: Boolean(startedAt) })),
    instructions: board.coordination(id).filter(entry => entry.kind === 'instruction').map(({ body, deliveryStatus }) => ({ body, deliveryStatus })),
  }));
  for (const [name, task] of [
    ['华东预算报告', '整理华东预算报告，给出三条面向财务团队的合成数据检查建议。'],
    ['华南预算报告', '整理华南预算报告，给出三条面向采购团队的合成数据检查建议。'],
    ['客服排班说明', '整理客服排班说明，给出三条面向客服主管的交接建议。'],
  ]) {
    const input = await append(`请派给 routing-worker：${task} 这是隔离演练，只需纯文本。执行者先在任务协作板询问“${name}的验收口令是什么？”并暂停；口令由我后续提供。请立即派发并继续接收我的消息。`);
    await waitForInput(input);
  }
  assert.equal(tasks().length, 3, JSON.stringify(state()));
  const taskFor = (name: string) => {
    const found = tasks().filter(({ id }) => getTaskHandoff(id)?.originalRequest?.includes(name));
    assert.equal(found.length, 1, JSON.stringify(state()));
    return found[0].id;
  };
  const east = taskFor('华东预算报告');
  const south = taskFor('华南预算报告');
  const support = taskFor('客服排班说明');
  const question = (id: string) => board.coordination(id).find(entry => entry.kind === 'question');
  await eventually('three workers to ask for their own passphrase', () =>
    [east, south, support].every(id => runs.listByTask(id).some(run => run.startedAt) && question(id)) ? true : undefined);
  console.log(JSON.stringify({ stage: 'workers-started', tasks: state() }));

  const ambiguous = await append('给预算报告加一条验收要求：保留原始单位。先别改客服排班。');
  await waitForInput(ambiguous);
  assert.equal([east, south, support].flatMap(id => board.coordination(id)).filter(entry => entry.kind === 'instruction').length, 0, JSON.stringify(state()));

  const ambiguousTurn = db.prepare('SELECT run_id FROM session_inputs WHERE conversation_id = ? AND client_message_id = ?')
    .get(conversationId, ambiguous)?.run_id;
  const clarification = loadTranscriptRowsForSession(conversationId).flatMap(row =>
    'role' in row && row.role === 'assistant' && 'turnId' in row && row.turnId === ambiguousTurn
      ? row.content.flatMap(part => part.type === 'text' ? [part.text] : []) : []).join('\n');
  assert.match(clarification, /华东/);
  assert.match(clarification, /华南/);
  assert.match(clarification, /[？?]|哪[一份个]|请确认/);
  console.log(JSON.stringify({ stage: 'clarified', clarification }));

  const precise = await append('是华东预算报告。在这个已有任务里加一条：保留原始单位，并逐项注明口径，标记 EAST-UNIT-17。华南预算报告照原计划。');
  await waitForInput(precise);
  const targeted = (id: string, marker: string) => board.coordination(id).filter(entry => entry.kind === 'instruction' && entry.body.includes(marker));
  assert.equal(targeted(east, 'EAST-UNIT-17').length, 1, JSON.stringify(state()));
  assert.equal(targeted(south, 'EAST-UNIT-17').length + targeted(support, 'EAST-UNIT-17').length, 0, JSON.stringify(state()));

  const second = await append('再给华南那份加一条：在结尾列出采购风险，标记 SOUTH-RISK-23。');
  await waitForInput(second);
  assert.equal(targeted(south, 'SOUTH-RISK-23').length, 1, JSON.stringify(state()));
  assert.equal(targeted(east, 'SOUTH-RISK-23').length + targeted(support, 'SOUTH-RISK-23').length, 0, JSON.stringify(state()));
  assert.equal(tasks().length, 3, JSON.stringify(state()));
  for (const [name, id, passphrase, marker] of [
    ['华东预算报告', east, 'PASS-EAST-35', 'EAST-UNIT-17'],
    ['华南预算报告', south, 'PASS-SOUTH-42', 'SOUTH-RISK-23'],
  ]) {
    const input = await append(`回答${name}执行者的问题：验收口令是 ${passphrase}。请把这个答案发给该任务的执行者。`);
    await waitForInput(input);
    const answer = board.coordination(id).find(entry => entry.kind === 'answer'
      && entry.causationId === question(id)?.id && entry.body.includes(passphrase));
    assert.ok(answer, JSON.stringify(state()));
    await eventually(`${name} worker acknowledgment`, () =>
      targeted(id, marker)[0]?.deliveryStatus === 'confirmed' ? true : undefined);
  }
  for (const id of [east, south, support]) assert.equal(runs.listByTask(id).length, 1, JSON.stringify(state()));
  console.log(JSON.stringify({ stage: 'passed', model, tasks: state() }));
} catch (error) {
  const rows = loadTranscriptRowsForSession(conversationId);
  console.error(JSON.stringify({ stage: 'failed', model, tasks: state?.(), recent: rows.slice(-18) }));
  console.error(error);
  process.exitCode = 1;
} finally {
  if (server) {
    const closed = once(server, 'close');
    server.close();
    server.closeAllConnections();
    await closed;
  }
  await service.stop();
  closeXopcDatabase();
  rmSync(root, { force: true, recursive: true });
}
process.exit(process.exitCode ?? 0);
