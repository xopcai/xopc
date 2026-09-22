// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ fetch: vi.fn() }));
vi.mock('@/lib/fetch', () => ({ apiFetch: vi.fn(), fetchJson: mocks.fetch }));
import { ExtensionMessageRouter, registerBuiltinMethods } from '../extension-message-router';
import { useGatewayStore } from '@/stores/gateway-store';

const cleanups: Array<() => void> = [];
afterEach(() => { cleanups.splice(0).forEach(fn => fn()); vi.restoreAllMocks(); mocks.fetch.mockReset(); });
function setup(permissions = ['capability:xopc.notes.list']) {
  const router = new ExtensionMessageRouter();
  registerBuiltinMethods(router);
  const iframe = document.createElement('iframe'); document.body.append(iframe);
  router.registerIframe('trusted', iframe, permissions, 'b'.repeat(64));
  const reply = vi.spyOn(iframe.contentWindow!, 'postMessage');
  const send = (method: string, params: unknown) => window.dispatchEvent(new MessageEvent('message', { source: iframe.contentWindow,
    data: { source: 'xopc-extension', extensionId: 'forged-other-extension', type: 'request', requestId: 'test', method, params } }));
  cleanups.push(() => { router.dispose(); iframe.remove(); });
  return { router, reply, send };
}
const call = { majorVersion: 1, descriptorDigest: 'a'.repeat(64), input: {} };
describe('extension capability bridge', () => {
  it('uses host-bound identity and release digest, never iframe identity', async () => {
    const { reply, send } = setup();
    mocks.fetch.mockResolvedValue({ status: 'succeeded', data: {} });
    send('capability.call', { id: 'xopc.notes.list', call });
    await vi.waitFor(() => expect(reply).toHaveBeenCalled());
    expect(mocks.fetch).toHaveBeenCalledWith(expect.stringContaining('/api/local-app-capabilities/trusted/xopc.notes.list/invocations'), {
      method: 'POST', body: JSON.stringify({ manifestDigest: 'b'.repeat(64), call }),
    });
  });
  it('rejects an undeclared capability before requesting the Gateway', async () => {
    const { reply, send } = setup([]);
    send('capability.call', { id: 'xopc.notes.list', call });
    await vi.waitFor(() => expect(reply).toHaveBeenCalled());
    expect(mocks.fetch).not.toHaveBeenCalled();
    expect(reply).toHaveBeenCalledWith(expect.objectContaining({ error: expect.objectContaining({ code: 4001 }) }), '*');
  });
  it('rejects iframe-supplied release authority and invalidates bindings after logout', async () => {
    const { router, reply, send } = setup();
    send('capability.call', { id: 'xopc.notes.list', call, manifestDigest: 'forged' });
    await vi.waitFor(() => expect(reply).toHaveBeenCalled());
    expect(mocks.fetch).not.toHaveBeenCalled();
    const previous = useGatewayStore.getState().conversationId;
    useGatewayStore.setState({ conversationId: 'other-identity' });
    expect(() => router.getReleaseDigest('trusted')).toThrow('unavailable');
    useGatewayStore.setState({ conversationId: previous });
  });
});
