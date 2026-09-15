// Smoke-test production meeting components against an isolated gateway fixture.
import { chromium } from 'playwright-core';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
const root = fileURLToPath(new URL('../web', import.meta.url));
const require = createRequire(new URL('../web/package.json', import.meta.url));
const { createServer } = await import(require.resolve('vite'));
process.chdir(root);
const dir = await mkdtemp(root + '/.meeting-smoke-');
let browser, server;
try {
  await writeFile(dir + '/index.html', '<html><meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div><script type="module" src="./main.jsx"></script></html>');
  await writeFile(dir + '/main.jsx', `import React from 'react';import{createRoot}from'react-dom/client';import{MemoryRouter}from'react-router-dom';import{DiscussionNoteSections}from'/src/features/discussions/discussion-note-sections';import{useLocaleStore}from'/src/stores/locale-store';import'/src/styles/globals.css';useLocaleStore.setState({language:'zh'});createRoot(document.getElementById('root')).render(<MemoryRouter><div style={{height:'100dvh'}}><DiscussionNoteSections noteId="note1"/></div></MemoryRouter>);`);
  server = await createServer({ configFile: root + '/vite.config.ts', root, server: { port: 3018, strictPort: true, open: false } });
  await server.listen();
  browser = await chromium.launch({ executablePath: process.env.XOPC_VOICE_SMOKE_BROWSER || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
  const page = await browser.newPage({ viewport: { width: 1024, height: 900 } });
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  const segment = { sequence: 0, revision: 1, startedAtMs: 0, endedAtMs: 6000, status: 'confirmed', displayText: '周五发布，由小王准备。', speakerLabel: '小王' };
  const original = structuredClone(segment);
  const detail = { discussion: { id: 'meeting1', noteId: 'note1', status: 'completed', durationMs: 6000, canonicalTranscript: segment.displayText }, transcript: { revision: 1, segments: [segment] }, organization: { revision: 1, transcriptRevision: 1, organization: { title: '发布评审', summary: '确定周五发布。', keyPoints: [], decisions: [{ id: 'decision1', text: '周五发布', evidenceSegmentIds: [0] }], actionItems: [{ id: 'action1', title: '准备发布', owner: '小王', evidenceSegmentIds: [0] }], risks: [], openQuestions: [], chapters: [] } } };
  const tasks = []; let conversions = 0;
  await page.route('**/api/**', async route => {
    const url = new URL(route.request().url()); let payload = detail;
    if (url.pathname.endsWith('/actions')) payload = tasks;
    if (url.pathname.endsWith('/transcript')) payload = { revision: 1, segments: [original] };
    if (url.pathname.endsWith('/convert')) { conversions++; tasks.push({ actionId: 'action1', taskId: 'task1', deleted: false }); payload = tasks[0]; }
    if (route.request().method() === 'PATCH' && url.pathname.includes('/segments/')) { const body = route.request().postDataJSON(); Object.assign(segment, { displayText: body.displayText, speakerLabel: body.speakerLabel, revision: 2 }); detail.transcript.revision = 2; payload = detail.transcript; }
    if (route.request().method() === 'PATCH' && url.pathname.endsWith('/summary')) { const body = route.request().postDataJSON(); detail.organization.organization.summary = body.text; detail.organization.organization.summaryEditedByUser = true; detail.organization.revision++; payload = detail.organization; }
    await route.fulfill({ json: payload });
  });
  await page.goto('http://localhost:3018/' + dir.split('/').at(-1) + '/index.html');
  await page.getByRole('button', { name: '加入我的任务', exact: true }).click();
  await page.getByRole('link', { name: '查看任务 / 交给助手', exact: true }).waitFor();
  if (conversions !== 1) throw Error('Task conversion was repeated');
  await page.getByRole('button', { name: '编辑概要', exact: true }).click();
  await page.getByRole('dialog').locator('textarea').fill('人工概要：先完成测试，再发布。');
  await page.getByRole('button', { name: '保存修改', exact: true }).click();
  await page.getByText('人工概要：先完成测试，再发布。', { exact: true }).waitFor();
  await page.getByRole('button', { name: '原话', exact: true }).click();
  await page.getByLabel('原话证据').getByText(original.displayText).waitFor();
  await page.getByRole('button', { name: '关闭', exact: true }).click();
  await page.getByRole('button', { name: '逐字稿', exact: true }).click();
  await page.getByRole('button', { name: '校对', exact: true }).click();
  await page.getByRole('dialog').locator('textarea').fill('周五发布，由小李准备。');
  await page.getByLabel('本段说话人').fill('小李');
  await page.getByRole('button', { name: '保存修订', exact: true }).click();
  await page.getByText('周五发布，由小李准备。', { exact: true }).waitFor();
  await page.getByPlaceholder('查找原话或说话人').fill('不存在');
  if (await page.getByRole('button', { name: '校对', exact: true }).count()) throw Error('Search did not filter');
  await page.getByRole('button', { name: '纪要与行动', exact: true }).click();
  await page.getByRole('button', { name: '原话', exact: true }).click();
  await page.getByLabel('原话证据').getByText(original.displayText).waitFor();
  await page.screenshot({ path: '/tmp/xopc-meeting-desktop.png', fullPage: true });
  await page.getByRole('button', { name: '关闭', exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: '/tmp/xopc-meeting-mobile.png', fullPage: true });
  if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)) throw Error('Meeting view overflows mobile');
  if (errors.length) throw Error(errors.join('\n'));
  console.log(JSON.stringify({ passed: true, checks: ['task conversion', 'historical evidence', 'atomic text/speaker edit', 'manual summary edit', 'transcript search', 'mobile bounds'] }));
} finally { await browser?.close(); await server?.close(); await rm(dir, { recursive: true, force: true }); }
