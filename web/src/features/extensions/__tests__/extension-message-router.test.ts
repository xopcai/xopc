// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ExtensionMessageRouter } from '../extension-message-router';
import { useGatewayStore } from '@/stores/gateway-store';

const cleanups: Array<() => void> = [];
afterEach(() => { for (const cleanup of cleanups.splice(0)) cleanup(); vi.restoreAllMocks(); });
function setup() {
  const router = new ExtensionMessageRouter();
  const iframe = document.createElement('iframe');
  document.body.append(iframe);
  router.registerIframe('trusted', iframe, ['storage']);
  const reply = vi.spyOn(iframe.contentWindow!, 'postMessage');
  const handler = vi.fn().mockResolvedValue('result');
  router.registerMethod('storage.get', handler);
  const send = (source: Window | null, extensionId = 'trusted') => window.dispatchEvent(new MessageEvent('message', {
    source, data: { source: 'xopc-extension', extensionId, type: 'request', requestId: 'r1', method: 'storage.get', params: { key: 'key' } },
  }));
  cleanups.push(() => { router.dispose(); iframe.remove(); });
  return { router, iframe, handler, reply, send };
}
describe('extension iframe identity', () => {
  it('rejects null and unregistered message sources', async () => {
    const { handler, send } = setup();
    send(null);
    send(window);
    await Promise.resolve();
    expect(handler).not.toHaveBeenCalled();
  });
  it('derives identity from the registered frame, not the claimed extension ID', async () => {
    const { iframe, handler, reply, send } = setup();
    send(iframe.contentWindow, 'other-extension');
    await Promise.resolve();
    expect(handler).toHaveBeenCalledWith('trusted', { key: 'key' });
    expect(reply).toHaveBeenCalledWith(expect.objectContaining({ type: 'response', result: 'result' }), '*');
  });
  it.each(['unregister', 'permissions', 'logout'] as const)('drops pending responses after %s', async (change) => {
    const { router, iframe, handler, reply, send } = setup();
    let resolve!: (value: string) => void;
    handler.mockReturnValue(new Promise<string>(done => { resolve = done; }));
    send(iframe.contentWindow);
    const previous = useGatewayStore.getState().conversationId;
    if (change === 'unregister') router.unregisterIframe('trusted');
    if (change === 'permissions') router.registerIframe('trusted', iframe, []);
    if (change === 'logout') useGatewayStore.setState({ conversationId: 'changed-identity' });
    reply.mockClear();
    resolve('private result');
    await Promise.resolve();
    expect(reply).not.toHaveBeenCalled();
    useGatewayStore.setState({ conversationId: previous });
  });
  it('does not process messages from a disposed or replaced frame', async () => {
    const { router, iframe, handler, send } = setup();
    router.dispose();
    send(iframe.contentWindow);
    await Promise.resolve();
    expect(handler).not.toHaveBeenCalled();
  });
});
