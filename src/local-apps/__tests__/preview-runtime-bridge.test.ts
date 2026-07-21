import { describe, expect, it } from 'vitest';
import { JSDOM } from 'jsdom';

import {
  injectLocalAppRuntimeBridge,
  LOCAL_APP_RUNTIME_BRIDGE_HASH,
  LOCAL_APP_RUNTIME_BRIDGE_SCRIPT,
} from '../preview-runtime-bridge.js';

describe('local app preview runtime bridge', () => {
  it('injects the diagnostics bridge at the start of head', () => {
    const html = injectLocalAppRuntimeBridge('<!doctype html><html><head><title>App</title></head></html>');
    expect(html).toContain('<head>\n<script data-xopc-runtime-bridge>');
    expect(html).toContain("source: 'xopc-local-app-preview'");
    expect(html).toContain("source !== 'xopc-local-app-host'");
    expect(html).toContain("event.stopImmediatePropagation()");
    expect(html).toContain('hostPort.postMessage(message)');
    expect(html).not.toContain("parent.postMessage({ source: 'xopc-local-app-preview'");
    expect(html).toContain("send('acceptance'");
    expect(html).toContain("send('criteria'");
    expect(html).toContain("params.get('xopcScenario')");
    expect(html).toContain("id: 'interaction'");
  });

  it('embeds declarative criteria as inert metadata', () => {
    const html = injectLocalAppRuntimeBridge('<html><head></head></html>', {
      schemaVersion: 1,
      scenarios: [{ id: 'open', name: 'Open app', steps: [{ action: 'click', target: 'open' }] }],
    });
    expect(html).toContain('name="xopc-local-app-acceptance"');
    expect(html).not.toContain('Open app');
  });

  it('exposes a CSP-compatible SHA-256 hash', () => {
    expect(LOCAL_APP_RUNTIME_BRIDGE_HASH).toMatch(/^[A-Za-z0-9+/]{43}=$/);
  });

  it('emits syntactically valid browser JavaScript', () => {
    expect(() => new Function(LOCAL_APP_RUNTIME_BRIDGE_SCRIPT)).not.toThrow();
  });

  it('reports runtime readiness only through the transferred private port', async () => {
    const html = injectLocalAppRuntimeBridge('<!doctype html><html><head></head><body><button>Open</button></body></html>');
    const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true });
    const messages: unknown[] = [];
    const port = {
      start() {},
      postMessage(value: unknown) { messages.push(value); },
    } as MessagePort;
    dom.window.dispatchEvent(new dom.window.MessageEvent('message', {
      data: { source: 'xopc-local-app-host', version: 1, type: 'connect' },
      source: dom.window,
      ports: [port],
    }));

    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(messages).toContainEqual(expect.objectContaining({
      source: 'xopc-local-app-preview',
      version: 1,
      type: 'ready',
    }));
    expect(messages).toContainEqual(expect.objectContaining({ type: 'acceptance' }));
    dom.window.close();
  });
});
