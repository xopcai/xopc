/** Real-model reply composition against two synthetic completed Tasks in one isolated chat. */
import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

assert.equal(process.env.XOPC_PERSONAL_REPLIES_LIVE, '1', 'Explicit real-model authorization is required');
const sourceRoot = process.env.XOPC_STATE_DIR ?? join(homedir(), '.xopc');
const source = new DatabaseSync(join(sourceRoot, 'xopc.db'), { readOnly: true });
const settings = source.prepare('SELECT defaults_json FROM agent_catalog_settings WHERE singleton_id = 1').get();
const selected = source.prepare(`SELECT config.model_override, agent.overrides_json
  FROM sessions session JOIN agents agent ON agent.id = session.agent_id
  LEFT JOIN session_config config ON config.conversation_id = session.conversation_id
  WHERE json_extract(session.custom_data_json, '$.personalAgent') = 1 LIMIT 1`).get();
source.close();
assert.ok(settings && selected, 'A configured Personal Agent is required');
const defaults = JSON.parse(String(settings.defaults_json));
const overrides = JSON.parse(String(selected.overrides_json));
const model = overrides.models?.chat?.primary ?? selected.model_override ?? defaults.models.chat.primary;
assert.equal(typeof model, 'string');

const root = mkdtempSync(join(tmpdir(), 'xopc-task-replies-live-'));
const sourceCatalog = join(sourceRoot, 'cache/model-catalog');
if (existsSync(sourceCatalog)) cpSync(sourceCatalog, join(root, 'cache/model-catalog'), { recursive: true });
const configPath = process.env.XOPC_CONFIG_PATH ?? join(sourceRoot, 'xopc.json');
process.env.XOPC_STATE_DIR = root;
process.env.XOPC_CONFIG_PATH = configPath;
process.env.XOPC_CONFIG = configPath;
process.env.XOPC_CREDENTIALS_DIR ??= join(sourceRoot, 'credentials');
process.env.XOPC_LOG_LEVEL = 'error';

const { AgentCatalogRepository } = await import('../src/agent-catalog/repository.js');
const { createConversation } = await import('../src/storage/sqlite/conversation-repository.js');
const { openXopcDatabase, closeXopcDatabase, getSqliteDatabase } = await import('../src/storage/sqlite/index.js');
const { appendTranscriptEntry } = await import('../src/storage/sqlite/transcript-repository.js');
const { personalAgentId } = await import('../src/personal-agent/repository.js');
const { personalPerformanceSnapshot } = await import('../src/personal-agent/performance.js');
const { PersonalReplyComposer } = await import('../src/personal-agent/reply-composer.js');
const { TaskApplicationService } = await import('../src/tasks/task-application-service.js');
const { TaskConversationRepository } = await import('../src/tasks/task-conversation-repository.js');
const { TaskRunCoordinator } = await import('../src/tasks/task-run-coordinator.js');
const { TaskResultDeliveryService } = await import('../src/tasks/task-result-delivery-service.js');

try {
  openXopcDatabase({ path: join(root, 'xopc.db') });
  const catalog = new AgentCatalogRepository();
  catalog.ensureInitialized(defaults);
  const agentId = personalAgentId('local-owner');
  catalog.create({ id: agentId, models: { chat: { primary: model, fallbacks: [] } }, profile: { name: 'Personal' } }, { ready: true });
  const chat = createConversation({ agentId, sourceChannel: 'webchat', customData: { personalAgent: true } });
  for (const text of ['帮我确认图书库存和展览报名数，两件事分别回，简单一点。',
    '图书库存按刚才更新的口径，只算国内库存。', '先聊别的，活动海报我明天自己看。']) {
    appendTranscriptEntry(chat.key, { role: 'user', content: text, timestamp: Date.now() });
  }

  const cases = [
    { title: '图书库存', objective: '确认国内图书库存。', report: '按更新后的口径，国内图书库存确认是 47 本。原统计包含境外仓库，这次已排除。核对过程分为三个阶段。第一阶段整理仓库清单，对仓库名称做标准化。第二阶段按地区筛选，并逐条检查重复入库记录。第三阶段比较各仓库导出的表格，确认合计与原始记录相符。清单采用库存记录中的最近一个快照。处理期间对日期格式、空白单元格和重复标识做了整理。以上是内部处理过程。', partial: false,
      expected: [/国内/u, /47/u], forbidden: /26|展览报名/u },
    { title: '展览报名', objective: '确认展览报名总数。', report: '第一个数据源确认 26 人报名。第二个数据源暂不可用，报名总数还不能确认。', partial: true,
      expected: [/26/u, /数据源|渠道/u, /无法|不能|未|没|暂/u], forbidden: /47|图书库存/u },
  ];
  for (const fixture of cases) {
    const created = new TaskApplicationService().create({ idempotencyKey: fixture.title, title: fixture.title, locale: 'zh',
      originConversationId: chat.key, contract: { objective: fixture.objective, expectedOutputs: [],
        acceptanceCriteria: [], constraints: [], assumptions: [], risks: [], approvalRequired: [],
        acceptancePolicy: 'manual', outputDestinations: [] },
      priority: 'normal', dependencies: [], context: [], authorityGrants: [],
      activation: { mode: 'start', executor: { kind: 'agent', agentId: 'main' } } });
    assert.ok(created.ok && created.runId);
    const taskId = created.model.task.id;
    const runId = created.runId;
    const execution = createConversation({ agentId: 'main' });
    new TaskConversationRepository().activateExecutionSession({ taskId, runId, conversationId: execution.key, agentId: 'main' });
    const coordinator = TaskRunCoordinator.start({ runId, fallbackObjective: fixture.objective,
      context: { runId, taskId, conversationId: execution.key, agentId: 'main', channel: 'webchat', origin: 'task', triggerKind: 'user' } });
    assert.ok(coordinator);
    coordinator.captureOutcome({ version: 1, outcomeId: runId, turnId: runId, runId, status: fixture.partial ? 'partial' : 'succeeded',
      summary: fixture.report, deliverables: [], evidence: [], createdAt: new Date().toISOString() });
    coordinator.finalize({ status: 'succeeded', summary: fixture.report, assistantText: fixture.report });
  }

  await new TaskResultDeliveryService().drain(() => {});
  const composer = new PersonalReplyComposer();
  for (const _fixture of cases) await composer.drain(() => {});
  const db = getSqliteDatabase();
  const rows = db.prepare(`SELECT task.title, delivery.reply_text, delivery.reply_status
    FROM task_result_deliveries delivery JOIN task_runs run ON run.run_id = delivery.task_run_id
    JOIN tasks task ON task.task_id = run.task_id ORDER BY task.title`).all();
  const calls = Number(db.prepare("SELECT count(*) AS n FROM ai_usage_events WHERE operation = 'personal.reply_composition' AND status = 'succeeded'").get()?.n);
  const busyFallbacks = personalPerformanceSnapshot().filter(item => item.phase === 'busy_fallback').length;
  const results = cases.map(fixture => {
    const row = rows.find(item => item.title === fixture.title);
    const text = typeof row?.reply_text === 'string' ? row.reply_text : '';
    return { task: fixture.title, delivered: row?.reply_status === 'delivered', text, characters: Array.from(text).length, sourceCharacters: Array.from(fixture.report).length,
      preservesFacts: fixture.expected.every(pattern => pattern.test(text)), mixesTasks: fixture.forbidden.test(text) };
  });
  console.log(JSON.stringify({ model, calls, busyFallbacks, results }, null, 2));
  assert.ok(calls > 0 && calls + busyFallbacks >= cases.length, 'Expected real composition or the durable delivery deadline for both results');
  assert.ok(results.every(item => item.delivered && item.preservesFacts && !item.mixesTasks && item.characters <= 120
    && !/Partial result|Incomplete result/u.test(item.text)));
  assert.ok(results[0].characters < results[0].sourceCharacters, 'The longer worker report must be condensed');
} finally {
  closeXopcDatabase();
  rmSync(root, { recursive: true, force: true });
}
