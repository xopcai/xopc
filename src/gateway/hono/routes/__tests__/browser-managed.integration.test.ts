import { mkdtempSync, rmSync } from 'node:fs';
import { once } from 'node:events';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { serve } from '@hono/node-server';
import { expect, it, vi } from 'vitest';

import { browserAssistance, requireBrowserAssistance } from '../../../../browser/assistance.js';
import type { BrowserInteractiveInput, ManagedBrowserFrame, ManagedBrowserLiveHandle } from '../../../../browser/drivers/browser-driver.js';
import { ManagedBrowserLiveRuntime } from '../../../../browser/managed-live-runtime.js';
import { ConfigSchema } from '../../../../config/schema.js';
import { BrowserPreviewRuntime } from '../../../../realtime/browser-preview.js';
import { createConversation } from '../../../../storage/sqlite/conversation-repository.js';
import { closeXopcDatabase, openXopcDatabase, resetXopcDatabaseSingletonForTest } from '../../../../storage/sqlite/connection.js';
import { createHonoApp } from '../../app.js';
import type { GatewayService } from '../../../service.js';

it('completes the managed browser live view, privacy-isolated takeover, input, and handback loop over authenticated Gateway HTTP', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'xopc-managed-browser-route-'));
  resetXopcDatabaseSingletonForTest();
  openXopcDatabase(join(dir, 'test.db'));
  const conversation = createConversation({ agentId: 'main', channel: 'webchat', chatId: 'managed-live' });
  const auth = { mode: 'token' as const, token: 'managed-browser-test-token' };
  const config = ConfigSchema.parse({ browser: { enabled: true, driver: { kind: 'playwright', headless: true } } });

  let emitFrame: ((frame: ManagedBrowserFrame) => void) | undefined;
  const inputs: BrowserInteractiveInput[] = [];
  const invalidateRefs = vi.fn();
  const resumeBrowserAssistance = vi.fn();
  const handle: ManagedBrowserLiveHandle = {
    sessionId: 'pw-session-1',
    getViewport: () => ({ width: 1280, height: 720, version: 1 }),
    getUrl: () => 'https://portal.example.test/login',
    getTitle: async () => 'Portal Login',
    startScreencast: async (onFrame) => {
      emitFrame = onFrame;
      onFrame({ bytes: Uint8Array.from([0xff, 0xd8, 1, 2, 0xff, 0xd9]), width: 1280, height: 720, timestamp: Date.now() });
      return async () => {};
    },
    dispatchInput: async (input) => { inputs.push(input); },
    invalidateRefs,
  };

  const managedBrowserLive = new ManagedBrowserLiveRuntime({
    isRunActive: () => false,
    waitForIdle: async () => {},
    pinSession: () => {},
    unpinSession: () => {},
    resumeBrowserAssistance,
  });
  managedBrowserLive.setSource(conversation.key, {
    browserSessionId: 'pw-session-1',
    handle,
    url: 'https://portal.example.test/login',
    title: 'Portal Login',
  });
  const wait = requireBrowserAssistance(conversation.key, 'run-1', 'tc-1', {
    browserSessionId: 'pw-session-1',
    reason: 'Please complete login and CAPTCHA',
    url: 'https://portal.example.test/login',
    title: 'Portal Login',
  });

  const service = {
    get currentConfig() { return config; },
    getResolvedAuth: () => auth,
    getEffectiveListenPort: () => 18790,
    browserPreviews: new BrowserPreviewRuntime(() => undefined),
    managedBrowserLive,
    getExtensionLoader: () => null,
    isGatewayReady: () => true,
    getHealth: () => ({ status: 'healthy' }),
  } as unknown as GatewayService;

  const app = createHonoApp({ service });
  const gateway = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: 0 });
  try {
    if (!gateway.listening) await once(gateway, 'listening');
    const address = gateway.address();
    if (!address || typeof address === 'string') throw new Error('Missing listener');
    const base = `http://127.0.0.1:${address.port}`;
    const headers = { Authorization: `Bearer ${auth.token}`, 'Content-Type': 'application/json' };

    // Unauthenticated access is rejected.
    expect((await fetch(`${base}/api/browser/managed/${conversation.key}/frame`)).status).toBe(401);

    // Status exposes managed interactive preview even while run is suspended in needs_user.
    const previewRes = await fetch(`${base}/api/browser/preview/${conversation.key}?clientId=phone-1`, { headers });
    expect(previewRes.status).toBe(200);
    await expect(previewRes.json()).resolves.toMatchObject({
      available: true,
      mode: 'managed',
      interactive: true,
      status: 'needs_user',
      assistanceId: wait.id,
      reason: 'Please complete login and CAPTCHA',
    });

    // Viewer receives initial JPEG frame immediately.
    const frameRes = await fetch(`${base}/api/browser/managed/${conversation.key}/frame?after=0&clientId=phone-1`, { headers });
    expect(frameRes.status).toBe(200);
    expect(frameRes.headers.get('content-type')).toBe('image/jpeg');
    expect(frameRes.headers.get('x-xopc-preview-frame')).toBe('1');

    // Phone takes over -> PC viewer is privacy-paused (423) and cannot steal control (409).
    const takeoverRes = await fetch(`${base}/api/browser/managed/${conversation.key}/takeover`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ clientId: 'phone-1' }),
    });
    expect(takeoverRes.status).toBe(200);
    const { payload: taken } = await takeoverRes.json() as { payload: { controlEpoch: number; ownControl: boolean } };
    expect(taken).toMatchObject({ ownControl: true, controlEpoch: 1 });

    const pcFrame = await fetch(`${base}/api/browser/managed/${conversation.key}/frame?after=0&clientId=pc-2`, { headers });
    expect(pcFrame.status).toBe(423);
    const pcTakeover = await fetch(`${base}/api/browser/managed/${conversation.key}/takeover`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ clientId: 'pc-2' }),
    });
    expect(pcTakeover.status).toBe(409);

    // Phone sends click + login text + Enter.
    expect((await fetch(`${base}/api/browser/managed/${conversation.key}/input`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ clientId: 'phone-1', epoch: 1, seq: 1, event: { kind: 'pointer', phase: 'click', x: 0.4, y: 0.3 } }),
    })).status).toBe(204);
    expect((await fetch(`${base}/api/browser/managed/${conversation.key}/input`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ clientId: 'phone-1', epoch: 1, seq: 2, event: { kind: 'text', text: 'alice@example.test' } }),
    })).status).toBe(204);
    expect(inputs).toHaveLength(2);

    // Emit next frame and confirm controlling phone still receives live frames.
    emitFrame?.({ bytes: Uint8Array.from([0xff, 0xd8, 3, 4, 0xff, 0xd9]), width: 1280, height: 720, timestamp: Date.now() });
    const phoneFrame = await fetch(`${base}/api/browser/managed/${conversation.key}/frame?after=1&clientId=phone-1`, { headers });
    expect(phoneFrame.status).toBe(200);
    expect(phoneFrame.headers.get('x-xopc-preview-frame')).toBe('2');

    // Handback invalidates DOM refs and triggers Agent continuation.
    const handbackRes = await fetch(`${base}/api/browser/managed/${conversation.key}/handback`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ clientId: 'phone-1', epoch: 1 }),
    });
    expect(handbackRes.status).toBe(200);
    expect(invalidateRefs).toHaveBeenCalledOnce();
    expect(resumeBrowserAssistance).toHaveBeenCalledWith(conversation.key, wait.id);
    expect(browserAssistance(conversation.key)?.id).toBe(wait.id);
  } finally {
    managedBrowserLive.close();
    gateway.close();
    closeXopcDatabase();
    resetXopcDatabaseSingletonForTest();
    rmSync(dir, { recursive: true, force: true });
  }
});
