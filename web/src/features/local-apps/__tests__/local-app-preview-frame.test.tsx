// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ fetch: vi.fn(), register: vi.fn(), dispose: vi.fn(), detach: vi.fn() }));
vi.mock('@/lib/fetch', () => ({ fetchJson: mocks.fetch }));
vi.mock('@/features/extensions/extension-message-router', () => ({
  registerBuiltinMethods() {},
  ExtensionMessageRouter: class {
    registerIframe = mocks.register; dispose = mocks.dispose;
    sendInit() {} sendEvent() {} whenIdle() { return Promise.resolve(); }
  },
}));
vi.mock('../preview-channel', () => ({ attachLocalAppPreviewChannel: () => mocks.detach }));

import { LocalAppPreviewFrame } from '../local-app-preview-frame';
import { useGatewayStore } from '@/stores/gateway-store';

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
const hash = 'a'.repeat(64);
const nextHash = 'b'.repeat(64);
const session = (sourceHash = hash, id = '00000000-0000-4000-8000-000000000001') => ({
  id, sourceHash, appId: 'app', extensionId: 'extension', mode: 'sample', expiresAt: Date.now() + 10000,
  previewUrl: `/api/local-apps/preview/token/snapshots/${sourceHash}/ui/index.html`, permissions: ['storage'], bindings: [],
});

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.clearAllMocks();
  useGatewayStore.setState({ baseUrl: '', conversationId: 'preview-owner' });
  mocks.fetch.mockImplementation((_path, options) => Promise.resolve(options?.method === 'POST' ? { session: session() } : { ok: true }));
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });
async function render(sourceHash = hash, runKey = 0) {
  await act(async () => root.render(<LocalAppPreviewFrame appId="app" sourceHash={sourceHash} mode="sample" runKey={runKey} title="Preview" onMessage={() => {}} />));
}

describe('snapshot preview frame authority', () => {
  it('retries resource exhaustion and reports persistent host failures as runner errors', async () => {
    vi.useFakeTimers();
    const onMessage = vi.fn();
    mocks.fetch.mockRejectedValue(new Error('Too many isolated preview workers'));
    try {
      await act(async () => root.render(<LocalAppPreviewFrame appId="app" sourceHash={hash} mode="sample" runKey={0} title="Preview" onMessage={onMessage} />));
      expect(onMessage).not.toHaveBeenCalled();
      await act(async () => vi.advanceTimersByTimeAsync(2000));
      expect(mocks.fetch).toHaveBeenCalledTimes(3);
      expect(onMessage).toHaveBeenCalledWith(expect.objectContaining({ detail: expect.objectContaining({ kind: 'runner_error' }) }));
    } finally { vi.useRealTimers(); }
  });

  it('recovers on the next preview allocation without reporting an app error', async () => {
    vi.useFakeTimers();
    mocks.fetch.mockRejectedValueOnce(new Error('Too many isolated preview workers'));
    try {
      await render();
      await act(async () => vi.advanceTimersByTimeAsync(1000));
      expect(container.querySelector('iframe')).not.toBeNull();
      expect(container.querySelector('[role="alert"]')).toBeNull();
    } finally { vi.useRealTimers(); }
  });

  it('uses an immutable preview and registers only the host-created lease', async () => {
    await render();
    expect(container.querySelector('iframe')?.getAttribute('src')).toContain(`/snapshots/${hash}/ui/index.html?xopcHostRun=1`);
    expect(container.querySelector('iframe')?.getAttribute('sandbox')).toBe('allow-scripts');
    expect(mocks.register).toHaveBeenCalledWith('extension', expect.any(HTMLIFrameElement), ['storage'], hash,
      '00000000-0000-4000-8000-000000000001', true, '00000000-0000-4000-8000-000000000001');
  });

  it('does not mount a late session for a previous source and revokes it', async () => {
    let resolve!: (value: unknown) => void;
    mocks.fetch.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    await render();
    mocks.fetch.mockImplementation((_path, options) => Promise.resolve(options?.method === 'POST'
      ? { session: session(nextHash, '00000000-0000-4000-8000-000000000002') } : { ok: true }));
    await render(nextHash);
    await act(async () => { resolve({ session: session() }); });
    expect(container.querySelector('iframe')?.getAttribute('src')).toContain(nextHash);
    expect(mocks.register.mock.calls.some(call => call[3] === hash)).toBe(false);
    expect(mocks.fetch).toHaveBeenCalledWith(expect.stringContaining('00000000-0000-4000-8000-000000000001'), expect.objectContaining({ method: 'DELETE' }));
  });

  it('removes the previous iframe before replacement authority arrives', async () => {
    await render();
    mocks.fetch.mockImplementation((_path, options) => options?.method === 'POST' ? new Promise(() => {}) : Promise.resolve({ ok: true }));
    await render(nextHash);
    expect(container.querySelector('iframe')).toBeNull();
    expect(mocks.dispose).toHaveBeenCalled();
  });

  it('does not reuse a registration after a Gateway identity changes', async () => {
    await render();
    mocks.fetch.mockImplementation((_path, options) => options?.method === 'POST' ? new Promise(() => {}) : Promise.resolve({ ok: true }));
    await act(async () => useGatewayStore.setState({ conversationId: 'different-owner' }));
    expect(container.querySelector('iframe')).toBeNull();
    expect(mocks.dispose).toHaveBeenCalled();
  });

  it('rejects a session returned for a different snapshot', async () => {
    mocks.fetch.mockResolvedValue({ session: session(nextHash) });
    await render();
    expect(container.querySelector('iframe')).toBeNull();
    expect(container.textContent).toContain('does not match');
  });
});
