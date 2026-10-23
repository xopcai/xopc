/** Isolated real-Gateway lab for manual browser acceptance. No user state or external model is used. */
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';

const state = mkdtempSync(join(tmpdir(), 'xopc-home-browser-'));
const workspace = join(state, 'workspace');
mkdirSync(workspace);
Object.assign(process.env, { XOPC_STATE_DIR: state, XOPC_CONFIG_PATH: join(state, 'xopc.json'), XOPC_CONFIG: join(state, 'xopc.json'), XOPC_WORKSPACE: workspace, PI_CODING_AGENT_DIR: join(state, 'pi'), XOPC_LOG_LEVEL: 'fatal', XOPC_LOG_DIR: join(state, 'logs'), XOPC_SKIP_CHANNELS: '1' });
let modelRequests = 0;
const model = createServer(async (req, res) => {
  try {
    let raw = ''; for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw);
    const content = `Browser lab execution ${++modelRequests} finished. Local report is available at report.html. No external writes were performed.`;
    const id = randomUUID();
    if (body.stream) {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      const chunk = { id, object: 'chat.completion.chunk', created: Math.floor(Date.now() / 1000), model: 'home-lab', choices: [{ index: 0, delta: { role: 'assistant', content }, finish_reason: null }] };
      res.write(`data: ${JSON.stringify(chunk)}\n\n`);
      res.write(`data: ${JSON.stringify({ ...chunk, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 20, completion_tokens: 20 } })}\n\n`);
      res.end('data: [DONE]\n\n');
    } else {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ id, object: 'chat.completion', created: Math.floor(Date.now() / 1000), model: 'home-lab', choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }], usage: { prompt_tokens: 20, completion_tokens: 20 } }));
    }
  } catch { res.writeHead(500).end(); }
});
model.listen(0, '127.0.0.1'); await once(model, 'listening');
const modelPort = (model.address() as { port: number }).port;
writeFileSync(join(state, 'models.json'), JSON.stringify({ providers: { 'home-lab': { baseUrl: `http://127.0.0.1:${modelPort}/v1`, apiKey: 'local-fixture', api: 'openai-completions', models: [{ id: 'lab', name: 'Local browser lab', reasoning: false, input: ['text'], contextWindow: 128000, maxTokens: 2000, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }] } } }));
writeFileSync(join(state, 'xopc.json'), JSON.stringify({ gateway: { bind: 'loopback', port: 24180, corsOrigins: ['http://127.0.0.1:4310'], auth: { mode: 'none' }, tailscale: { mode: 'off' } }, browser: { enabled: false }, channels: {}, userContext: { enabled: true, homeIntelligence: { enabled: true, refreshOnContextChange: false } } }));
writeFileSync(join(workspace, 'report.html'), '<!doctype html><html><head><title>Browser acceptance report</title></head><body><h1>HOME_ARTIFACT_OPEN_OK</h1><p>This local report verifies artifact preview.</p><button onclick="this.textContent=\'INTERACTION_OK\'">Verify report interaction</button></body></html>');

const { openXopcDatabase, getSqliteDatabase } = await import('../src/storage/sqlite/index.js');
const { seedTestAgentCatalog } = await import('../src/agent-catalog/test-support.js');
const { AgentDefaultsSchema } = await import('../src/agent-config/schema.js');
const { TaskApplicationService } = await import('../src/tasks/task-application-service.js');
const { TaskRunRepository } = await import('../src/tasks/task-run-repository.js');
const { TaskRepository } = await import('../src/tasks/task-repository.js');
const { TaskContextRepository } = await import('../src/tasks/task-context-repository.js');
const { TaskConversationRepository } = await import('../src/tasks/task-conversation-repository.js');
const { createConversation } = await import('../src/storage/sqlite/conversation-repository.js');
const { createConnectorApproval } = await import('../src/storage/sqlite/connector-repository.js');
const { HomeIntelligenceRepository } = await import('../src/home-intelligence/repository.js');
const { HomeOpportunitySchema } = await import('@xopcai/gateway-contract');
const { GatewayService } = await import('../src/gateway/service.js');
const { createHonoApp } = await import('../src/gateway/hono/app.js');
const { serve } = await import('@hono/node-server');
const { createServer: createViteServer } = await import('vite');
openXopcDatabase({ path: join(state, 'xopc.db') });
seedTestAgentCatalog({ defaults: AgentDefaultsSchema.parse({ models: { chat: { primary: 'home-lab/lab' }, intents: {} } }), agents: [{ id: 'main', enabled: true, workspace, profile: { name: 'Browser Lab' } }] });
const app = new TaskApplicationService(), runs = new TaskRunRepository(), tasks = new TaskRepository();
const ids: Record<string, string> = {};
function seedTask(key: string, title: string, kind = 'manual') {
  const created = app.create({ idempotencyKey: `lab:${key}`, title, locale: 'en', priority: 'normal', delegateAgentId: 'main', contract: { objective: title, expectedOutputs: ['report.html'], acceptanceCriteria: ['Report is readable', 'Result contains supporting evidence'], constraints: [], assumptions: [], risks: [], approvalRequired: [], acceptancePolicy: kind === 'auto' ? 'verified_auto' : 'manual', outputDestinations: [] }, dependencies: [], context: [], authorityGrants: [], activation: { mode: 'start', executor: { kind: 'agent', agentId: 'main' } } });
  if (!created.ok || !created.runId) throw new Error('seed failed');
  const task = created.model.task;
  ids[key] = task.id;
  const conversation = createConversation({ agentId: 'main', sourceChannel: 'webchat', name: title }, workspace);
  new TaskConversationRepository().activateExecutionSession({ taskId: task.id, conversationId: conversation.key, agentId: 'main', runId: created.runId });
  const queued = runs.require(created.runId);
  const snapshot = new TaskContextRepository().captureSnapshot({ ownerKind: 'task_run', ownerId: queued.id, query: title });
  const run = runs.start({ runId: queued.id, expectedVersion: queued.version, contextSnapshotId: snapshot.id, policySnapshot: {} })!;
  app.completeRun({ runId: run.id, expectedRunVersion: run.version, receipt: { status: kind === 'failed' ? 'failed' : 'succeeded', summary: `${title}: local report prepared.`, changes: [], evidence: [{ kind: 'artifact', title: 'Open local HTML report', summary: 'Saved in the task workspace', uri: 'report.html', provenance: 'tool', strength: 'observed', observedAt: Date.now() }, { kind: 'source', title: 'Open external evidence', summary: 'Local HTTP source', uri: 'http://127.0.0.1:24180/health', provenance: 'external', strength: 'observed', observedAt: Date.now() }], verification: { status: 'unverified', checks: [{ criterion: 'Report is readable', status: 'unverified', evidenceTitles: ['Open local HTML report'], note: 'Open the report before deciding.' }, { criterion: 'Result contains supporting evidence', status: 'unverified', evidenceTitles: [], note: 'The delivery only contains a file path. Continue execution to supply verification.' }] }, remainingWork: ['Check the result against the evidence'], nextAction: 'Review both criteria or continue execution.', needsUser: false, completionVerdict: 'partial', ...(kind === 'failed' ? { failure: { code: 'lab_failure', phase: 'execution', recoveryAction: 'Retry this local lab task.' } } : {}) } });
  return { task: tasks.require(task.id), conversationId: conversation.key };
}
const review = seedTask('review', 'LAB · Manual acceptance');
seedTask('automatic', 'LAB · Automatic verification', 'auto');
seedTask('failed', 'LAB · Failed task retry', 'failed');
for (const [key, title, kind, condition] of [
  ['input', 'LAB · Missing user input', 'user_input', { question: 'Who should receive the local report?', choices: ['Alice', 'Bob'] }],
  ['approval', 'LAB · Task approval', 'approval', { capability: 'lab.report.read', scope: { resource: 'local synthetic report' } }],
  ['approval-deny', 'LAB · Task approval denial', 'approval', { capability: 'lab.report.read', scope: { resource: 'local synthetic report' } }],
  ['paused', 'LAB · Paused task', 'paused', {}],
  ['dependency', 'LAB · Dependency wait', 'dependency', { dependsOnTaskId: review.task.id }],
] as const) {
  const seeded = seedTask(key, title);
  runs.createWait({ taskId: seeded.task.id, kind, reason: title, condition });
}
createConnectorApproval({ principalId: 'local-owner', connectorId: 'lab-only-connector', actionId: 'LAB · Connector decision', scope: 'read', argumentsHash: 'lab', argumentsPreview: { record: 'not-a-real-account' }, expiresAt: new Date(Date.now() + 86400000).toISOString(), conversationId: review.conversationId });
createConnectorApproval({ principalId: 'local-owner', connectorId: 'lab-only-connector', actionId: 'LAB · Connector allow', scope: 'read', argumentsHash: 'lab-allow', argumentsPreview: { record: 'synthetic-only' }, expiresAt: new Date(Date.now() + 86400000).toISOString(), conversationId: review.conversationId });
const service = new GatewayService({ configPath: process.env.XOPC_CONFIG_PATH, enableHotReload: false, listenPort: 24180 });
await service.start();
service.homeIntelligence.stop();
for (let index = 1; index <= 4; index++) await service.automationServiceInstance.create({ name: `LAB · Scheduled report ${index}`, enabled: true, trigger: { kind: 'schedule', schedule: { kind: 'once', at: new Date(Date.now() + index * 86400000).toISOString() } }, action: { kind: 'agent', agentId: 'main', instruction: 'Local browser lab report', model: 'home-lab/lab' }, delivery: { notificationPolicy: 'attention', destinations: [{ key: 'gateway_event', kind: 'gateway_event' }] }, conversationMode: 'new_session' });
const { saveAutomationRun } = await import('../src/automations/storage/automation-run-repository.js');
for (const suffix of ['retry', 'dismiss']) {
  const automation = await service.automationServiceInstance.create({ name: `LAB · Automation ${suffix}`, enabled: true, trigger: { kind: 'manual' }, action: { kind: 'agent', agentId: 'main', instruction: 'Return the local browser lab result.', model: 'home-lab/lab' }, delivery: { notificationPolicy: 'attention', destinations: [{ key: 'gateway_event', kind: 'gateway_event' }] }, conversationMode: 'new_session' });
  saveAutomationRun({ id: randomUUID(), automationId: automation.id, automationName: automation.name, status: 'failed', triggerSnapshot: automation.trigger, actionSnapshot: automation.action, manual: true, createdAtMs: Date.now(), endedAtMs: Date.now(), error: 'Synthetic previous failure' });
}
const repository = new HomeIntelligenceRepository(getSqliteDatabase());
const principal = { ownerId: 'local-owner', workspaceId: workspace };
function advice(id: string, title: string) {
  return HomeOpportunitySchema.parse({ id, revision: 1, kind: 'project_next_step', title, outcome: 'Prepare a local report with visible evidence.', rationale: 'A synthetic report is ready for review.', evidence: [{ id: 'task:evidence', sourceType: 'task', sourceRef: review.task.id, revision: '1', observation: 'Open the acceptance task as supporting evidence', href: `/tasks/${review.task.id}`, observedAt: Date.now(), freshUntil: Date.now() + 86400000 }, { id: 'external:evidence', sourceType: 'file', sourceRef: 'local-health', revision: '1', observation: 'Open the local external HTTP evidence', href: 'http://127.0.0.1:24180/health', observedAt: Date.now(), freshUntil: Date.now() + 86400000 }], confidence: 'high', urgency: 'today', risk: 'analysis', proposedSteps: ['Review local report'], capabilities: [], verification: ['Include supporting evidence'], actionPrompt: 'Prepare a local report with supporting evidence.', actions: { canStart: true, canDiscuss: true, degradedStartAvailable: false }, generatedAt: Date.now(), expiresAt: Date.now() + 86400000 });
}
function seedAdvice() {
  repository.enqueue(principal, { idempotencyKey: randomUUID(), reasons: ['manual_refresh'], requestedAt: Date.now() });
  const claim = repository.claimNext(principal, 'browser-lab', Date.now());
  if (claim) repository.complete(claim, { result: { state: 'ready', opportunities: [advice(randomUUID(), 'LAB · Evidence based suggestion'), advice(randomUUID(), 'LAB · Alternative suggestion')] }, snapshotHash: randomUUID(), evidenceIds: ['task:evidence'], completedAt: Date.now() });
}
seedAdvice();
const server = serve({ fetch: createHonoApp({ service }).fetch, hostname: '127.0.0.1', port: 24180 });
server.on('upgrade', (req, socket, head) => {
  if (!service.realtime.handleUpgrade(req, socket, head)) socket.destroy();
});
service.markHttpListening();
await once(server, 'listening');
const vite = await createViteServer({ root: resolve('web'), server: { host: '127.0.0.1', port: 4310, strictPort: true, proxy: { '/api': { target: 'http://127.0.0.1:24180', changeOrigin: true, ws: true }, '/health': { target: 'http://127.0.0.1:24180', changeOrigin: true } } } });
await vite.listen();
writeFileSync(join(state, 'lab.json'), JSON.stringify({ state, workspace, ids, url: 'http://127.0.0.1:4310' }, null, 2));
console.log(JSON.stringify({ ready: true, state, url: 'http://127.0.0.1:4310', ids }));
process.on('SIGTERM', () => { void Promise.all([vite.close(), service.stop()]).finally(() => { server.closeAllConnections(); server.close(); model.closeAllConnections(); model.close(); process.exit(0); }); });
