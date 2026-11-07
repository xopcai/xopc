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
  it.each(['unregister', 'logout', 'dispose'] as const)('aborts a delegation transport on %s', change => {
    const { router } = setup(['capability:xopc.agent.delegate']);
    const signal = router.delegationSignal('trusted');
    const previous = useGatewayStore.getState().conversationId;
    expect(signal.aborted).toBe(false);
    if (change === 'unregister') router.unregisterIframe('trusted');
    if (change === 'logout') useGatewayStore.setState({ conversationId: 'changed' });
    if (change === 'dispose') router.dispose();
    expect(signal.aborted).toBe(true);
    useGatewayStore.setState({ conversationId: previous });
  });
  it('does not let a stale Local App frame acquire a replacement grant', async () => {
    const { router, reply, send } = setup();
    const iframe = document.querySelector('iframe')!;
    router.registerIframe('trusted', iframe, ['capability:xopc.notes.list'], 'b'.repeat(64), 'original-grant', true);
    mocks.fetch.mockResolvedValue({ grant: { granted: true, manifestDigest: 'b'.repeat(64), grantRevision: 'replacement-grant' } });
    send('capability.call', { id: 'xopc.notes.list', call });
    await vi.waitFor(() => expect(reply).toHaveBeenCalled());
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
    expect(mocks.fetch.mock.calls[0][0]).toContain('/ui-grant');
    expect(reply).toHaveBeenCalledWith(expect.objectContaining({ error: expect.objectContaining({ message: expect.stringContaining('authorization changed') }) }), '*');
  });

  it('withholds a result revoked while the host request was in flight', async () => {
    const { router, reply, send } = setup();
    const iframe = document.querySelector('iframe')!;
    router.registerIframe('trusted', iframe, ['capability:xopc.notes.list'], 'b'.repeat(64), 'original-grant', true);
    mocks.fetch.mockResolvedValueOnce({ grant: { granted: true, manifestDigest: 'b'.repeat(64), grantRevision: 'original-grant' } })
      .mockResolvedValueOnce({ status: 'succeeded', data: { secret: true } })
      .mockResolvedValueOnce({ grant: { granted: false } });
    send('capability.call', { id: 'xopc.notes.list', call });
    await vi.waitFor(() => expect(reply).toHaveBeenCalled());
    expect(reply.mock.calls.some(([value]) => value.result?.data?.secret)).toBe(false);
  });

  it('blocks implicit methods and cross-application event delivery', async () => {
    const { router, send, reply } = setup();
    const iframe = document.querySelector('iframe')!;
    router.registerIframe('trusted', iframe, [], 'b'.repeat(64), 'grant', true);
    const handler = vi.fn(); router.registerMethod('unclassified', handler);
    send('unclassified', {});
    await vi.waitFor(() => expect(reply).toHaveBeenCalled());
    expect(handler).not.toHaveBeenCalled();
    const peer = document.createElement('iframe'); document.body.append(peer);
    cleanups.push(() => peer.remove());
    router.registerIframe('peer', peer, []);
    const peerMessages = vi.spyOn(peer.contentWindow!, 'postMessage');
    const localMessages = reply.mock.calls.length;
    window.dispatchEvent(new MessageEvent('message', { source: iframe.contentWindow, data: {
      source: 'xopc-extension', type: 'event', event: 'ext.secret', data: 'private',
    } }));
    router.broadcastExtensionEvent('peer', 'secret', 'private');
    expect(peerMessages).not.toHaveBeenCalled(); expect(reply).toHaveBeenCalledTimes(localMessages);
  });
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
