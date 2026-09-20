import { BrowserSubscriptionService } from '../src/notifications/browserSubscriptions.js';
import { ScenePreferenceService } from '../src/scenes/preferences.js';
/** Real scene components and authenticated HTTP, isolated SQLite, no model or external writes. */
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { createRequire } from 'node:module';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

import { serve } from '@hono/node-server';
import { Hono } from 'hono';

import { auth } from '../src/gateway/hono/middleware/auth.js';
import { gatewayScopes } from '../src/gateway/hono/middleware/scopes.js';
import { registerAuthenticatedLazyRouteFallback } from '../src/gateway/hono/routes/lazy-fallback.js';
import { SceneExecutionService } from '../src/scenes/execution.js';
import { SceneInboxService } from '../src/scenes/inbox.js';
import { SceneMetrics } from '../src/scenes/metrics.js';
import { SceneMailContextProvider } from '../src/scenes/mailContext.js';
import { SceneRepository } from '../src/scenes/repository.js';
import { installSceneStorage } from '../src/storage/sqlite/scenes-schema.js';
import { SceneApplicationService } from '../src/scenes/service.js';
import { familyPlanTemplate, mailFollowUpTemplate } from '../src/scenes/templates.js';
import { SceneUserNotesProvider } from '../src/scenes/userNotes.js';

const root = fileURLToPath(new URL('../web', import.meta.url));
const require = createRequire(new URL('../web/package.json', import.meta.url));
const { chromium } = require('playwright-core') as typeof import('playwright-core');
const { createServer } = await import(require.resolve('vite'));
const db = new DatabaseSync(':memory:');
db.exec('PRAGMA foreign_keys = ON');
installSceneStorage(db);
db.exec(`CREATE TABLE connector_accounts(id TEXT, principal_id TEXT, current_connection_id TEXT, enabled INTEGER, connector_id TEXT, allowed_agent_ids_json TEXT);
  CREATE TABLE connector_connections(id TEXT, account_id TEXT, status TEXT, expires_at TEXT, principal_id TEXT, connector_id TEXT, installation_id TEXT);
  CREATE TABLE connector_installations(id TEXT, principal_id TEXT, connector_id TEXT, enabled INTEGER, allowed_agent_ids_json TEXT, selected_account_ids_json TEXT);
  CREATE TABLE knowledge_source_items(item_id TEXT, source_instance_id TEXT, collection_scope TEXT, item_type TEXT, content_hash TEXT,
    normalized_text TEXT, sensitivity TEXT, metadata_json TEXT, occurred_at INTEGER, deleted_at INTEGER);
  CREATE TABLE knowledge_sync_runs(source_instance_id TEXT, collection_scope TEXT, status TEXT, started_at INTEGER, finished_at INTEGER);
  INSERT INTO connector_installations VALUES ('installation', 'local-owner', 'gmail', 1, '[]', 'null');
  INSERT INTO connector_accounts VALUES ('personal', 'local-owner', 'connection', 1, 'gmail', NULL);
  INSERT INTO connector_connections VALUES ('connection', 'personal', 'active', NULL, 'local-owner', 'gmail', 'installation');`);
db.prepare('INSERT INTO knowledge_source_items VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)').run('mail-source', 'mail-sync', 'inbox', 'email', 'revision1',
  JSON.stringify({ threadId: 'thread', subject: '确认评审时间', sender: 'colleague@example.test', content: '请确认下周评审时间。', labels: ['INBOX'] }),
  'personal', JSON.stringify({ connectionId: 'connection', workspaceId: 'smoke-workspace' }), Date.now());
db.prepare('INSERT INTO knowledge_sync_runs VALUES (?, ?, ?, ?, ?)').run('mail-sync', 'inbox', 'succeeded', Date.now(), Date.now());
const repository = new SceneRepository(db);
repository.installTemplate(familyPlanTemplate);
repository.installTemplate(mailFollowUpTemplate);
db.exec('CREATE TABLE notification_events(event_id TEXT PRIMARY KEY)');
const provider = new SceneUserNotesProvider(db);
const mail = new SceneMailContextProvider(db);
const authorize = async () => ({ accountIds: ['personal'], contextProviders: ['user_notes', 'mail'], effectHandlers: [] });
const application = new SceneApplicationService(repository, [provider, mail], authorize);
const runtime = new SceneExecutionService(repository, [provider, mail], { execute: async ({ evidence, template }) => ({
  kind: 'artifact', summary: template.key === familyPlanTemplate.key ? '周六准备家庭午餐，周日留给休息。' : '跟进草稿：请确认下周评审时间。', evidenceIds: evidence.map((item) => item.id),
}) }, authorize);
const app = new Hono();
app.use(auth({ getResolvedAuth: () => ({ mode: 'token', token: 'isolated-scene-smoke', allowTailscale: false }) }));
app.use(gatewayScopes());
const pass = async (_c, next) => { await next(); };
registerAuthenticatedLazyRouteFallback(app, { service: { currentWorkspacePath: 'smoke-workspace' } as never,
  strictRateLimitMiddleware: pass, chatRateLimitMiddleware: pass, xopcCloudPollRateLimitMiddleware: pass,
  scenes: { repository, application, inbox: new SceneInboxService(db), mail: new SceneMailContextProvider(db), mailDiscovery: {
    listAccounts: () => [{ id: 'personal', label: 'Test Gmail' }],
    searchSources: async (principal) => new SceneMailContextProvider(db).listSources(principal),
  }, browser: new BrowserSubscriptionService(db), preferences: new ScenePreferenceService(db), metrics: new SceneMetrics(db) } });
const http = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: 0 });
await new Promise<void>((resolve) => http.once('listening', resolve));
const target = `http://127.0.0.1:${(http.address() as AddressInfo).port}`;
let server;
let browser;
try {
  server = await createServer({ configFile: join(root, 'vite.config.ts'), root,
    server: { host: '127.0.0.1', port: 0, open: false, proxy: { '/api': { target }, '/api/scenes': { target } } } });
  await server.listen();
  browser = await chromium.launch({ executablePath: process.env.XOPC_SCENES_SMOKE_BROWSER ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
  const page = await browser.newPage({ viewport: { width: 1024, height: 900 } });
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  let dropCreateResponse = true;
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (!path.startsWith('/api/scenes')) return route.fulfill({ status: 404, json: { error: 'outside_fixture' } });
    const headers = { ...route.request().headers(), authorization: 'Bearer isolated-scene-smoke' };
    if (path === '/api/scenes/activations' && route.request().method() === 'POST' && dropCreateResponse) {
      dropCreateResponse = false;
      const response = await route.fetch({ headers });
      assert.equal(response.status(), 201);
      return route.abort('failed');
    }
    return route.continue({ headers });
  });
  await page.goto(`${server.resolvedUrls.local[0]}smoke/scenes.html#/scenes`);
  await page.locator('article').filter({ has: page.getByRole('heading', { name: familyPlanTemplate.title }) }).getByRole('link', { name: '了解并开启' }).click();
  await page.getByLabel('希望它持续帮你做好什么？').fill('让家庭安排更轻松，留出休息时间');
  await page.getByRole('dialog', { name: '了解并开启', exact: true }).waitFor();
  page.once('dialog', dialog => void dialog.dismiss());
  await page.keyboard.press('Escape');
  assert.equal(await page.getByLabel('希望它持续帮你做好什么？').inputValue(), '让家庭安排更轻松，留出休息时间');

  await page.getByLabel('确认以上范围，允许读取我提供的资料。').check();
  await page.getByRole('button', { name: '继续设置', exact: true }).click();
  await page.getByRole('alert').waitFor();
  assert.equal(await page.getByLabel('希望它持续帮你做好什么？').inputValue(), '让家庭安排更轻松，留出休息时间');
  await page.getByRole('button', { name: '继续设置', exact: true }).click();
  await page.getByRole('heading', { name: '让家庭安排更轻松，留出休息时间', exact: true }).waitFor();
  assert.equal(repository.listActivations({ ownerId: 'local-owner', workspaceId: 'smoke-workspace' }).filter((item) => item.templateKey === familyPlanTemplate.key).length, 1);
  await page.getByText('完成以下设置后，场景才会自动检查', { exact: true }).waitFor();
  await page.getByLabel('你愿意提供的安排和约束').fill('周六中午家庭午餐，周日不安排活动。');
  const detailDialog = page.getByRole('dialog', { name: '场景详情', exact: true });
  await detailDialog.waitFor();
  const beforeScroll = await detailDialog.boundingBox();
  await detailDialog.locator('div.overflow-y-auto').evaluate(element => { element.scrollTop = element.scrollHeight; });
  assert.deepEqual(await detailDialog.boundingBox(), beforeScroll, 'Detail modal size stays fixed while scrolling');
  await page.getByRole('button', { name: '关闭场景详情' }).waitFor({ state: 'visible' });
  page.once('dialog', dialog => void dialog.dismiss());
  await page.keyboard.press('Escape');
  await detailDialog.waitFor();
  assert.equal(await page.getByLabel('你愿意提供的安排和约束').inputValue(), '周六中午家庭午餐，周日不安排活动。');

  await page.getByRole('button', { name: '保存资料', exact: true }).click();
  await page.waitForFunction(() => [...document.querySelectorAll('button')].some((button) => button.textContent === '保存资料' && button.disabled));
  await page.getByRole('button', { name: '设置时间', exact: true }).click();
  await page.getByLabel('时区（例如 Asia/Shanghai）').fill('Asia/Shanghai');
  await page.getByRole('button', { name: '保存时间', exact: true }).click();
  await page.getByRole('button', { name: '修改时间', exact: true }).waitFor();
  await page.getByText('完成以下设置后，场景才会自动检查', { exact: true }).waitFor({ state: 'detached' });
  await page.getByRole('button', { name: '现在检查', exact: true }).click();
  await page.getByRole('status').waitFor();
  assert.equal(await runtime.runNext('smoke'), 'completed');
  await page.getByText('周六准备家庭午餐，周日留给休息。', { exact: true }).waitFor();
  await page.getByRole('link', { name: '查看场景资料', exact: true }).waitFor();
  await page.getByRole('button', { name: '对我有帮助', exact: true }).click();
  await page.getByRole('button', { name: '对我有帮助', pressed: true }).waitFor();
  const familyUrl = page.url();
  await page.getByRole('button', { name: '关闭场景详情' }).click();
  await page.locator('[data-scene-id]').first().click();
  await page.getByRole('dialog', { name: '场景详情', exact: true }).waitFor();
  await page.goBack();
  await page.getByRole('dialog', { name: '场景详情', exact: true }).waitFor({ state: 'detached' });

  await page.getByRole('link', { name: '查看全部成果' }).click();
  await page.getByRole('heading', { name: '场景成果', exact: true }).waitFor();
  await page.getByRole('dialog', { name: '场景成果', exact: true }).waitFor();
  await page.keyboard.press('Escape');
  await page.getByRole('dialog').waitFor({ state: 'detached' });
  await page.getByRole('link', { name: '查看全部成果' }).click();
  await page.getByRole('dialog', { name: '场景成果', exact: true }).waitFor();

  await page.waitForFunction(() => document.querySelector('dl dd')?.textContent === '1');
  await page.getByRole('button', { name: '没有帮助', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('dl dd')?.textContent === '0' && document.querySelectorAll('dl dd')[1]?.textContent === '1');
  await page.getByRole('button', { name: '标为已读', exact: true }).click();
  await page.getByRole('button', { name: '标为未读', exact: true }).waitFor();
  assert.equal(await page.locator('dl dd').first().textContent(), '0');
  await page.getByRole('button', { name: '对我有帮助', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('dl dd')?.textContent === '1');
  await page.getByRole('link', { name: '查看所属场景' }).click();
  assert.equal(page.url(), familyUrl);
  await page.getByRole('link', { name: '返回成果', exact: true }).click();
  await page.getByRole('dialog', { name: '场景成果', exact: true }).waitFor();
  await page.getByRole('link', { name: '查看所属场景' }).click();
  assert.equal(page.url(), familyUrl);

  await page.getByLabel('你愿意提供的安排和约束').waitFor();
  await page.getByLabel('你愿意提供的安排和约束').fill('保留我的未保存修改');
  const active = repository.listActivations({ ownerId: 'local-owner', workspaceId: 'smoke-workspace' })
    .find((activation) => activation.templateKey === familyPlanTemplate.key);
  assert.ok(active);
  application.writeNotes(active, active.id, { expectedRevision: 1, content: '另一窗口已修改安排' });
  await page.getByRole('button', { name: '保存资料', exact: true }).click();
  await page.getByRole('alert').waitFor();
  assert.equal(await page.getByLabel('你愿意提供的安排和约束').inputValue(), '保留我的未保存修改');
  await page.getByRole('button', { name: '放弃修改并重新加载', exact: true }).click();
  await page.getByLabel('你愿意提供的安排和约束').filter({ visible: true }).waitFor();
  await page.waitForFunction(() => [...document.querySelectorAll('textarea')].some((input) => input.value === '另一窗口已修改安排'));
  await page.getByLabel('你愿意提供的安排和约束').fill('周六中午家庭午餐，周日不安排活动。');
  await page.getByRole('button', { name: '保存资料', exact: true }).click();
  await page.waitForFunction(() => [...document.querySelectorAll('button')].some((button) => button.textContent === '保存资料' && button.disabled));
  await page.getByRole('button', { name: '现在检查', exact: true }).click();
  await page.getByRole('status').waitFor();
  assert.equal(await runtime.runNext('smoke-after-edit'), 'completed');
  await page.getByText('周六准备家庭午餐，周日留给休息。', { exact: true }).waitFor();
  await page.getByRole('button', { name: '标为已读', exact: true }).click();
  await page.getByRole('button', { name: '标为未读', exact: true }).waitFor();
  await page.getByRole('button', { name: '暂停场景', exact: true }).click();
  await page.getByRole('button', { name: '检查设置并恢复', exact: true }).waitFor();
  assert.equal(await page.getByRole('button', { name: '现在检查', exact: true }).isDisabled(), true);
  const screenshots = await mkdtemp(join(tmpdir(), 'xopc-scenes-smoke-'));
  await page.screenshot({ path: join(screenshots, 'desktop.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: join(screenshots, 'mobile.png'), fullPage: true });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'Mobile overflow');
  await page.getByRole('button', { name: '关闭场景详情' }).click();
  await page.locator('article').filter({ has: page.getByRole('heading', { name: mailFollowUpTemplate.title }) }).getByRole('link', { name: '了解并开启' }).click();
  await page.getByLabel('希望它持续帮你做好什么？').fill('确认评审日期');
  await page.getByLabel('主题、发件人或 Gmail 搜索条件').fill('评审');
  await page.getByRole('button', { name: '搜索邮件', exact: true }).click();
  await page.getByRole('button', { name: '要跟进的邮件' }).click();
  await page.getByText('确认评审时间 · colleague@example.test', { exact: true }).click();
  await page.getByLabel('确认以上范围，允许读取我提供的资料。').check();
  await page.getByRole('button', { name: '继续设置', exact: true }).click();
  await page.getByRole('button', { name: '设置跟进时间', exact: true }).click();
  const due = new Date(Date.now() + 86400000);
  await page.getByLabel('跟进时间（当前设备时区）').fill(new Date(due.getTime() - due.getTimezoneOffset() * 60000).toISOString().slice(0, 16));
  await page.getByRole('button', { name: '保存跟进时间', exact: true }).click();
  await page.getByRole('button', { name: '暂停这次跟进', exact: true }).waitFor();
  await page.getByRole('button', { name: '现在检查', exact: true }).click();
  await page.getByRole('status').waitFor();
  assert.equal(await runtime.runNext('smoke-mail'), 'completed');
  await page.getByText('跟进草稿：请确认下周评审时间。', { exact: true }).waitFor();
  await page.getByRole('button', { name: '结束这次跟进', exact: true }).click();
  await page.getByText('已结束跟进', { exact: false }).waitFor();
  await page.getByText('跟进草稿：请确认下周评审时间。', { exact: true }).waitFor({ state: 'detached' });
  assert.equal(await page.getByRole('button', { name: '重新设置跟进时间' }).count(), 0);
  await page.screenshot({ path: join(screenshots, 'mail-mobile.png'), fullPage: true });
  await page.getByRole('button', { name: '关闭场景详情' }).click();
  await page.getByRole('link', { name: '查看全部成果' }).click();
  await page.getByRole('heading', { name: '场景成果', exact: true }).waitFor();
  await page.setViewportSize({ width: 375, height: 812 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.screenshot({ path: join(screenshots, 'inbox-mobile.png'), fullPage: true });
  await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
  await page.evaluate(() => { document.documentElement.classList.add('dark'); document.documentElement.dataset.theme = 'dark'; });
  await page.waitForFunction(() => getComputedStyle(document.querySelector('main')!).backgroundColor === 'rgb(27, 31, 38)');
  await page.screenshot({ path: join(screenshots, 'inbox-dark.png'), fullPage: true });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'Inbox mobile overflow');
  await page.route('**/api/scenes/metrics', (route) => route.fulfill({ status: 500, json: { error: 'test_metrics_failure' } }));
  await page.reload();
  await page.getByText('暂时无法加载统计，仍可查看和评价成果。', { exact: true }).waitFor();
  await page.getByRole('button', { name: '对我有帮助', exact: true }).waitFor();
  await page.unroute('**/api/scenes/metrics');
  await page.getByRole('button', { name: '重新加载统计' }).click();
  await page.locator('dl').waitFor();
  assert.deepEqual(errors, []);
  await page.route('**/api/scenes/**', (route) => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'scene_runtime_not_installed' }) }));
  const smokeUrl = page.url().split('#')[0];
  for (const path of ['/scenes', '/scenes/inbox', '/scenes/new/mail-follow-up', '/scenes/unavailable-activation']) {
    await page.goto('about:blank');
    await page.goto(`${smokeUrl}#${path}`);
    await page.getByRole('heading', { name: '场景尚未开放' }).first().waitFor();
    assert.equal(await page.getByRole('button', { name: '重新加载' }).count(), 0);
    assert.equal(await page.getByRole('button', { name: '继续设置', exact: true }).count(), 0);
    assert.ok(await page.getByRole('link', { name: '返回对话' }).count());
  }
  console.log(JSON.stringify({ passed: true, screenshots, checks: ['results modal and return from scene', 'create modal preserves unsaved input', 'fixed detail modal', 'Escape preserves unsaved edits', 'browser back closes modal', 'start response loss retry', 'notes conflict preservation', 'schedule', 'manual run', 'feedback', 'inbox', 'feedback stats corrections', 'stats failure recovery', 'read', 'pause', 'mail picker', 'deadline', 'mail draft', 'end follow-up', 'mobile bounds', 'disabled list/inbox/create/detail entry points'] }));
} finally {
  await browser?.close(); await server?.close();
  http.closeAllConnections();
  await new Promise<void>((resolve, reject) => http.close((error) => error ? reject(error) : resolve()));
  db.close();
}
