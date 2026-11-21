// @vitest-environment jsdom
import type { BrowserPreviewServerMessage } from '@xopcai/realtime-protocol';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { beforeEach, expect, it, vi } from 'vitest';

import { useGatewayRealtimeStore } from '@/stores/gateway-realtime-store';

import { BrowserPreviewPanel } from '../browser-preview-panel';

const realtime = vi.hoisted(() => ({
  send: vi.fn(),
  listen: vi.fn<(listener: (message: BrowserPreviewServerMessage) => void) => () => void>(),
}));
vi.mock('@/features/gateway/gateway-realtime', () => ({
  sendGatewayBrowserPreview: realtime.send,
  listenGatewayBrowserPreview: realtime.listen,
}));

beforeEach(() => {
  realtime.send.mockClear();
  realtime.listen.mockReset().mockReturnValue(() => {});
});

it('keeps the preview across tab switches and releases media when the page is left', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
  const close = vi.fn();
  const createPeer = vi.fn(function () {
    return { addTransceiver: () => ({}), createOffer: async () => ({ type: 'offer', sdp: 'test' }),
      setLocalDescription: async () => {}, localDescription: { sdp: 'test' }, close };
  });
  vi.stubGlobal('RTCPeerConnection', createPeer);
  vi.stubGlobal('RTCRtpReceiver', {});
  useGatewayRealtimeStore.setState({ connectionState: 'connected' });
  const container = document.createElement('div');
  const root = createRoot(container);
  try {
    await act(async () => root.render(<BrowserPreviewPanel conversationId="conversation" />));
    const { requestId } = realtime.send.mock.calls[0][0];
    const receive = realtime.listen.mock.calls[0][0];
    await act(async () => receive({ type: 'waiting', requestId, origin: 'https://example.org' }));
    hidden.mockReturnValue(true);
    await act(async () => document.dispatchEvent(new Event('visibilitychange')));
    expect(realtime.send.mock.calls.map(([message]) => message.type)).toEqual(['view']);

    await act(async () => receive({ type: 'accepted', requestId }));
    expect(createPeer).not.toHaveBeenCalled();

    hidden.mockReturnValue(false);
    await act(async () => document.dispatchEvent(new Event('visibilitychange')));
    expect(createPeer).toHaveBeenCalledOnce();
    expect(realtime.send).toHaveBeenCalledWith(expect.objectContaining({ type: 'signal', requestId }));

    hidden.mockReturnValue(true);
    await act(async () => document.dispatchEvent(new Event('visibilitychange')));
    expect(close).not.toHaveBeenCalled();
    await act(async () => window.dispatchEvent(new Event('pagehide')));
    expect(close).toHaveBeenCalledOnce();
    expect(realtime.send).toHaveBeenCalledWith({ type: 'close', requestId });
  } finally {
    await act(async () => root.unmount());
    useGatewayRealtimeStore.setState({ connectionState: 'disconnected' });
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  }
});

it('offers a retry when the Gateway does not acknowledge the request', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
  vi.useFakeTimers();
  useGatewayRealtimeStore.setState({ connectionState: 'connected' });
  const container = document.createElement('div');
  const root = createRoot(container);
  try {
    await act(async () => root.render(<BrowserPreviewPanel conversationId="conversation" />));
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    expect(container.textContent).toMatch(/未响应|did not respond/);
    expect(container.querySelector('button')?.disabled).toBe(false);
    expect(realtime.send.mock.calls.map(([message]) => message.type)).toEqual(['view', 'close']);
  } finally {
    await act(async () => root.unmount());
    useGatewayRealtimeStore.setState({ connectionState: 'disconnected' });
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  }
});
