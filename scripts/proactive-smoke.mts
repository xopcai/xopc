/** Runs the real authenticated HTTP stack with an isolated database and no background services. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { serve } from '@hono/node-server';

const root = mkdtempSync(join(tmpdir(), 'xopc-proactive-smoke-'));
const workspace = join(root, 'workspace');
mkdirSync(workspace);
process.env.XOPC_STATE_DIR = root;
process.env.XOPC_WORKSPACE = workspace;
process.env.XOPC_CONFIG_PATH = join(root, 'xopc.json');
process.env.XOPC_CONFIG = process.env.XOPC_CONFIG_PATH;
process.env.XOPC_LOG_LEVEL = 'fatal';
const { ConfigSchema } = await import('../src/config/schema.js');
const token = randomUUID();
writeFileSync(process.env.XOPC_CONFIG_PATH, JSON.stringify(ConfigSchema.parse({ gateway: { auth: { mode: 'token', token } } })));
const { openXopcDatabase, closeXopcDatabase } = await import('../src/storage/sqlite/index.js');
openXopcDatabase({ path: join(root, 'xopc.db') });
const { GatewayService } = await import('../src/gateway/service.js');
const { createHonoApp } = await import('../src/gateway/hono/app.js');
const service = new GatewayService({ configPath: process.env.XOPC_CONFIG_PATH, enableHotReload: false });
const server = serve({ fetch: createHonoApp({ service }).fetch, port: 0, hostname: '127.0.0.1' });
await new Promise<void>((resolve) => server.once('listening', resolve));
const address = server.address();
assert(address && typeof address !== 'string');
const origin = `http://127.0.0.1:${address.port}`;
const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
async function request(path: string, method = 'GET', body?: unknown, status = 200) {
  const response = await fetch(origin + path, { method, headers, ...(body ? { body: JSON.stringify(body) } : {}) });
  const result = await response.json();
  assert.equal(response.status, status, `${path}: ${JSON.stringify(result)}`);
  return result;
}
function cleanup(code = 0) {
  server.closeAllConnections();
  server.close(() => {
    closeXopcDatabase();
    rmSync(root, { recursive: true, force: true });
    process.exit(code);
  });
}
process.once('SIGINT', () => cleanup());
process.once('SIGTERM', () => cleanup());
try {
  assert.equal((await fetch(`${origin}/api/proactive/templates`)).status, 401);
  for (const path of ['/api/proactive/metrics', '/api/proactive/web-push/probes', '/api/proactive/templates', '/api/proactive/preferences', '/api/proactive/subscriptions', '/api/proactive/cards', '/api/inbox/judgments/changes?cursor=0']) await request(path);
  const { subscription } = await request('/api/proactive/subscriptions', 'POST', { scenarioKey: 'automation_failure_impact', scopeKind: 'workspace', scopeId: 'current', delivery: 'inbox' }, 201);
  await request(`/api/proactive/subscriptions/${subscription.id}`, 'PATCH', { expectedRevision: 1, level: 'quiet' });
  await request(`/api/proactive/subscriptions/${subscription.id}`, 'PATCH', { expectedRevision: 1, level: 'active' }, 409);
  await request(`/api/proactive/subscriptions/${subscription.id}/runs`);
  assert.equal((await request(`/api/proactive/subscriptions/${subscription.id}/preview`, 'POST', {})).result.reason, 'source_unavailable');
  await request('/api/proactive/presence', 'POST', { clientId: 'http-smoke-browser', active: false, surface: 'web' });
  await request('/api/proactive/digests/missing', 'GET', undefined, 400);
  await request('/api/proactive/web-push/subscriptions/missing/test', 'POST', {}, 400);
  await request('/api/proactive/web-push/probes/missing/opened', 'POST', {});
  await request('/api/proactive/preferences', 'PATCH', { expectedRevision: 0, timezone: 'invalid' }, 400);
  assert.equal(typeof (await request('/api/proactive/web-push/prepare', 'POST', {})).publicKey, 'string');
  await request('/api/proactive/web-push/subscriptions', 'POST', { subscription: { endpoint: 'https://localhost/private' } }, 400);
  const { id: pushId } = await request('/api/proactive/web-push/subscriptions', 'POST', { subscription: { endpoint: 'https://fcm.googleapis.com/fcm/send/smoke-test', keys: { auth: 'a'.repeat(22), p256dh: 'a'.repeat(87) } } }, 201);
  await request(`/api/proactive/web-push/subscriptions/${pushId}`, 'DELETE');

  const { ProjectService } = await import('../src/projects/index.js');
  const { createControlledSubscription } = await import('../src/proactive/scenarios/control.js');
  const { scanDueProjects } = await import('../src/proactive/temporal/schedule.js');
  const { ProactiveWorker } = await import('../src/proactive/execution/worker.js');
  const project = new ProjectService().create({ name: '客户评审准备' });
  createControlledSubscription(workspace, { scenarioKey: 'project_delivery_risk', scopeKind: 'project', scopeId: project.id, delivery: 'digest' });
  scanDueProjects(service.proactive);
  service.proactive.markReadyBatches(new Date(Date.now() + 600000));
  const worker = new ProactiveWorker({ execute: async () => ({ text: JSON.stringify({
    title: '客户评审材料需要确认', summary: '评审前需要确认演示材料的负责人和完成时间。', whyNow: '项目进入准备阶段，可以提前安排跟进。',
    impact: '客户评审准备', recommendation: '建立一个待办，确认评审材料。', workDone: '已检查测试项目。此卡片由本地固定样例生成。',
    urgency: 'high', confidence: 0.95, evidenceIds: [`project:${project.id}`],
    decision: { question: '创建材料确认任务？', options: [{ id: 'approve', label: '创建任务', consequence: '创建一个待办任务，由你安排执行。' }, { id: 'reject', label: '暂不创建', consequence: '保留现有安排。' }] },
    proposedAction: { id: 'create_project_task', risk: 'low', rationale: '需要明确准备事项。', input: { title: '确认客户评审材料', objective: '确认评审材料的负责人和完成时间。' } },
  }) }) });
  await worker.tick();
  service.proactiveInbox.project();
  const cards = await request('/api/proactive/cards');
  assert.equal(cards.cards.length, 1);
  const card = cards.cards[0];
  await request('/api/proactive/preferences', 'PATCH', { expectedRevision: 0, quietStartHour: 0, quietEndHour: 0 });
  const { queueDigest, flushDueDigests } = await import('../src/proactive/inbox/digest.js');
  const { getInboxItem } = await import('../src/proactive/inbox/repository.js');
  const { NotificationService } = await import('../src/notifications/service.js');
  queueDigest(getInboxItem(card.id)!, 'daily', new Date(Date.now() - 60000));
  const notificationService = new NotificationService({ publish: () => {} });
  const [digest] = flushDueDigests((plan) => notificationService.persistPlan(plan));
  assert(digest?.target.kind === 'proactive_digest');
  assert.equal((await request(`/api/proactive/digests/${digest.target.digestId}`)).cards.length, 1);
  await request(`/api/inbox/judgments/${card.id}`);
  assert.equal((await request(`/api/inbox/judgments/${card.id}/workflow`)).workflow, null);
  await request(`/api/inbox/judgments/${card.id}/prepare`, 'POST', { expectedRevision: card.revision }, 400);
  const action = { actionId: 'read', expectedRevision: card.revision, idempotencyKey: randomUUID() };
  const read = await request(`/api/inbox/judgments/${card.id}/actions`, 'POST', action);
  assert.equal(read.card.status, 'read');
  assert.equal((await request(`/api/inbox/judgments/${card.id}/actions`, 'POST', action)).card.revision, read.card.revision);
  await request(`/api/inbox/judgments/${card.id}/actions`, 'POST', { ...action, actionId: 'resolve', idempotencyKey: randomUUID() }, 409);
  if (process.env.PROACTIVE_SMOKE_KEEP === '1') {
    console.log(JSON.stringify({ origin, root, token, cardId: card.id, checks: 'passed; waiting for UI inspection; no model or external notification calls' }));
  } else {
    console.log('Proactive authenticated HTTP smoke checks passed. No model or external notification calls.');
    cleanup();
  }
} catch (error) {
  console.error(error);
  cleanup(1);
}
