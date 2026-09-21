/** Opt-in real Slack + shared Agent harness, with no command isolation configured. Uses an isolated database and synthetic resources. */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { serve } from '@hono/node-server';
import { Hono } from 'hono';

import { loadConfig } from '../src/config/loader.js';
import { LocalWorktreeManager } from '../src/execution-environments/local-worktree-manager.js';
import { auth } from '../src/gateway/hono/middleware/auth.js';
import { gatewayScopes } from '../src/gateway/hono/middleware/scopes.js';
import { registerAuthenticatedLazyRouteFallback } from '../src/gateway/hono/routes/lazy-fallback.js';
import { GatewaySceneHost } from '../src/gateway/scenes/host.js';
import { SlackThreadSource } from '../src/gateway/scenes/slackThreadSource.js';
import { ProjectStore } from '../src/projects/project-store.js';
import { getXopcCloudCatalogCoordinator } from '../src/providers/xopc-cloud-catalog-coordinator.js';
import { TaskSourceRegistry } from '../src/scenes/taskFollowUp/contracts.js';
import { SessionStore } from '../src/session/store.js';
import { onSessionTranscriptUpdate } from '../src/session/transcript-events.js';
import { TaskFollowUpService } from '../src/scenes/taskFollowUp/service.js';
import { closeXopcDatabase, openXopcDatabase } from '../src/storage/sqlite/index.js';
import { upsertConnectorConnection, upsertConnectorInstallation } from '../src/storage/sqlite/connector-repository.js';
import { createConversation } from '../src/storage/sqlite/conversation-repository.js';
import { getSqliteDatabase } from '../src/storage/sqlite/transaction.js';
import { TaskRunDispatcher } from '../src/tasks/task-run-dispatcher.js';
import { TaskRunRepository } from '../src/tasks/task-run-repository.js';
import { TaskConversationRepository } from '../src/tasks/task-conversation-repository.js';

assert.equal(process.env.XOPC_SCENE_LIVE_MODEL, '1', 'Explicitly authorize real model and connector usage');
const accountId = process.env.XOPC_SCENE_TEST_ACCOUNT;
const url = process.env.XOPC_SCENE_TEST_THREAD;
const scenario = process.env.XOPC_SCENE_TEST_SCENARIO ?? 'worktree';
assert.ok(['worktree', 'artifacts'].includes(scenario));
const liveDbPath = process.env.XOPC_SCENE_TEST_LIVE_DB;
assert.ok(accountId && url && liveDbPath);
const originalConfig = loadConfig();
const gateway = process.env.XOPC_SCENE_TEST_GATEWAY ?? `http://127.0.0.1:${originalConfig.gateway.port}`;
assert.equal(new URL(gateway).hostname, '127.0.0.1', 'This harness only proxies through the local authenticated gateway');
const config = structuredClone(originalConfig);
delete config.agents.defaults.runtime.commandIsolation;
await getXopcCloudCatalogCoordinator().hydrate();

// Mirror metadata only. Every real read still goes through the live Gateway's current account policy.
const live = new DatabaseSync(liveDbPath, { readOnly: true });
const account = live.prepare('SELECT * FROM connector_accounts WHERE id = ?').get(accountId)!;
assert.ok(account && account.enabled === 1);
const connection = live.prepare('SELECT * FROM connector_connections WHERE id = ?').get(account.current_connection_id)!;
const installation = live.prepare('SELECT * FROM connector_installations WHERE id = ?').get(connection.installation_id)!;
live.close();
const directory = mkdtempSync(join(tmpdir(), 'xopc-task-follow-up-live-'));
const repository = join(directory, 'repository');
const git = (args: string[], cwd = repository) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
if (scenario === 'worktree') {
  mkdirSync(repository);
  git(['init', '-b', 'main']); git(['config', 'user.name', 'XOPC live fixture']); git(['config', 'user.email', 'fixture@example.invalid']);
  writeFileSync(join(repository, 'calculator.mjs'), 'export function add(a, b) { return a - b; }\n');
  writeFileSync(join(repository, 'calculator.test.mjs'), "import { test } from 'node:test';\nimport assert from 'node:assert/strict';\nimport { add } from './calculator.mjs';\ntest('addition', () => assert.equal(add(2,3),5));\n");
  git(['add', '.']); git(['-c', 'core.hooksPath=/dev/null', 'commit', '-m', 'synthetic live test baseline']);
}
openXopcDatabase({ path: join(directory, 'state.db') });
const db = getSqliteDatabase();
upsertConnectorInstallation({ id: String(installation.id), connectorId: String(installation.connector_id), principalId: String(installation.principal_id),
  enabled: installation.enabled === 1, allowedAgentIds: JSON.parse(String(installation.allowed_agent_ids_json)), maxScope: installation.max_scope as 'read',
  confirmationPolicy: installation.confirmation_policy as 'writes', selectedAccountIds: JSON.parse(String(installation.selected_account_ids_json)) });
upsertConnectorConnection({ id: String(connection.id), accountId, installationId: String(installation.id), connectorId: String(connection.connector_id),
  provider: 'composio', principalId: String(connection.principal_id), providerConnectionId: String(connection.provider_connection_id),
  identity: JSON.parse(String(connection.identity_json)), status: connection.status as 'active', isDefault: false,
  expiresAt: connection.expires_at ? String(connection.expires_at) : undefined, metadata: {} });
db.prepare('UPDATE connector_accounts SET allowed_agent_ids_json = ? WHERE id = ?').run(account.allowed_agent_ids_json, accountId);
const principal = { ownerId: String(installation.principal_id), workspaceId: directory };
let reads = 0;
const source = new SlackThreadSource(db, { executeWithPolicy: async input => {
  assert.equal(input.action.scope, 'read');
  assert.ok(['SLACK_TEST_AUTH', 'SLACK_FETCH_MESSAGE_THREAD_FROM_A_CONVERSATION'].includes(input.action.actionId));
  assert.equal(input.connection?.accountId, accountId);
  assert.ok(++reads <= 30, 'Live connector request budget exceeded');
  const response = await fetch(`${gateway}/api/connectors/composio/tools/${input.action.actionId}/execute`, { method: 'POST',
    headers: { Authorization: `Bearer ${originalConfig.gateway.auth.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ accountId, arguments: input.args }), signal: input.signal ?? AbortSignal.timeout(30_000) });
  const body = await response.json();
  if (!response.ok || !body.ok) throw new Error(body.error ?? `Live connector HTTP ${response.status}`);
  return { decision: 'allowed', result: body.payload.result };
} });
const host = new GatewaySceneHost(db, { principal, config: () => config, publish: () => {} });
const followUp = new TaskFollowUpService(db, { config: () => config, sources: new TaskSourceRegistry([source]), stateDir: directory, worktrees: new LocalWorktreeManager({ stateDir: directory }) });
host.http.followUps = followUp;
const store = new SessionStore({ config });
const persisted: Promise<void>[] = [];
const unsubscribe = onSessionTranscriptUpdate(update => { persisted.push(store.syncEmbeddedTranscriptUpdate(update)); });
const dispatcher = new TaskRunDispatcher({ workerId: 'live-slack-smoke', ensureSession: async (taskId, runId) => {
  const conversations = new TaskConversationRepository();
  const conversationId = conversations.getActiveSession(taskId)?.conversationId
    ?? new TaskRunRepository().listByTask(taskId).find(run => run.conversationId)?.conversationId
    ?? createConversation({ agentId: 'main', sourceChannel: 'webchat', sourceChatId: `slack-live-${taskId}` }).key;
  conversations.activateExecutionSession({ taskId, runId, agentId: 'main', conversationId });
  return conversationId;
},
  runAgent: async (runId, conversationId) => { assert.equal(await followUp.executeTask(runId, conversationId), true); } });
const app = new Hono();
const token = randomUUID();
app.use(auth({ getResolvedAuth: () => ({ mode: 'token', token, allowTailscale: false }) })); app.use(gatewayScopes());
const pass = async (_c, next) => { await next(); };
registerAuthenticatedLazyRouteFallback(app, { service: { currentWorkspacePath: directory } as never, scenes: host.http,
  strictRateLimitMiddleware: pass, chatRateLimitMiddleware: pass, xopcCloudPollRateLimitMiddleware: pass });
const http = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: 0 });
await new Promise<void>(resolve => http.once('listening', resolve));
const target = `http://127.0.0.1:${(http.address() as AddressInfo).port}`;
const api = async (path: string, body?: unknown, method = body === undefined ? 'GET' : 'POST') => {
  const response = await fetch(`${target}/api/scenes${path}`, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(60_000) });
  const data = await response.json(); assert.ok(response.ok, JSON.stringify(data)); return data;
};
console.log(JSON.stringify({ directory, scenario, mode: 'real Slack + shared native model; no Docker configured; isolated Task database' }));
try {
  assert.equal((await fetch(`${target}/api/scenes/task-follow-ups`)).status, 401);
  const { source: reference } = await api('/source-providers/slack_thread/resolve-link', { accountId, url });
  const project = scenario === 'worktree' ? new ProjectStore().create({ name: 'Generic follow-up acceptance (synthetic)', workspaceRoot: repository }) : undefined;
  const first = await api('/task-follow-ups', { source: reference, sourceUrl: url, ...(project ? { projectId: project.id } : {}),
    resource: scenario, capabilities: ['workspace.read', 'workspace.write'],
    goal: scenario === 'worktree'
      ? '修复合成 calculator.mjs 的 add(a,b)，实现此线程当前全部已明确的输入校验要求并补充测试。只改此任务 worktree，不提交或推送。没有命令权限，不运行测试；如实标记未验证，不要因此请求额外授权。'
      : '将这个讨论里的当前需求和决定整理到 decisions.md；明确区分已确认需求与未来计划。只维护文档，不写代码，不执行命令。',
    instruction: '按当前证据完成本次工作；后续监控由宿主负责。不要等待未来消息。仅真正需要人决策时标记 needsUser。' });
  await dispatcher.drain(); await Promise.all(persisted);
  const scene = await api(`/task-follow-ups/${first.activation.id}`);
  writeFileSync(join(directory, 'report.json'), JSON.stringify({ passed: false, scene, reads }, null, 2));
  assert.equal(scene.processedRevision, 1, JSON.stringify({ error: scene.lastError, receipt: scene.receipt }));
  assert.equal(scene.task.id, first.task.id);
  assert.equal(scene.receipt.verification.status, 'unverified');
  assert.equal(scene.receipt.needsUser, false);
  const workspace = scene.environment?.rootPath ?? scene.artifactPath;
  const artifact = readFileSync(join(workspace, scenario === 'worktree' ? 'calculator.mjs' : 'decisions.md'), 'utf8');
  assert.ok(artifact.length > 40);
  const conversationId = new TaskRunRepository().getLatestRoot(scene.task.id)!.conversationId!;
  const transcript = await store.loadMessages(conversationId);
  assert.ok(transcript.some(message => message.role === 'toolResult'), 'Tool evidence must survive outside the live harness');
  if (scenario === 'worktree') {
    assert.notEqual(artifact, readFileSync(join(repository, 'calculator.mjs'), 'utf8'));
    assert.equal(git(['status', '--porcelain']).trim(), '');
    assert.equal(git(['rev-parse', 'HEAD']), git(['rev-parse', 'HEAD'], workspace));
    const branches = await api(`/task-follow-ups/projects/${scene.input.projectId}/branches`);
    assert.ok(JSON.stringify(branches).includes(scene.task.id));
  } else {
    assert.equal(scene.environment, undefined);
    assert.equal(scene.task.projectId, undefined);
  }
  const runs = new TaskRunRepository().listByTask(scene.task.id).length;
  await followUp.tick(); await dispatcher.drain();
  assert.equal(new TaskRunRepository().listByTask(scene.task.id).length, runs, 'Unchanged input must not dispatch again');
  await api(`/task-follow-ups/${scene.activation.id}`, { expectedRevision: scene.activation.revision, status: 'paused' }, 'PATCH');
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
  writeFileSync(join(directory, 'report.json'), JSON.stringify({ passed: true, scene: await api(`/task-follow-ups/${scene.activation.id}`), reads,
    transcriptMessages: transcript.length, source: 'real Slack and real model; no command backend or verification grant; isolated database' }, null, 2));
  console.log(JSON.stringify({ passed: true, directory, scenario, taskId: scene.task.id, processedRevision: scene.processedRevision,
    verification: scene.receipt.verification.status, workspace, transcriptMessages: transcript.length, reads }));
} finally {
  await host.stop(); await Promise.all(persisted); unsubscribe();
  await new Promise<void>(resolve => http.close(() => resolve())); closeXopcDatabase();
}
