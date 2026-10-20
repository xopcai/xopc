/** Explicit opt-in acceptance using the running local Gateway and its configured model. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

import type { Browser } from 'playwright-core';

assert.equal(process.env.XOPC_CONVERSATION_LIVE, '1', 'Set XOPC_CONVERSATION_LIVE=1 to create real local test conversations and use the configured model.');
const { chromium } = createRequire(import.meta.url)('playwright-core') as typeof import('playwright-core');
const config = JSON.parse(await readFile(process.env.XOPC_CONFIG_PATH ?? join(homedir(), '.xopc/xopc.json'), 'utf8'));
const base = `http://127.0.0.1:${config.gateway?.port ?? 18790}`;
const evidence = resolve(process.env.XOPC_CONVERSATION_LIVE_EVIDENCE ?? '/tmp/xopc-conversation-launch-live');
await mkdir(evidence, { recursive: true });
const request = async (path: string, method = 'GET', data?: unknown): Promise<any> => {
  const response = await fetch(base + path, { method, headers: { Authorization: `Bearer ${config.gateway.auth.token}`, 'Content-Type': 'application/json' },
    ...(data === undefined ? {} : { body: JSON.stringify(data) }), signal: AbortSignal.timeout(20000) });
  const body = await response.json(); assert(response.ok, `${path}: HTTP ${response.status} ${JSON.stringify(body)}`); return body.payload ?? body;
};
const catalog = await request('/api/agents');
const agentId = catalog.defaultId ?? 'main';
const agent = catalog.agents.find((item: any) => item.id === agentId);
assert(agent, 'Default agent is unavailable');
const model = agent.effective.models.chat.primary;
const availableModels = await request('/api/models');
const modelInfo = availableModels.models.find((item: any) => item.id === model);
assert(modelInfo, 'Configured model is unavailable');
const thinkingLevel = agent.effective.runtime.thinkingLevel ?? modelInfo.thinking.initialValue;
const stamp = randomUUID().slice(0, 8);
const projectA = (await request('/api/projects', 'POST', { name: `E2E launch A ${stamp}`, defaultAgentId: agentId })).project;
const projectB = (await request('/api/projects', 'POST', { name: `E2E launch B ${stamp}`, defaultAgentId: agentId })).project;
const scenarios = [
  { id: 'plain', sourceProject: null, expectedProject: null, request: '创建一个普通的新对话，不指定项目' },
  { id: 'inherit', sourceProject: projectA.id, expectedProject: projectA.id, request: '在当前项目创建一个新对话' },
  { id: 'outside', sourceProject: projectA.id, expectedProject: null, request: '创建一个不属于任何项目的新对话' },
  { id: 'specified', sourceProject: null, expectedProject: projectB.id, request: `在项目“${projectB.name}”（ID: ${projectB.id}）创建一个新对话` },
];
let browser: Browser | undefined;
const report = { passed: false, base, model, stamp, projects: [projectA.id, projectB.id], cases: [] as unknown[], error: '' };
try {
  browser = await chromium.launch({ channel: process.env.XOPC_E2E_BROWSER_CHANNEL ?? 'chrome', headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: 'en-US', reducedMotion: 'reduce' });
  await context.addInitScript(({ token }) => { localStorage.setItem('xopc.token', token); localStorage.setItem('xopc.language', 'en'); }, { token: config.gateway.auth.token });
  const page = await context.newPage(); page.setDefaultTimeout(90000);
  for (const scenario of scenarios) {
    const sourceId = randomUUID();
    await request(`/api/sessions/${sourceId}/materialize`, 'POST', { commandId: randomUUID(), purpose: 'session_resources',
      creation: { agentId, model, thinkingLevel, projectId: scenario.sourceProject, execution: null, temporary: false } });
    await request(`/api/sessions/${sourceId}`, 'PATCH', { name: `E2E ${scenario.id} ${stamp}` });
    await request('/api/chat/workspace-trust', 'PATCH', { conversationId: sourceId, trusted: true });
    console.log(JSON.stringify({ stage: 'live source', scenario: scenario.id, sourceId }));
    await page.goto(`${base}/#/chat/${sourceId}`);
    const composer = page.locator('[contenteditable="true"]').first();
    await composer.waitFor();
    const firstMessage = `hello LIVE_${scenario.id}_${stamp}`;
    await composer.fill(`这是会话创建功能的端到端测试。请${scenario.request}，对话标题为“E2E child ${scenario.id} ${stamp}”，首条消息严格发送：\n${firstMessage}\n请实际创建并发送，不要只描述操作，也不要创建 Task。`);
    await page.getByRole('button', { name: 'Send', exact: true }).click();
    const card = page.locator('[data-product-delivery="session"]').first();
    await card.waitFor();
    await page.screenshot({ path: join(evidence, `${scenario.id}-card.png`) });
    await card.locator('button').first().click();
    await page.waitForURL(/#\/chat\/[0-9a-f-]{36}$/);
    const targetId = page.url().split('#/chat/')[1]!;
    assert.notEqual(targetId, sourceId);
    const target = (await request(`/api/sessions/${targetId}?include=transcriptRows`)).session;
    assert.equal(target.projectId ?? null, scenario.expectedProject);
    assert.equal((await request(`/api/sessions/${sourceId}`)).session.projectId ?? null, scenario.sourceProject);
    const origin = page.locator('[data-conversation-origin] a');
    await origin.waitFor();
    assert.equal(await origin.getAttribute('href'), `#/chat/${sourceId}`);
    const row = page.locator('[data-chat-message-row]').filter({ has: page.locator('[data-conversation-origin]') });
    assert((await row.innerText()).includes(firstMessage));
    await page.reload();
    await page.locator('[data-conversation-origin] a').waitFor();
    await page.screenshot({ path: join(evidence, `${scenario.id}-origin.png`) });
    await page.locator('[data-conversation-origin] a').click();
    await page.waitForURL(`**/#/chat/${sourceId}`);
    const startedAt = Date.now();
    let snapshot;
    while (Date.now() - startedAt < 120000) {
      snapshot = (await request(`/api/sessions/${sourceId}/launched-conversations?ids=${targetId}`)).items?.[0];
      if (snapshot?.status === 'completed' && snapshot.summary) break;
      assert(!['failed', 'preparation_failed', 'cancelled', 'unavailable'].includes(snapshot?.status), JSON.stringify(snapshot));
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    assert.equal(snapshot?.status, 'completed', JSON.stringify(snapshot));
    assert(snapshot.summary);
    await card.getByText(snapshot.summary, { exact: false }).waitFor();
    await page.screenshot({ path: join(evidence, `${scenario.id}-completed.png`) });
    const result = { scenario: scenario.id, sourceId, targetId, projectId: scenario.expectedProject, firstMessage, status: snapshot.status, passed: true };
    report.cases.push(result); console.log(JSON.stringify(result));
  }
  report.passed = true;
} catch (error) {
  report.error = String(error);
  if (browser) for (const context of browser.contexts()) for (const page of context.pages()) {
    await page.screenshot({ path: join(evidence, 'failure.png') }).catch(() => {});
    await writeFile(join(evidence, 'failure.html'), await page.content()).catch(() => {});
  }
  throw error;
} finally {
  await writeFile(join(evidence, 'result.json'), JSON.stringify(report, null, 2));
  await browser?.close();
}
console.log(JSON.stringify({ ...report, evidence }));
