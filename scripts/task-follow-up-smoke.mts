/** Real UI + authenticated lazy routes + TaskRun dispatcher; external Slack/model/verification use explicit fixtures. */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { serve } from '@hono/node-server';
import { Hono } from 'hono';

import { ConfigSchema } from '../src/config/schema.js';
import { LocalWorktreeManager } from '../src/execution-environments/local-worktree-manager.js';
import { auth } from '../src/gateway/hono/middleware/auth.js';
import { gatewayScopes } from '../src/gateway/hono/middleware/scopes.js';
import { registerAuthenticatedLazyRouteFallback } from '../src/gateway/hono/routes/lazy-fallback.js';
import { GatewaySceneHost } from '../src/gateway/scenes/host.js';
import { ProjectStore } from '../src/projects/project-store.js';
import { TaskFollowUpService } from '../src/scenes/taskFollowUp/service.js';
import { TaskSourceRegistry } from '../src/scenes/taskFollowUp/contracts.js';
import { parseSlackThreadUrl } from '../src/gateway/scenes/slackThreadSource.js';
import { closeXopcDatabase, openXopcDatabase } from '../src/storage/sqlite/index.js';
import { getSqliteDatabase } from '../src/storage/sqlite/transaction.js';
import { createConversation } from '../src/storage/sqlite/conversation-repository.js';
import { TaskRunDispatcher } from '../src/tasks/task-run-dispatcher.js';

const directory = mkdtempSync(join(tmpdir(), 'xopc-followUp-smoke-'));
const screenshots = mkdtempSync(join(tmpdir(), 'xopc-followUp-screens-'));
const repository = join(directory, 'repository'); mkdirSync(repository);
const git = (args: string[]) => execFileSync('git', args, { cwd: repository, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
git(['init', '-b', 'main']); git(['config', 'user.email', 'fixture@example.invalid']); git(['config', 'user.name', 'Fixture']);
writeFileSync(join(repository, 'app.js'), 'export const value = 1;\n'); git(['add', 'app.js']); git(['commit', '-m', 'fixture']); git(['branch', 'existing-fix']);
openXopcDatabase({ path: join(directory, 'state.db') });
const db = getSqliteDatabase();
const project = new ProjectStore().create({ name: 'Fixture project', workspaceRoot: repository });
const config = ConfigSchema.parse({});
const principal = { ownerId: 'local-owner', workspaceId: directory };
let revision = 1;
const thread = { accountId: 'fixture', teamId: 'T123', channelId: 'C123', threadTs: '1234567890.123456' };
const source = { id: 'slack_thread', label: 'Fixture Slack', normalize: reference => reference, authorized: () => true, accountIds: () => ['fixture'],
  resolveLink: async (_principal, _account, url) => ({ ...thread, ...parseSlackThreadUrl(url) }), listAccounts: () => [{ id: 'fixture', label: 'Fixture Slack' }],
  read: async () => ({ revision: String(revision), text: `Set value to ${revision + 1}`, observedAt: Date.now() }) };
const host = new GatewaySceneHost(db, { principal, config: () => config, publish: () => {}, executor: { execute: async () => ({ kind: 'no_change', summary: '', evidenceIds: [] }) } });
const followUp = new TaskFollowUpService(db, { config: () => config, sources: new TaskSourceRegistry([source]), stateDir: directory,
  worktrees: new LocalWorktreeManager({ stateDir: directory }),
  executor: { execute: async input => {
    input.guard(); if (input.capabilities.includes('workspace.write')) writeFileSync(join(input.workspace, input.instruction === 'Maintain decisions.md' ? 'decisions.md' : 'app.js'), `export const value = ${revision + 1};\n`);
    return { summary: `Fixture: incorporated source revision ${revision}`, needsUser: false, continueAutomatically: false, remainingWork: [] };
  } } });
host.http.followUps = followUp;
const conversations = new Map<string, string>();
const dispatcher = new TaskRunDispatcher({ workerId: 'smoke', ensureSession: async taskId => {
  if (!conversations.has(taskId)) conversations.set(taskId, createConversation({ agentId: 'main', sourceChannel: 'webchat', sourceChatId: `fixture-${taskId}` }).key);
  return conversations.get(taskId)!;
}, runAgent: async (runId, conversationId) => { assert.equal(await followUp.executeTask(runId, conversationId), true); } });
const app = new Hono();
app.use(auth({ getResolvedAuth: () => ({ mode: 'token', token: 'followUp-fixture', allowTailscale: false }) }));
app.use(gatewayScopes());
app.get('/api/projects', c => c.json({ ok: true, items: [project], total: 1 }));
const pass = async (_c, next) => { await next(); };
registerAuthenticatedLazyRouteFallback(app, { service: { currentWorkspacePath: directory } as never, scenes: host.http,
  strictRateLimitMiddleware: pass, chatRateLimitMiddleware: pass, xopcCloudPollRateLimitMiddleware: pass });
const http = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: 0 });
await new Promise<void>(resolve => http.once('listening', resolve));
const target = `http://127.0.0.1:${(http.address() as AddressInfo).port}`;
const root = fileURLToPath(new URL('../web', import.meta.url));
const require = createRequire(new URL('../web/package.json', import.meta.url));
const { chromium } = require('playwright-core') as typeof import('playwright-core');
const { createServer } = await import(require.resolve('vite'));
let vite;
let browser;
try {
  assert.equal((await fetch(`${target}/api/scenes/task-follow-ups`)).status, 401);
  assert.equal((await fetch(`${target}/api/scenes/development`, { headers: { Authorization: 'Bearer followUp-fixture' } })).status, 404);
  vite = await createServer({ configFile: join(root, 'vite.config.ts'), root,
    server: { host: '127.0.0.1', port: 0, open: false, proxy: { '/api': { target }, '/api/scenes': { target } } } });
  await vite.listen();
  browser = await chromium.launch({ executablePath: process.env.XOPC_SCENES_SMOKE_BROWSER ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
  const page = await browser.newPage({ viewport: { width: 1024, height: 900 } });
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (!path.startsWith('/api/scenes') && path !== '/api/projects') return route.fulfill({ status: 404, json: { error: 'outside_fixture' } });
    return route.continue({ headers: { ...route.request().headers(), authorization: 'Bearer followUp-fixture' } });
  });
  await page.goto(`${vite.resolvedUrls.local[0]}smoke/scenes.html#/scenes/new/task-follow-up`);
  await page.getByLabel('来源链接', { exact: true }).fill('https://fixture.slack.com/archives/C123/p1234567890123456');
  await page.getByLabel('你希望完成什么？', { exact: true }).fill('持续修复 value');
  await page.getByLabel('工作资源', { exact: true }).click();
  await page.getByRole('button', { name: 'Git worktree · 项目修改', exact: true }).click();
  await page.getByLabel('允许创建和修改此任务工作区内的文件').check();
  await page.screenshot({ path: join(screenshots, 'create-worktree-desktop.png'), fullPage: true });
  await page.getByRole('button', { name: '确认范围并开始跟进', exact: true }).click();
  await page.getByRole('heading', { name: '持续修复 value', exact: true }).waitFor();
  await dispatcher.drain();
  await page.getByRole('status').filter({ hasText: '已处理当前来源版本' }).waitFor();
  const first = followUp.list(principal)[0];
  assert.equal(first.processedRevision, 1);
  assert.equal(first.receipt?.verification.status, 'unverified');
  assert.equal(readFileSync(join(repository, 'app.js'), 'utf8'), 'export const value = 1;\n');
  assert.equal(readFileSync(join(first.environment!.rootPath, 'app.js'), 'utf8'), 'export const value = 2;\n');
  revision = 2; db.prepare('UPDATE scene_task_bindings SET next_poll_at = 0').run();
  await followUp.tick(); await dispatcher.drain();
  assert.equal(followUp.list(principal)[0].processedRevision, 2);
  assert.equal(followUp.list(principal)[0].environment!.id, first.environment!.id);
  await page.getByRole('button', { name: '暂停跟进与执行', exact: true }).click();
  await page.getByText('调整指令与授权', { exact: true }).click();
  await page.getByLabel('处理指令', { exact: true }).fill('Keep this task scope; improve the explanation');
  await page.getByRole('button', { name: '保存指令与授权', exact: true }).click();
  await page.getByRole('button', { name: '保存指令与授权', exact: true }).waitFor({ state: 'hidden' });
  assert.equal(followUp.get(principal, first.activation.id).activation.status, 'paused');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${vite.resolvedUrls.local[0]}smoke/scenes.html#/scenes/new/task-follow-up`);
  await page.getByLabel('来源链接', { exact: true }).fill('https://fixture.slack.com/archives/C123/p1234567890123457');
  await page.getByLabel('你希望完成什么？', { exact: true }).fill('整理决策记录');
  await page.getByLabel('处理指令（可选）', { exact: true }).fill('Maintain decisions.md');
  await page.getByLabel('工作资源', { exact: true }).click();
  await page.getByRole('button', { name: '任务产物目录 · 文档等文件', exact: true }).click();
  await page.getByLabel('允许创建和修改此任务工作区内的文件').check();
  assert.equal(await page.getByLabel('项目', { exact: true }).count(), 0);
  await page.screenshot({ path: join(screenshots, 'create-document-mobile.png'), fullPage: true });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.getByRole('button', { name: '确认范围并开始跟进', exact: true }).click();
  await page.getByRole('heading', { name: '整理决策记录', exact: true }).waitFor();
  await dispatcher.drain();
  await page.getByRole('status').filter({ hasText: '已处理当前来源版本' }).waitFor();
  const document = followUp.list(principal).find(item => item.activation.goal === '整理决策记录')!;
  assert.equal(document.environment, undefined);
  assert.ok(readFileSync(join(document.artifactPath!, 'decisions.md'), 'utf8').includes('value = 3'));
  await page.screenshot({ path: join(screenshots, 'document-result-mobile.png'), fullPage: true });
  await page.evaluate(() => window.document.documentElement.classList.add('dark'));
  await page.screenshot({ path: join(screenshots, 'document-result-dark.png'), fullPage: true });
  assert.deepEqual(errors, []);
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
  console.log(JSON.stringify({ passed: true, scenarios: ['worktree edits without Docker', 'documents without Git', 'source update', 'pause and configure', 'authenticated lazy routes'], screenshots }));
} finally {
  await browser?.close(); await vite?.close(); await host.stop();
  await new Promise<void>(resolve => http.close(() => resolve())); closeXopcDatabase();
  rmSync(directory, { recursive: true, force: true });
}
