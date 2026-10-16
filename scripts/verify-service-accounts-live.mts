/** Real Gateway/browser acceptance. Set XOPC_VENDOR_E2E=1 for paid speech probes. */
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import playwright, { type JSHandle } from 'playwright-core';

const configPath = process.env.XOPC_CONFIG_PATH ?? join(homedir(), '.xopc/xopc.json');
const original = JSON.parse(await readFile(configPath, 'utf8'));
const base = `http://127.0.0.1:${original.gateway.port}`;
const web = process.env.XOPC_WEB_E2E_URL ?? 'http://127.0.0.1:3000/';
const headers = { Authorization: `Bearer ${original.gateway.auth.token}`, 'Content-Type': 'application/json' };
const directory = await mkdtemp(join(tmpdir(), 'xopc-service-accounts-live-'));
await writeFile(join(directory, 'baseline-private.json'), JSON.stringify(original), { mode: 0o600 });
const clean = (value: unknown) => String(value).replaceAll(original.gateway.auth.token, '[redacted]').replace(/sk-[\w.-]+/g, '[redacted]');
const equal = (left: unknown, right: unknown, message: string) => assert.ok(JSON.stringify(left) === JSON.stringify(right), message);
const request = async (path: string, method = 'GET', body?: unknown) => {
  const response = await fetch(base + path, { method, headers, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(30_000) });
  const data = await response.json();
  if (!response.ok || data.ok === false) throw new Error(`${path}: HTTP ${response.status}: ${clean(JSON.stringify(data.error ?? ''))}`);
  return data.payload ?? data;
};
const defaultsBefore = await request('/api/global-defaults');
const configBefore = (await request('/api/config')).config;
const plans = Object.fromEntries(await Promise.all(['qwen-token-plan-cn', 'xopc-cloud'].map(async provider => [provider, await request(`/api/models/setup/${provider}`)])));
assert.ok(Object.values(plans).every((plan: any) => plan.configured), 'Both saved services must be connected');
assert.ok(defaultsBefore.defaults.models.background.primary.startsWith('xopc-cloud/'), 'Background must initially use Cloud');
const report = { directory, passed: false, realGateway: true, realVendorRequests: process.env.XOPC_VENDOR_E2E === '1', checks: [] as string[], errors: [] as string[], error: '', credentialWritesBlocked: 0, authorizationAttemptsBlocked: 0 };
const browser = await playwright.chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
page.setDefaultTimeout(25_000);
page.on('pageerror', error => report.errors.push(clean(error.message)));
page.on('response', response => { if ([401, 403].includes(response.status())) console.log(JSON.stringify({ step: 'authentication-response', path: new URL(response.url()).pathname, status: response.status() })); });
const currentConfig = async () => (await request('/api/config')).config;
const currentModels = async () => (await request('/api/global-defaults')).defaults.models;
const wait = async (predicate: () => Promise<boolean>, message: string) => {
  for (let attempt = 0; attempt < 80; attempt++) { if (await predicate()) return; await page.waitForTimeout(150); }
  throw new Error(message);
};
const labels = { chat: '对话与任务', vision: '看图', transcription: '录音与听写', speech: '文字转语音', conversation: '实时语音对话', background: '自动与后台任务' };
type Use = keyof typeof labels;
const dialog = page.getByRole('dialog').first();
const servicesUrl = web + '#/settings/capabilities/models';
let scrollState: JSHandle<Array<{ element: HTMLElement; top: number }>> | undefined;
const entry = (use: Use) => page.locator(`[data-capability="${use}"]`).getByRole('button', { name: '管理服务', exact: true });
const open = async (use: Use, settings = false) => {
  console.log(JSON.stringify({ step: 'open', use, settings }));
  await entry(use).click({ trial: true });
  scrollState = await entry(use).evaluateHandle(element => {
    const positions: Array<{ element: HTMLElement; top: number }> = [];
    for (let parent = element.parentElement; parent; parent = parent.parentElement) positions.push({ element: parent, top: parent.scrollTop });
    return positions;
  });
  await entry(use).click();
  await dialog.getByRole('heading', { name: labels[use], exact: true }).waitFor();
  assert.equal(page.url(), servicesUrl);
  assert.equal(await dialog.getByRole('tab', { name: '管理服务', exact: true }).getAttribute('aria-selected'), 'true');
  if (settings) await dialog.getByRole('tab', { name: '模型与参数', exact: true }).click();
};
const close = async (use: Use, escape = false) => {
  console.log(JSON.stringify({ step: 'close', use, escape, dialogs: await page.getByRole('dialog').count(), done: await page.getByRole('button', { name: '完成', exact: true }).count() }));
  await wait(async () => dialog.getByRole('button', { name: '完成', exact: true }).isEnabled(), 'Save did not settle');
  if (escape) await page.keyboard.press('Escape'); else await dialog.getByRole('button', { name: '完成', exact: true }).click();
  await page.waitForFunction(use => document.activeElement?.textContent?.trim() === '管理服务' && document.activeElement?.closest('[data-capability]')?.getAttribute('data-capability') === use, use);
  assert.equal(page.url(), servicesUrl);
  assert.ok(await scrollState?.evaluate(positions => positions.every(({ element, top }) => Math.abs(element.scrollTop - top) <= 1)), 'Closing configuration changed the service page scroll');
  await scrollState?.dispose(); scrollState = undefined;
};
const chooseService = async (provider: string) => {
  await dialog.getByRole('button', { name: provider === 'xopc-cloud' ? /XOPC Cloud/ : /阿里云百炼订阅 · 北京/ }).click();
  await dialog.getByText('使用已有连接', { exact: true }).waitFor();
  assert.equal(await dialog.locator('#provider-setup-key').count(), 0);
};
const chooseModel = async (name: string) => {
  await dialog.getByRole('button', { name: '选择模型', exact: true }).click();
  await page.locator('[data-select-scroll-region]:visible').getByRole('button', { name, exact: true }).click();
};
const apply = async (use: Use, provider: string, model: string) => {
  const models = await currentModels();
  const voice = await currentConfig();
  await dialog.getByRole('button', { name: '使用此模型', exact: true }).click();
  await wait(async () => await dialog.getByRole('tab', { name: '模型与参数', exact: true }).getAttribute('aria-selected') === 'true', 'Apply did not return to model settings');
  const updated = await currentModels();
  equal(updated.background, defaultsBefore.defaults.models.background, 'Background route changed');
  if (use === 'chat' || use === 'vision') {
    assert.equal(updated[use === 'chat' ? 'chat' : 'imageUnderstanding'].primary, model);
    equal(updated[use === 'chat' ? 'imageUnderstanding' : 'chat'], models[use === 'chat' ? 'imageUnderstanding' : 'chat'], 'An unrelated language route changed');
    equal(updated.imageGeneration, models.imageGeneration, 'Image generation route changed');
    equal((await currentConfig()).voiceSettingsRevisions, voice.voiceSettingsRevisions, 'Language setup changed voice configuration');
  } else {
    equal(updated, models, 'Voice setup changed language models');
    const saved = await currentConfig();
    const field = use === 'speech' ? 'tts' : 'stt';
    assert.equal(saved[field].provider, provider);
    assert.equal(saved[field].providers[provider].model, model.slice(provider.length + 1));
    assert.equal(saved[field].fallback.enabled, false);
    equal(saved[use === 'speech' ? 'stt' : 'tts'], voice[use === 'speech' ? 'stt' : 'tts'], 'Voice setup changed the other voice capability');
  }
  assert.equal(page.url(), servicesUrl);
};
try {
  await page.addInitScript(() => localStorage.setItem('xopc.language', 'zh'));
  await page.route('**/api/**', route => {
    const url = new URL(route.request().url());
    const method = route.request().method();
    if (url.pathname === '/api/config' && method === 'PATCH' && route.request().postDataJSON()?.providers) { report.credentialWritesBlocked++; return route.abort(); }
    if (/\/oauth\//.test(url.pathname) && method === 'POST') { report.authorizationAttemptsBlocked++; return route.abort(); }
    return route.continue({ headers: [new URL(web).origin, new URL(base).origin].includes(url.origin) ? { ...route.request().headers(), Authorization: headers.Authorization } : route.request().headers() });
  });
  await page.goto(servicesUrl);
  await page.waitForURL(servicesUrl);
  await entry('chat').waitFor();
  assert.equal(await page.getByText('按能力接入服务', { exact: true }).count(), 0);
  assert.equal(await page.getByText('可选能力', { exact: true }).count(), 0);
  assert.equal(await page.locator('[data-capability]').count(), 7);
  report.checks.push('One page has exactly seven capability rows and no duplicate configuration list');
  await page.getByRole('heading', { name: '连接的服务', exact: true }).waitFor();
  await page.getByRole('button', { name: '服务账户', exact: true }).click();
  assert.equal(page.url(), servicesUrl);
  assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('aria-labelledby')), 'model-services-heading');
  const account = page.locator('section[aria-labelledby="model-services-heading"]').getByRole('button', { name: /Bailian Subscription|百炼订阅/ });
  await account.click();
  await page.locator('[role="dialog"][data-state="open"]').waitFor();
  await page.keyboard.press('Escape');
  await account.waitFor();
  await wait(async () => account.evaluate(element => document.activeElement === element), 'Account dialog did not return focus');
  assert.equal(page.url(), servicesUrl);
  report.checks.push('Service account shortcut scrolls and focuses in place; saved Bailian account opens in a modal and Escape returns focus without navigation');
  await page.screenshot({ path: join(directory, 'services-before.png'), fullPage: true });
  for (const provider of ['qwen-token-plan-cn', 'xopc-cloud']) {
    console.log(JSON.stringify({ step: 'service-config', provider }));
    const chat = plans[provider].uses.find((use: any) => use.id === 'chat');
    const preferred = chat.choices.find((choice: any) => choice.id === chat.recommended);
    await open('chat'); await chooseService(provider);
    if (provider === 'qwen-token-plan-cn') {
      const alternative = chat.choices.find((choice: any) => choice.id !== chat.recommended);
      const beforeDraft = await currentModels();
      await chooseModel(alternative.name);
      await dialog.getByRole('button', { name: '更换', exact: true }).click();
      await dialog.locator('#provider-setup-key').fill('fixture-unsaved-not-a-key');
      await close('chat'); await open('chat');
      assert.equal(await dialog.locator('#provider-setup-key').inputValue(), 'fixture-unsaved-not-a-key');
      assert.equal((await dialog.getByRole('button', { name: '选择模型', exact: true }).innerText()).trim(), alternative.name);
      equal(await currentModels(), beforeDraft, 'Closing a draft must not apply it');
      await dialog.getByRole('button', { name: '保留原 Key', exact: true }).click();
      await apply('chat', provider, alternative.id);
      await dialog.getByRole('button', { name: '选择 对话与任务', exact: true }).click();
      await page.getByRole('searchbox').fill(preferred.id);
      await page.locator('[data-select-scroll-region]:visible').getByRole('button', { name: preferred.name, exact: true }).click();
      await wait(async () => (await currentModels()).chat.primary === preferred.id, 'Direct model switching did not save');
      report.checks.push('Bailian key/model drafts survive close/reopen without applying; existing key reused and direct model switching saved');
    } else await apply('chat', provider, preferred.id);
    await close('chat'); await open('chat', true);
    assert.ok((await dialog.getByRole('button', { name: '选择 对话与任务', exact: true }).innerText()).includes(preferred.name));
    await close('chat', true);
    for (const use of ['vision', 'transcription', 'speech'] as const) {
      await open(use); await chooseService(provider);
      const setup = plans[provider].uses.find((item: any) => item.id === use);
      await apply(use, provider, setup.recommended);
      await close(use); await open(use, true);
      if (use === 'transcription') {
        const mode = (await currentConfig()).voice.languageMode === 'auto' ? 'manual' : 'auto';
        await dialog.getByRole('button', { name: /^(跟随应用语言|保留手动设置)$/ }).click();
        await page.getByRole('button', { name: mode === 'auto' ? '跟随应用语言' : '保留手动设置', exact: true }).last().click();
        await dialog.getByRole('heading').first().click();
        await wait(async () => (await currentConfig()).voice.languageMode === mode, 'Recognition language did not save');
        await close(use); await open(use, true);
        assert.equal((await currentConfig()).voice.languageMode, mode);
        assert.ok(await dialog.getByRole('button', { name: mode === 'auto' ? '跟随应用语言' : '保留手动设置', exact: true }).isVisible());
        const processing = dialog.locator('[data-voice-section="input-processing"]');
        await processing.locator('summary').click();
        const nextProcessing = (await currentConfig()).voice.input?.refinement?.mode === 'punctuation' ? 'off' : 'punctuation';
        await processing.getByRole('button').click();
        await page.getByRole('button', { name: nextProcessing === 'off' ? '关闭（保留原文）' : '仅补标点', exact: true }).click();
        await dialog.getByRole('heading').first().click();
        await wait(async () => (await currentConfig()).voice.input?.refinement?.mode === nextProcessing, 'Dictation text processing did not save');
        await close(use); await open(use, true);
        assert.equal((await currentConfig()).voice.input.refinement.mode, nextProcessing);

      }
      if (use === 'speech') {
        const picker = dialog.locator(`#voice-tts-${provider}-voice`);
        await picker.click();
        const choices = page.locator('[data-select-scroll-region]:visible button:not([disabled])');
        await choices.first().waitFor();
        const multiple = await choices.count() > 1;
        const previous = (await currentConfig()).tts.providers[provider].voice;
        const next = multiple ? page.locator('[data-select-scroll-region]:visible button:not([disabled]):not(.bg-surface-active)').first() : choices.first();
        const voiceName = (await next.innerText()).trim(); await next.click();
        await dialog.getByRole('heading').first().click();
        await wait(async () => { const voice = (await currentConfig()).tts.providers[provider].voice; return !!voice && (!multiple || voice !== previous); }, 'Voice did not save');
        const savedVoice = (await currentConfig()).tts.providers[provider].voice;
        const trigger = (await currentConfig()).tts.trigger === 'tagged' ? 'always' : 'tagged';
        await dialog.getByRole('button', { name: '消息自动朗读', exact: true }).click();
        await page.getByRole('button', { name: trigger === 'always' ? '始终' : '标签（[[tts]]）', exact: true }).click();
        await dialog.getByRole('heading').first().click();
        await wait(async () => (await currentConfig()).tts.trigger === trigger, 'Readout parameter did not save');
        await close(use); await open(use, true);
        assert.equal((await picker.innerText()).trim(), voiceName);
        assert.equal((await currentConfig()).tts.providers[provider].voice, savedVoice);
        assert.equal((await currentConfig()).tts.trigger, trigger);
      }
      await close(use);
    }
    if (report.realVendorRequests) {
      console.log(JSON.stringify({ step: 'real-speech', provider }));
      const response = await fetch(base + '/api/voice/speech', { method: 'POST', headers, body: JSON.stringify({ text: '[[tts]]这是服务配置测试。验证数字，四七二九。', language: 'zh' }), signal: AbortSignal.timeout(90_000) });
      if (!response.ok) throw new Error(`${provider} TTS HTTP ${response.status}: ${clean(await response.text())}`);
      const audio = await response.arrayBuffer(); const mime = response.headers.get('content-type')?.split(';')[0] ?? '';
      assert.ok(mime.startsWith('audio/') && audio.byteLength > 1000, 'No playable audio');
      const form = new FormData(); form.set('audio', new Blob([audio], { type: mime }), mime.includes('wav') ? 'speech.wav' : 'speech.mp3'); form.set('expectedProvider', provider); form.set('language', 'zh');
      const result = await fetch(base + '/api/voice/transcriptions', { method: 'POST', headers: { Authorization: headers.Authorization }, body: form, signal: AbortSignal.timeout(90_000) });
      const data = await result.json(); if (!result.ok || data.ok === false) throw new Error(`${provider} STT HTTP ${result.status}: ${clean(JSON.stringify(data.error))}`);
      const transcription = data.payload ?? data; assert.equal(transcription.provider, provider);
      assert.match(String(transcription.text).replace(/[四七二九]/g, digit => ({ 四: '4', 七: '7', 二: '2', 九: '9' }[digit]!)), /4729/);
    }
    await page.reload(); await page.getByRole('heading', { name: '连接的服务', exact: true }).waitFor();
    assert.equal((await currentModels()).chat.primary, preferred.id);
    await open('speech', true); assert.equal((await currentConfig()).tts.provider, provider); await close('speech');
    report.checks.push(`${provider}: saved connection reused, chat/vision/STT/TTS switched in place; parameters, focus and route retained after close/reopen and page reload${report.realVendorRequests ? '; real TTS/STT passed' : ''}`);
  }
  const beforeConversation = await currentConfig();
  await open('conversation', true);
  await dialog.locator('label').filter({ hasText: '默认通话方案' }).getByRole('button').click();
  await page.getByRole('button', { name: '当前助手', exact: true }).click();
  await dialog.getByRole('heading').first().click();
  await wait(async () => (await currentConfig()).voice.realtime.defaultEngine === 'agent', 'Conversation mode did not save');
  const callVoice = dialog.locator('#realtime-voice');
  await wait(() => callVoice.isEnabled(), 'Assistant voices unavailable');
  await callVoice.click();
  const callChoices = page.locator('[data-select-scroll-region]:visible button:not([disabled])').filter({ hasNotText: '服务默认音色' });
  await callChoices.first().waitFor();
  const chosenVoice = (await callChoices.last().innerText()).trim();
  await callChoices.last().click(); await dialog.getByRole('heading').first().click();
  await wait(async () => !!(await currentConfig()).voice.realtime.tts?.voice, 'Assistant voice did not save');
  await close('conversation'); await open('conversation', true);
  assert.equal((await callVoice.innerText()).trim(), chosenVoice);
  await callVoice.click(); await page.getByRole('button', { name: '服务默认音色', exact: true }).click();
  await dialog.getByRole('heading').first().click();
  await wait(async () => !(await currentConfig()).voice.realtime.tts?.voice, 'Service default did not clear the voice override');
  await close('conversation'); await open('conversation', true);
  assert.equal((await callVoice.innerText()).trim(), '服务默认音色');
  const afterConversation = await currentConfig();
  equal(afterConversation.voice.realtime.omni, beforeConversation.voice.realtime.omni, 'Assistant voice changed natural conversation settings');
  equal(afterConversation.stt, beforeConversation.stt, 'Conversation controls changed recorded recognition');
  equal(afterConversation.tts, beforeConversation.tts, 'Conversation controls changed readout settings');
  await close('conversation');
  report.checks.push('Assistant voice selection and reset to service default persist after reopening; natural conversation, STT and readout remain unchanged');
  await open('background');
  if (!plans['qwen-token-plan-cn'].uses.some((use: any) => use.id === 'background' && use.choices.length > 0)) assert.equal(await dialog.getByRole('button', { name: /百炼订阅/ }).count(), 0);
  await close('background');
  equal((await currentModels()).background, defaultsBefore.defaults.models.background, 'Background must remain on Cloud');
  assert.equal(report.credentialWritesBlocked, 0); assert.equal(report.authorizationAttemptsBlocked, 0);
  assert.deepEqual(report.errors, []);
  await page.screenshot({ path: join(directory, 'services-after.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await open('speech', true); await close('speech', true);
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Mobile settings overflow');
  report.checks.push('Desktop and mobile Escape close only the capability modal; service route, scroll and focus preserved');
  report.checks.push('Background remains Cloud; no credential writes or authorization requests; no browser exceptions');
  report.passed = true;
} catch (error) {
  report.error = clean(error); process.exitCode = 1;
  await page.screenshot({ path: join(directory, 'failure.png'), fullPage: true }).catch(() => {});
} finally {
  await browser.close();
  try {
    const current = await request('/api/global-defaults');
    if (JSON.stringify(current.defaults.models) !== JSON.stringify(defaultsBefore.defaults.models)) await request('/api/global-defaults', 'PATCH', { defaults: defaultsBefore.defaults, scope: 'models', expectedModels: current.defaults.models });
    // Restore exact voice slices: PATCH intentionally merges provider maps and cannot
    // remove defaults or temporary entries introduced by capability setup.
    const priorText = await readFile(configPath, 'utf8'); const disk = JSON.parse(priorText);
    disk.tools.media.audio = original.tools.media.audio;
    disk.messages.tts = original.messages.tts;
    disk.voice = original.voice;
    const temporary = join(homedir(), '.xopc', `.service-e2e-restore-${crypto.randomUUID()}.tmp`);
    try {
      await writeFile(temporary, JSON.stringify(disk, null, 2) + '\n', { mode: (await stat(configPath)).mode & 0o777 });
      assert.ok(await readFile(configPath, 'utf8') === priorText, 'Configuration changed during restore');
      await rename(temporary, configPath);
    } finally { await rm(temporary, { force: true }); }
    const reload = await request('/api/config/reload', 'POST', {});
    assert.equal(reload.reloaded, true, 'Gateway did not reload restored configuration');
    await new Promise(resolve => setTimeout(resolve, 1500));
    const restored = (await request('/api/config')).config;
    // Revisions are opaque and can change after reload; compare actual settings.
    for (const key of ['stt', 'tts', 'voice']) assert.deepEqual(restored[key], configBefore[key], `Original ${key} settings were not restored`);
    equal((await request('/api/global-defaults')).defaults.models, defaultsBefore.defaults.models, 'Original routes were not restored');
    await rm(join(directory, 'baseline-private.json'), { force: true });
    report.checks.push('Original model routes and complete voice settings restored; temporary provider entries removed');
  } catch (error) { report.passed = false; report.error += ` Restoration failed: ${clean(error)}`; process.exitCode = 1; }
  await writeFile(join(directory, 'report.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report));
}
