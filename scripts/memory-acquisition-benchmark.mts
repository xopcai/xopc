/** Real-model acquisition ablation through the persisted worker. All sources and receipts are synthetic. */
import assert from 'node:assert/strict';
import { channel } from 'node:diagnostics_channel';
import { createHash, randomUUID } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { homedir, tmpdir } from 'node:os';

assert.equal(process.env.XOPC_MEMORY_LIVE, '1', 'Set XOPC_MEMORY_LIVE=1 for real configured model calls');
const sourceRoot = process.env.XOPC_STATE_DIR ?? join(homedir(), '.xopc');
const directory = mkdtempSync(join(tmpdir(), 'xopc-acquisition-benchmark-'));
process.once('exit', () => rmSync(directory, { recursive: true, force: true }));
for (const name of ['models.json', 'cache/model-catalog']) if (existsSync(join(sourceRoot, name))) {
  cpSync(join(sourceRoot, name), join(directory, name), { recursive: true });
}
process.env.XOPC_CREDENTIALS_DIR ??= join(sourceRoot, 'credentials');
process.env.XOPC_STATE_DIR = directory;
process.env.XOPC_CONFIG_PATH = join(directory, 'xopc.json');
process.env.XOPC_CONFIG = process.env.XOPC_CONFIG_PATH;
process.env.XOPC_LOG_DIR = join(directory, 'logs');
process.env.XOPC_LOG_LEVEL = 'fatal';
writeFileSync(process.env.XOPC_CONFIG_PATH, '{}', { mode: 0o600 });
const modelRef = process.env.XOPC_MEMORY_LIVE_MODEL ?? 'qwen-token-plan-cn/qwen3.8-max';
const reportPath = resolve(process.env.XOPC_MEMORY_REPORT ?? 'reports/memory/acquisition-benchmark.json');
mkdirSync(dirname(reportPath), { recursive: true });
const { Agent } = await import('@earendil-works/pi-agent-core');
const { ConfigSchema } = await import('../src/config/schema.js');
const { AgentDefaultsSchema } = await import('../src/agent-config/schema.js');
const { seedTestAgentCatalog } = await import('../src/agent-catalog/test-support.js');
const { openXopcDatabase, closeXopcDatabase, getSqliteDatabase, upsertKnowledgeSourceItems } = await import('../src/storage/sqlite/index.js');
const { ensureSessionRecord } = await import('../src/storage/sqlite/session-repository.js');
const { appendTranscriptEntry } = await import('../src/storage/sqlite/transcript-repository.js');
const { claimLearningJob, enqueueConversationLearning } = await import('../src/memory-learning/repository.js');
const { runPersistentLearningJob } = await import('../src/agent/background-review/run-background-review.js');
const { listUserAssertions } = await import('../src/user-model/repository.js');
const { getAssertionSlot } = await import('../src/user-model/repository.js');
const { listKnowledgeItems, canUseKnowledge } = await import('../src/knowledge-memory/index.js');
const { buildExecutionContext } = await import('../src/agent/context/execution-context.js');
const { TaskRepository } = await import('../src/tasks/task-repository.js');
const { TaskRunRepository } = await import('../src/tasks/task-run-repository.js');
const { learnTaskReceipts } = await import('../src/memory-learning/task-receipts.js');
const { ConnectedKnowledgePipeline } = await import('../src/knowledge/connected-knowledge-pipeline.js');
const { upsertUnderstandingSourceGrant } = await import('../src/user-context/sources/repository.js');
const { grantUnderstandingConsent, revokeUnderstandingConsent } = await import('../src/user-context/sources/consent-repository.js');
const { recoverSourceLearning, runSourceLearning } = await import('../src/memory-learning/source-learning.js');
const casesPath = resolve('evals/memory/acquisition-cases.json');
const cases = JSON.parse(readFileSync(casesPath, 'utf8')) as Array<{ id: string; turns: string[]; otherWorkspace?: boolean; expectedPattern: boolean; semanticTerms?: string[][] }>;
const files = ['src/memory-learning/choice-observations.ts', 'src/memory-learning/evidence-repair.ts', 'src/memory-learning/task-receipts.ts',
  'src/memory-learning/repository.ts', 'src/memory-learning/transcript-source.ts', 'src/memory-learning/source-learning.ts',
  'src/agent/background-review/run-background-review.ts', 'src/agent/background-review/prompts.ts',
  'src/user-model/capture/semantic.ts', 'src/user-model/capture/executor.ts', 'src/user-model/capture/evidence-policy.ts',
  'scripts/memory-acquisition-benchmark.mts', casesPath];
const fingerprint = () => createHash('sha256').update(files.map(f => readFileSync(f)).join('\n')).digest('hex');
const initialFingerprint = fingerprint();
const results: Array<Record<string, unknown>> = [];
const modelReplies: unknown[] = [];
const usage: unknown[] = [];
const diagnostics = channel('xopc.memory.interpretation');
const observer = (message: unknown) => modelReplies.push(message);
diagnostics.subscribe(observer);
let forceFault = false;
let faultInjected = false;
const originalPrompt = Agent.prototype.prompt;
// A declared synthetic fault tests the actual host repair path, not the model's natural error frequency.
const faultingPrompt = async function(this: InstanceType<typeof Agent>, ...args: unknown[]) {
  const result = await Reflect.apply(originalPrompt, this, args);
  if (forceFault && !faultInjected) {
    const message = this.state.messages.findLast(m => m.role === 'assistant');
    if (message?.role === 'assistant') {
      const part = message.content.find(p => p.type === 'text');
      if (part?.type === 'text') {
        try {
          const value = JSON.parse(part.text.replace(/^```(?:json)?\s*/u, '').replace(/\s*```$/u, ''));
          if (value.knowledge?.[0]?.evidence?.length) {
            value.knowledge[0].evidence[0].ref = 'source_999'; part.text = JSON.stringify(value); faultInjected = true;
          }
        } catch { /* Preserve malformed model responses for the production parser. */ }
      }
    }
  }
  return result;
};
Agent.prototype.prompt = faultingPrompt as typeof originalPrompt;
const configFor = (enabled: boolean) => ConfigSchema.parse({ userContext: { userModel: { extraction: { crossSessionObservations: enabled } } } });
let config = configFor(true);
let activeLabel = '';
let activePath = '';
function open(label: string) {
  activeLabel = label; activePath = join(directory, `${label}.db`);
  openXopcDatabase({ path: activePath });
  seedTestAgentCatalog({ defaults: AgentDefaultsSchema.parse({ models: { chat: { primary: modelRef }, intents: { understanding: { primary: modelRef } } } }) });
}
function close() {
  usage.push(...getSqliteDatabase().prepare(`SELECT operation,provider,model,status,duration_ms,input_tokens,output_tokens,cache_read_tokens,total_tokens,estimated_cost_microusd
    FROM ai_usage_events ORDER BY started_at`).all().map(row => ({ case: activeLabel, ...row })));
  closeXopcDatabase();
}
function session(workspace: string) {
  mkdirSync(workspace, { recursive: true }); const id = randomUUID();
  ensureSessionRecord(id, workspace, { agentId: 'main', sourceChannel: 'webchat', sessionType: 'chat' }); return id;
}
async function learn(id: string, text: string, workspace: string) {
  const row = appendTranscriptEntry(id, { role: 'user', content: text, timestamp: Date.now() });
  appendTranscriptEntry(id, { role: 'assistant', content: '收到。', timestamp: Date.now() } as never);
  enqueueConversationLearning(config, id, workspace, true);
  const job = claimLearningJob(); assert(job);
  await runPersistentLearningJob(job, () => config);
  assert.equal(getSqliteDatabase().prepare('SELECT state FROM memory_learning_jobs WHERE job_id=?').get(job.job_id)!.state, 'succeeded');
  return row;
}
function save() { writeFileSync(reportPath, JSON.stringify({ model: modelRef, results, modelReplies, usage }, null, 2)); }
try {
  for (const fixture of cases) for (const enabled of [false, true]) {
    config = configFor(enabled); open(`${fixture.id}-${enabled ? 'carry' : 'baseline'}`);
    const workspace = join(directory, 'workspace'); const first = session(workspace);
    const firstRow = await learn(first, fixture.turns[0], workspace);
    const assertionsAfterFirst = listUserAssertions().length;
    assert.equal(assertionsAfterFirst, 0, 'One local choice must not create a personal assertion');
    // Reload the persisted observation and cursor from disk before the second conversation.
    closeXopcDatabase(); openXopcDatabase({ path: activePath });
    const secondWorkspace = fixture.otherWorkspace ? join(directory, 'other-workspace') : workspace;
    const second = session(secondWorkspace); const secondRow = await learn(second, fixture.turns[1], secondWorkspace);
    const assertions = listUserAssertions();
    const pattern = assertions.find(a => ['user_observed', 'system_inferred'].includes(a.authority)
      && ['preference', 'routine'].includes(a.kind) && (fixture.semanticTerms ?? [['标题','heading','title'],['短','short','brief','concise']]).every(group => group.some(term => a.statement.toLowerCase().includes(term.toLowerCase()))));
    const slot = pattern && getAssertionSlot(pattern.slotId);
    const links = pattern ? getSqliteDatabase().prepare(`SELECT conversation_id,message_id FROM context_evidence WHERE evidence_id IN (
      SELECT evidence_id FROM user_assertion_evidence WHERE assertion_id=?)`).all(pattern.id) : [];
    const context = buildExecutionContext({ conversationId: session(secondWorkspace), agentId: 'main', workspaceId: secondWorkspace, query: 'Explain the result.' });
    const usable = Boolean(pattern && context.assertions.some(a => a.assertion.id === pattern.id));
    const expected = enabled && fixture.expectedPattern;
    const lineage = links.some(l => l.conversation_id === first && l.message_id === firstRow.entry_id)
      && links.some(l => l.conversation_id === second && l.message_id === secondRow.entry_id);
    const workMemories = listKnowledgeItems({ recordClass: 'memory' });
    const pass = expected ? Boolean(pattern && slot?.scope.type === 'workspace' && slot.scope.id === workspace && usable && lineage)
      : assertions.length === 0 && (fixture.id !== 'quoted-choice' || workMemories.length === 0);
    results.push({ id: fixture.id, arm: enabled ? 'carry' : 'baseline', pass, expectedPattern: expected,
      assertionsAfterFirst, assertions: assertions.map(a => ({ statement: a.statement, kind: a.kind, authority: a.authority, scope: getAssertionSlot(a.slotId)?.scope })), pattern: pattern ? { statement: pattern.statement, authority: pattern.authority, scope: slot?.scope } : undefined,
      usable, lineage, links, workMemories: workMemories.map(item => ({ kind: item.kind, status: item.status, content: item.content })) }); close(); save(); console.log(JSON.stringify(results.at(-1)));
  }
  config = configFor(true); open('candidate-evidence-repair'); forceFault = true; faultInjected = false;
  const workspace = join(directory, 'workspace'); const id = session(workspace);
  await learn(id, 'Atlas uses SQLite because deployment must stay local. Atlas cache size is 64 MB.', workspace);
  forceFault = false;
  const facts = listKnowledgeItems({ recordClass: 'memory' });
  const repairCalls = Number(getSqliteDatabase().prepare("SELECT count(*) n FROM ai_usage_events WHERE operation='user_model.interpret'").get()!.n);
  results.push({ id: 'candidate-evidence-repair', pass: faultInjected && repairCalls === 2 && facts.some(f => /SQLite/iu.test(f.content))
    && facts.some(f => /64/iu.test(f.content)), faultInjected, modelCalls: repairCalls, facts: facts.map(f => f.content) });
  close(); save();

  config = configFor(true); open('receipt-backfill'); const owner = session(join(directory, 'workspace'));
  getSqliteDatabase().prepare("UPDATE sessions SET routing_json='{}' WHERE conversation_id=?").run(owner);
  for (let n = 0; n < 26; n++) {
    const task = new TaskRepository().create({ title: `Synthetic Atlas task ${n}`, objective: 'Test memory acquisition' });
    const repository = new TaskRunRepository();
    const run = repository.create({ taskId: task.id, executorKind: 'agent', executorRef: { agentId: 'main' }, trigger: {}, correlationId: 'benchmark',
      idempotencyKey: `receipt-${n}`, contractVersion: 1 });
    getSqliteDatabase().prepare('INSERT INTO task_origin_links(task_id,conversation_id,created_at) VALUES(?,?,?)').run(task.id, owner, Date.now());
    repository.finalize({ runId: run.id, expectedVersion: run.version, receipt: { status: n < 8 ? 'failed' : 'succeeded',
      completionVerdict: n < 8 ? 'not_achieved' : n < 13 ? 'partial' : 'achieved', summary: 'Synthetic reported task outcome.',
      changes: [], evidence: [], verification: { status: 'unverified', checks: [] }, remainingWork: ['Review the result'], needsUser: false } });
  }
  const oldEligible = Number(getSqliteDatabase().prepare("SELECT count(*) n FROM task_origin_links l JOIN sessions s USING(conversation_id) WHERE json_extract(s.routing_json,'$.peerKind')='direct'").get()!.n);
  const learned = learnTaskReceipts(config, () => workspace); const replay = learnTaskReceipts(config, () => workspace);
  results.push({ id: 'receipt-backfill', pass: oldEligible === 0 && learned === 26 && replay === 0,
    oldSqlEligible: oldEligible, learned, replay }); close(); save();

  config = configFor(true); open('authorized-source');
  const instance = 'local-folder:acquisition';
  const grant = upsertUnderstandingSourceGrant({ sourceKey: instance, adapterId: 'connector:local-files', category: 'files', platform: 'all', displayName: 'Synthetic source',
    accessMode: 'continuous', retentionPolicy: 'bounded_raw', processingPolicy: 'remote_allowed', config: { sourceInstanceId: instance } });
  grantUnderstandingConsent({ grantId: grant.id, purposes: ['work_assistance'], allowedDomains: ['goals'], deniedDomains: [], allowedFields: ['content'],
    accessMode: 'continuous', lookbackDays: 0, rawRetentionDays: 7, processingPolicy: 'remote_allowed', allowedAgentIds: ['main'], disclosureVersion: 'benchmark' });
  upsertKnowledgeSourceItems([{ sourceInstanceId: instance, collectionScope: 'files', externalId: 'atlas.md', itemType: 'local_file',
    contentHash: 'synthetic-version-1', normalizedText: 'Atlas uses SQLite because deployment must stay local.', synthesisPipeline: 'connected_knowledge' }]);
  await new ConnectedKnowledgePipeline({ agentId: 'main', workspaceId: workspace }).processPending();
  recoverSourceLearning(config); await runSourceLearning(() => config);
  const learnedSource = listKnowledgeItems({ recordClass: 'memory' });
  const context = { agentId: 'main', workspaceId: workspace, conversationId: '' };
  const eligible = learnedSource.filter(item => canUseKnowledge(item, context, { scopes: ['workspace'], contentSources: ['memory', 'local_import'] }));
  revokeUnderstandingConsent(grant.id);
  const afterRevoke = learnedSource.filter(item => canUseKnowledge(item, context));
  results.push({ id: 'authorized-source', pass: eligible.some(f => /SQLite/iu.test(f.content)) && afterRevoke.length === 0,
    learned: eligible.length, afterRevoke: afterRevoke.length }); close(); save();
} finally {
  Agent.prototype.prompt = originalPrompt; diagnostics.unsubscribe(observer);
  const unchanged = initialFingerprint === fingerprint();
  const summary = { positiveOpportunities: cases.filter(c => c.expectedPattern).length,
    baselinePatterns: results.filter(r => r.arm === 'baseline' && r.pattern && r.usable).length,
    carriedPatterns: results.filter(r => r.arm === 'carry' && r.pattern && r.usable).length, checks: results.length, passed: results.filter(r => r.pass).length,
    sourceUnchanged: unchanged, expectedChecks: cases.length * 2 + 3 };
  const success = summary.checks === summary.expectedChecks && summary.passed === summary.checks && unchanged;
  writeFileSync(reportPath, JSON.stringify({ model: modelRef, syntheticOnly: true, faultInjection: 'one source ref deliberately replaced with source_999 after a real model response',
    benchmark: 'persisted-memory-acquisition-ablation-v1', fingerprint: initialFingerprint, summary, success, results, modelReplies, usage }, null, 2));
  closeXopcDatabase(); rmSync(directory, { recursive: true, force: true });
  console.log(JSON.stringify({ reportPath, success, ...summary }));
  if (!success) process.exitCode = 1;
}
