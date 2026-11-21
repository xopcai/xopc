import type { BrowserPreviewQuality, BrowserPreviewServerMessage, BrowserPreviewSignal } from '@xopcai/realtime-protocol';

export type PreviewDocumentMessage =
  | { type: 'ready' }
  | { type: 'signal'; requestId: string; signal: BrowserPreviewSignal }
  | { type: 'snapshot'; requestId: string; jpeg: string };

type PreviewDocumentCommand = Extract<BrowserPreviewServerMessage, { type: 'accepted' | 'lease' | 'signal' | 'closed' | 'quality' }>
  | { type: 'stop' };

// Chrome serializes this function when injecting it into a particular document.
export async function startPreviewDocument(requestId: string, streamId: string, origin: string, leaseMs: number): Promise<boolean> {
  const sensitivePath = /(?:^|[/#?&=])(?:login|log-in|log_in|signin|sign-in|sign_in|oauth|sso|auth|checkout|payment|pay|billing|mfa|2fa|otp|verify|security)(?:[/#?&=]|$)/i;
  const sensitiveFrameHost = /(?:^|\.)(?:stripe\.com|paypal\.com|adyen\.com|braintreegateway\.com|checkout\.com|square\.com|squareup\.com|accounts\.google\.com|login\.microsoftonline\.com|appleid\.apple\.com|auth0\.com|okta\.com|clerk\.accounts\.dev)$/i;
  const sensitiveInputSelector = 'input[type="password"], input[autocomplete="one-time-code"], input[autocomplete^="cc-"]';

  function isSensitiveFrame(frame: Element): boolean {
    const src = frame.getAttribute('src');
    if (!src) return false;
    try {
      const target = new URL(src, location.href);
      return sensitiveFrameHost.test(target.hostname) || sensitivePath.test(`${target.pathname}${target.hash}`);
    } catch {
      return false;
    }
  }

  function hasSensitiveSubtree(root: ParentNode, depth = 0): boolean {
    if (depth > 4) return false;
    if (root instanceof Element) {
      if (root.matches(sensitiveInputSelector)) return true;
      if (root.tagName === 'IFRAME' && isSensitiveFrame(root)) return true;
      if (root.shadowRoot && hasSensitiveSubtree(root.shadowRoot, depth + 1)) return true;
    }
    if (root.querySelector(sensitiveInputSelector)) return true;
    for (const frame of root.querySelectorAll('iframe[src]')) {
      if (isSensitiveFrame(frame)) return true;
    }
    const elements = root.querySelectorAll('*');
    const limit = Math.min(elements.length, 400);
    for (let i = 0; i < limit; i += 1) {
      const shadow = elements[i]?.shadowRoot;
      if (shadow && hasSensitiveSubtree(shadow, depth + 1)) return true;
    }
    return false;
  }

  function isSensitiveDocument(): boolean {
    if (location.origin !== origin) return true;
    if (sensitivePath.test(`${location.pathname}${location.hash}`)) return true;
    return hasSensitiveSubtree(document);
  }

  // Reject before connecting a runtime port so synchronous disconnect never drops onConnect.
  if (isSensitiveDocument()) return false;

  const port = chrome.runtime.connect({ name: `browser-preview:${requestId}` });
  const navigation = (window as Window & { navigation?: EventTarget }).navigation;
  type Viewer = { peer: RTCPeerConnection; lease?: ReturnType<typeof setTimeout>; candidates: RTCIceCandidateInit[];
    signals: Promise<void>; quality: BrowserPreviewQuality };
  const viewers = new Map<string, Viewer>();
  let stream: MediaStream | undefined;
  let waiting: ReturnType<typeof setTimeout> | undefined;
  let snapshotTimer: ReturnType<typeof setInterval> | undefined;
  let snapshotVideo: HTMLVideoElement | undefined;
  let canvas: HTMLCanvasElement | undefined;
  let closed = false;

  function close(): void {
    if (closed) return;
    closed = true;
    clearTimeout(waiting);
    clearInterval(snapshotTimer);
    if (snapshotVideo) snapshotVideo.srcObject = null;
    for (const viewer of viewers.values()) {
      clearTimeout(viewer.lease);
      viewer.peer.close();
    }
    viewers.clear();
    observer.disconnect();
    removeEventListener('pagehide', close);
    removeEventListener('popstate', checkDocument);
    removeEventListener('hashchange', checkDocument);
    navigation?.removeEventListener('navigate', onNavigate);
    document.removeEventListener('focusin', checkDocument);
    stream?.getTracks().forEach(track => track.stop());
    port.disconnect();
  }

  function checkDocument(): void {
    if (isSensitiveDocument()) close();
  }

  function onNavigate(event: Event): void {
    const { destination } = event as Event & { destination: { url: string; sameDocument: boolean } };
    let target: URL;
    try { target = new URL(destination.url); } catch { close(); return; }
    if (!destination.sameDocument || target.origin !== origin || sensitivePath.test(`${target.pathname}${target.hash}`)) close();
  }

  function onMutations(records: MutationRecord[]): void {
    if (closed) return;
    if (location.origin !== origin || sensitivePath.test(`${location.pathname}${location.hash}`)) { close(); return; }
    for (const record of records) {
      if (record.type === 'attributes') {
        if (record.target instanceof Element && hasSensitiveSubtree(record.target)) { close(); return; }
      } else if (record.type === 'childList') {
        for (const node of record.addedNodes) {
          if (node instanceof Element && hasSensitiveSubtree(node)) { close(); return; }
        }
      }
    }
  }

  function remove(id: string): void {
    const viewer = viewers.get(id);
    if (!viewer) return;
    clearTimeout(viewer.lease);
    viewer.peer.close();
    viewers.delete(id);
    if (!viewers.size) close();
    else updateSnapshotTimer();
  }

  function renew(id: string, viewer: Viewer): void {
    clearTimeout(viewer.lease);
    viewer.lease = setTimeout(() => remove(id), leaseMs);
  }

  function updateSnapshotTimer(): void {
    const needed = [...viewers.values()].some(viewer => viewer.quality === 'snapshot');
    if (needed && !snapshotTimer && stream) {
      snapshotVideo ??= document.createElement('video');
      snapshotVideo.muted = true;
      snapshotVideo.srcObject = stream;
      void snapshotVideo.play().catch(() => {});
      canvas ??= document.createElement('canvas');
      snapshotTimer = setInterval(() => {
        checkDocument();
        if (closed || !snapshotVideo?.videoWidth || !canvas) return;
        const scale = Math.min(1, 480 / Math.max(snapshotVideo.videoWidth, snapshotVideo.videoHeight));
        canvas.width = Math.max(1, Math.round(snapshotVideo.videoWidth * scale));
        canvas.height = Math.max(1, Math.round(snapshotVideo.videoHeight * scale));
        canvas.getContext('2d')?.drawImage(snapshotVideo, 0, 0, canvas.width, canvas.height);
        const jpeg = canvas.toDataURL('image/jpeg', 0.62).slice('data:image/jpeg;base64,'.length);
        for (const [id, viewer] of viewers) {
          if (viewer.quality === 'snapshot') port.postMessage({ type: 'snapshot', requestId: id, jpeg } satisfies PreviewDocumentMessage);
        }
      }, 600);
    } else if (!needed && snapshotTimer) {
      clearInterval(snapshotTimer);
      snapshotTimer = undefined;
      if (snapshotVideo) snapshotVideo.srcObject = null;
    }
  }

  async function applyQuality(viewer: Viewer): Promise<void> {
    updateSnapshotTimer();
    const sender = viewer.peer.getSenders().find(candidate => candidate.track?.kind === 'video');
    if (!sender) return;
    const parameters = sender.getParameters();
    const encoding = parameters.encodings[0];
    if (!encoding) return;
    // Leave frame rate to WebRTC; Chromium can apply a cap to the shared tab capture source.
    encoding.active = viewer.quality !== 'snapshot';
    encoding.maxBitrate = viewer.quality === 'normal' ? 2_000_000 : 480_000;
    encoding.scaleResolutionDownBy = viewer.quality === 'normal' ? 1 : 1.6;
    try { await sender.setParameters(parameters); } catch { /* The local encoder can still adapt on its own. */ }
  }

  async function onSignal(id: string, viewer: Viewer, signal: BrowserPreviewSignal): Promise<void> {
    const { peer, candidates } = viewer;
    if (signal.type === 'candidate') {
      if (peer.remoteDescription) await peer.addIceCandidate(signal).catch(() => {});
      else if (candidates.length < 64) candidates.push(signal);
      return;
    }
    if (signal.type !== 'offer' || !stream || peer.signalingState !== 'stable') return;
    const mediaLines = signal.sdp.match(/^m=.*$/gm) ?? [];
    if (mediaLines.length !== 1 || !mediaLines[0]?.startsWith('m=video ') || !/^a=recvonly\s*$/m.test(signal.sdp)) return;
    await peer.setRemoteDescription({ type: 'offer', sdp: signal.sdp });
    for (const candidate of candidates.splice(0)) await peer.addIceCandidate(candidate).catch(() => {});
    const transceiver = peer.getTransceivers()[0];
    const track = stream.getVideoTracks()[0];
    if (closed || viewers.get(id) !== viewer || !transceiver || !track) return;
    transceiver.direction = 'sendonly';
    await transceiver.sender.replaceTrack(track);
    await peer.setLocalDescription(await peer.createAnswer());
    if (closed || viewers.get(id) !== viewer || !peer.localDescription) return;
    port.postMessage({ type: 'signal', requestId: id,
      signal: { type: 'answer', sdp: peer.localDescription.sdp } } satisfies PreviewDocumentMessage);
    await applyQuality(viewer);
  }

  const observer = new MutationObserver(onMutations);
  addEventListener('pagehide', close, { once: true });
  addEventListener('popstate', checkDocument);
  addEventListener('hashchange', checkDocument);
  navigation?.addEventListener('navigate', onNavigate);
  document.addEventListener('focusin', checkDocument);
  observer.observe(document, { childList: true, subtree: true, attributes: true, attributeFilter: ['type', 'autocomplete', 'src'] });
  port.onDisconnect.addListener(close);
  port.onMessage.addListener((message: PreviewDocumentCommand) => {
    if (message.type === 'stop') { close(); return; }
    const id = message.requestId;
    if (message.type === 'accepted') {
      if (closed || !stream || viewers.has(id) || viewers.size >= 2) return;
      clearTimeout(waiting);
      const peer = new RTCPeerConnection(message.ice);
      const viewer: Viewer = { peer, candidates: [], signals: Promise.resolve(), quality: 'normal' };
      viewers.set(id, viewer);
      renew(id, viewer);
      peer.onicecandidate = ({ candidate }) => {
        if (candidate && viewers.get(id) === viewer) {
          port.postMessage({ type: 'signal', requestId: id, signal: { type: 'candidate',
            ...candidate.toJSON(), candidate: candidate.candidate } } satisfies PreviewDocumentMessage);
        }
      };
      return;
    }
    const viewer = viewers.get(id);
    if (!viewer) return;
    if (message.type === 'closed') { remove(id); return; }
    if (message.type === 'lease') { renew(id, viewer); return; }
    viewer.signals = viewer.signals.then(() => {
      if (closed || viewers.get(id) !== viewer) return;
      if (message.type === 'quality') { viewer.quality = message.quality; return applyQuality(viewer); }
      return onSignal(id, viewer, message.signal);
    }).catch(() => { /* The receiver can fall back while the capture lease is active. */ });
  });

  checkDocument();
  if (closed) return false;
  waiting = setTimeout(close, leaseMs);
  try {
    const captured = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { mandatory: { chromeMediaSource: 'tab', chromeMediaSourceId: streamId, maxWidth: 1280,
        maxHeight: 720, maxFrameRate: 30 } } as MediaTrackConstraints,
    });
    if (closed) { captured.getTracks().forEach(track => track.stop()); return false; }
    stream = captured;
    const track = stream.getVideoTracks()[0];
    if (!track) { close(); return false; }
    track.contentHint = 'detail';
    track.addEventListener('ended', close, { once: true });
    checkDocument();
    if (!closed) {
      port.postMessage({ type: 'ready' } satisfies PreviewDocumentMessage);
      return true;
    }
    return false;
  } catch {
    close();
    return false;
  }
}
