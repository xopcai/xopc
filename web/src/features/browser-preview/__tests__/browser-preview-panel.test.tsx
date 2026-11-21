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

it('does not expire an already-accepted preview while the tab remains hidden past the 60s request window', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.useFakeTimers();
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

    // User switches to source tab and approves near the end of the 60s request window.
    hidden.mockReturnValue(true);
    await act(async () => { await vi.advanceTimersByTimeAsync(55_000); });
    await act(async () => receive({ type: 'accepted', requestId }));
    expect(createPeer).not.toHaveBeenCalled();

    // Lease renewals keep the accepted preview alive past 60s while hidden.
    for (let i = 0; i < 4; i += 1) {
      await act(async () => { await vi.advanceTimersByTimeAsync(3_000); });
      await act(async () => receive({ type: 'lease', requestId }));
    }
    expect(realtime.send.mock.calls.some(([m]) => m.type === 'close')).toBe(false);

    // Returning to the tab starts the peer cleanly instead of showing expired.
    hidden.mockReturnValue(false);
    await act(async () => document.dispatchEvent(new Event('visibilitychange')));
    expect(createPeer).toHaveBeenCalledOnce();
    expect(container.querySelector('video')?.className).not.toContain('hidden');
  } finally {
    await act(async () => root.unmount());
    useGatewayRealtimeStore.setState({ connectionState: 'disconnected' });
    vi.useRealTimers();
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

it('keeps showing the last snapshot while probing video recovery and resumes congestion upgrade afterward', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.useFakeTimers();
  vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
  let framesDecoded = 0;
  let connectionState = 'connecting';
  const close = vi.fn();
  const createPeer = vi.fn(function () {
    return {
      get connectionState() { return connectionState; },
      signalingState: 'stable',
      remoteDescription: null,
      addTransceiver: () => ({}),
      createOffer: async () => ({ type: 'offer', sdp: 'test' }),
      setLocalDescription: async () => {},
      localDescription: { sdp: 'test' },
      getStats: async () => new Map([
        ['video', { type: 'inbound-rtp', kind: 'video', framesDecoded, freezeCount: 0, packetsReceived: 50, packetsLost: 0 }],
        ['transport', { type: 'transport', selectedCandidatePairId: 'pair' }],
        ['pair', { currentRoundTripTime: 0.02 }],
      ]),
      close,
    };
  });
  vi.stubGlobal('RTCPeerConnection', createPeer);
  vi.stubGlobal('RTCRtpReceiver', {});
  const createObjectURL = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:frame-1');
  const revokeObjectURL = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(new Uint8Array([0xff, 0xd8, 1, 0xff, 0xd9]), {
    status: 200,
    headers: { 'Content-Type': 'image/jpeg', 'X-Xopc-Preview-Frame': '1' },
  }));
  useGatewayRealtimeStore.setState({ connectionState: 'connected' });
  const container = document.createElement('div');
  const root = createRoot(container);
  try {
    await act(async () => root.render(<BrowserPreviewPanel conversationId="conversation" />));
    const { requestId } = realtime.send.mock.calls[0][0];
    const receive = realtime.listen.mock.calls[0][0];
    await act(async () => receive({ type: 'waiting', requestId, origin: 'https://example.org' }));
    await act(async () => receive({ type: 'accepted', requestId }));

    // Initial 5s media deadline falls back to snapshot before `playing` ever fired.
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    expect(realtime.send).toHaveBeenCalledWith({ type: 'quality', requestId, quality: 'snapshot' });
    await act(async () => receive({ type: 'quality', requestId, quality: 'snapshot', snapshotToken: 'tok-1' }));
    await act(async () => { await vi.advanceTimersByTimeAsync(100); });
    expect(container.querySelector('img')?.getAttribute('src')).toBe('blob:frame-1');

    // Keep lease alive while waiting for 15s recovery probe.
    connectionState = 'connected';
    for (let i = 0; i < 5; i += 1) {
      await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
      await act(async () => receive({ type: 'lease', requestId }));
    }
    expect(realtime.send).toHaveBeenCalledWith({ type: 'quality', requestId, quality: 'low' });
    // Snapshot remains visible while probing before the first video frame arrives.
    expect(container.querySelector('img')?.getAttribute('src')).toBe('blob:frame-1');
    revokeObjectURL.mockClear();

    // First decoded frame arrives -> switches to ready video, clears snapshot, and marks playing=true.
    framesDecoded = 5;
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(container.querySelector('img')).toBeNull();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:frame-1');

    // 10 healthy samples upgrade from low back to normal (proves playing=true was set).
    for (let i = 0; i < 10; i += 1) {
      framesDecoded += 10;
      await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
      if (i % 3 === 2) await act(async () => receive({ type: 'lease', requestId }));
    }
    expect(realtime.send).toHaveBeenCalledWith({ type: 'quality', requestId, quality: 'normal' });
  } finally {
    await act(async () => root.unmount());
    useGatewayRealtimeStore.setState({ connectionState: 'disconnected' });
    createObjectURL.mockRestore();
    revokeObjectURL.mockRestore();
    fetchSpy.mockRestore();
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  }
});
