// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';

import { startPreviewDocument } from './preview-document';

afterEach(() => {
  document.body.innerHTML = '';
  history.replaceState(null, '', '/');
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it('rejects sensitive documents before connecting a runtime port', async () => {
  const connect = vi.fn();
  vi.stubGlobal('chrome', { runtime: { connect } });
  const origin = location.origin;

  // Password field in main DOM
  document.body.innerHTML = '<input type="password" />';
  await expect(startPreviewDocument('req-1', 'stream-1', origin, 10_000)).resolves.toBe(false);
  expect(connect).not.toHaveBeenCalled();

  // Payment iframe (Stripe)
  document.body.innerHTML = '<iframe src="https://js.stripe.com/v3/elements-inner-card.html"></iframe>';
  await expect(startPreviewDocument('req-2', 'stream-2', origin, 10_000)).resolves.toBe(false);
  expect(connect).not.toHaveBeenCalled();

  // Password input inside open Shadow DOM
  document.body.innerHTML = '<div id="host"></div>';
  const shadow = document.getElementById('host')!.attachShadow({ mode: 'open' });
  shadow.innerHTML = '<input type="password" />';
  await expect(startPreviewDocument('req-3', 'stream-3', origin, 10_000)).resolves.toBe(false);
  expect(connect).not.toHaveBeenCalled();

  // Hash-based sensitive SPA route
  document.body.innerHTML = '<div>Clean page</div>';
  history.replaceState(null, '', '/#/login');
  await expect(startPreviewDocument('req-4', 'stream-4', origin, 10_000)).resolves.toBe(false);
  expect(connect).not.toHaveBeenCalled();
});

it('still sends an SDP answer when a queued ICE candidate fails addIceCandidate', async () => {
  let onPortMessage: ((msg: unknown) => void) | undefined;
  const postMessage = vi.fn();
  const disconnect = vi.fn();
  vi.stubGlobal('chrome', {
    runtime: {
      connect: vi.fn(() => ({
        postMessage,
        disconnect,
        onDisconnect: { addListener: vi.fn() },
        onMessage: { addListener: (fn: (msg: unknown) => void) => { onPortMessage = fn; } },
      })),
    },
  });
  const track = { kind: 'video', contentHint: '', addEventListener: vi.fn(), stop: vi.fn() };
  vi.stubGlobal('navigator', {
    mediaDevices: {
      getUserMedia: vi.fn().mockResolvedValue({
        getVideoTracks: () => [track],
        getTracks: () => [track],
      }),
    },
  });
  const replaceTrack = vi.fn().mockResolvedValue(undefined);
  const peerStub = {
    signalingState: 'stable',
    remoteDescription: null as RTCSessionDescriptionInit | null,
    localDescription: null as RTCSessionDescriptionInit | null,
    onicecandidate: null as ((event: unknown) => void) | null,
    setRemoteDescription: vi.fn(async (desc: RTCSessionDescriptionInit) => { peerStub.remoteDescription = desc; }),
    addIceCandidate: vi.fn().mockRejectedValue(new Error('Invalid candidate')),
    getTransceivers: () => [{ direction: 'recvonly', sender: { replaceTrack } }],
    getSenders: () => [{ track, getParameters: () => ({ encodings: [{}] }), setParameters: vi.fn().mockResolvedValue(undefined) }],
    createAnswer: vi.fn().mockResolvedValue({ type: 'answer', sdp: 'v=0\r\nm=video 9 UDP/TLS/RTP/SAVPF 96\r\na=sendonly\r\n' }),
    setLocalDescription: vi.fn(async (desc: RTCSessionDescriptionInit) => { peerStub.localDescription = desc; }),
    close: vi.fn(),
  };
  vi.stubGlobal('RTCPeerConnection', vi.fn(function () { return peerStub; }));

  document.body.innerHTML = '<main>Normal task page</main>';
  await expect(startPreviewDocument('req-ok', 'stream-ok', location.origin, 10_000)).resolves.toBe(true);
  expect(postMessage).toHaveBeenCalledWith({ type: 'ready' });

  onPortMessage?.({ type: 'accepted', requestId: 'req-ok' });
  onPortMessage?.({ type: 'signal', requestId: 'req-ok', signal: { type: 'candidate', candidate: 'bad' } });
  onPortMessage?.({
    type: 'signal',
    requestId: 'req-ok',
    signal: { type: 'offer', sdp: 'v=0\r\nm=video 9 UDP/TLS/RTP/SAVPF 96\r\na=recvonly\r\n' },
  });
  await new Promise(resolve => setTimeout(resolve, 20));
  expect(peerStub.createAnswer).toHaveBeenCalledOnce();
  expect(postMessage).toHaveBeenCalledWith({
    type: 'signal',
    requestId: 'req-ok',
    signal: { type: 'answer', sdp: 'v=0\r\nm=video 9 UDP/TLS/RTP/SAVPF 96\r\na=sendonly\r\n' },
  });
  onPortMessage?.({ type: 'stop' });
});
