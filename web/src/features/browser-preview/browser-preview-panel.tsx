import { Maximize2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { BROWSER_PREVIEW_LEASE_MS, BROWSER_PREVIEW_REQUEST_MS, type BrowserPreviewIce, type BrowserPreviewQuality, type BrowserPreviewServerMessage } from '@xopcai/realtime-protocol';

import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { ManagedBrowserView } from '@/features/browser-preview/managed-browser-view';
import { listenGatewayBrowserPreview, sendGatewayBrowserPreview } from '@/features/gateway/gateway-realtime';
import { apiFetch } from '@/lib/fetch';
import { apiUrl } from '@/lib/url';
import { useGatewayRealtimeStore } from '@/stores/gateway-realtime-store';
import { useGatewayStore } from '@/stores/gateway-store';
import { useLocaleStore } from '@/stores/locale-store';

type Status = 'connecting' | 'waiting' | 'ready' | 'snapshot' | 'unavailable' | 'no-response' | 'ended' | 'expired' | 'busy';

export function BrowserPreviewPanel({ conversationId, mode = 'extension' }: { conversationId: string; mode?: 'extension' | 'managed' }) {
  if (mode === 'managed') return <ManagedBrowserView conversationId={conversationId} />;
  return <ExtensionBrowserPreviewPanel conversationId={conversationId} />;
}

function ExtensionBrowserPreviewPanel({ conversationId }: { conversationId: string }) {
  const zh = useLocaleStore(state => state.language === 'zh');
  const identity = useGatewayStore(state => state.conversationId);
  const connected = useGatewayRealtimeStore(state => state.connectionState === 'connected');
  const stage = useRef<HTMLDivElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const probeVideo = useRef<(() => void) | null>(null);
  const [status, setStatus] = useState<Status>('connecting');
  const [origin, setOrigin] = useState('');
  const [snapshot, setSnapshot] = useState('');
  const [quality, setQuality] = useState<BrowserPreviewQuality>('normal');
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!connected || !video.current) { setStatus('unavailable'); return; }
    const element = video.current;
    const requestId = crypto.randomUUID();
    const requestDeadline = performance.now() + BROWSER_PREVIEW_REQUEST_MS;
    const candidates: RTCIceCandidateInit[] = [];
    const outgoing: RTCIceCandidateInit[] = [];
    let peer: RTCPeerConnection | undefined;
    let pendingApproval: { ice?: BrowserPreviewIce } | undefined;
    let accepted = false;
    let stopped = false;
    let offerSent = false;
    let restarted = false;
    let mode: BrowserPreviewQuality = 'normal';
    let monitor: ReturnType<typeof setInterval> | undefined;
    let snapshotAbort: AbortController | undefined;
    let snapshotAddress = '';
    let recoveringAt = 0;
    let probeAt = 0;
    let badSamples = 0;
    let goodSamples = 0;
    let freezeCount = 0;
    let frames = 0;
    let packets: { received: number; lost: number } | undefined;
    let playing = false;
    let mediaDeadline: ReturnType<typeof setTimeout> | undefined;
    let renew: ReturnType<typeof setInterval> | undefined;
    let expires: ReturnType<typeof setTimeout>;
    let signals = Promise.resolve();
    setStatus('connecting');
    setOrigin('');
    setQuality('normal');
    setSnapshot('');

    function send(message: Parameters<typeof sendGatewayBrowserPreview>[0]): boolean {
      try { sendGatewayBrowserPreview(message); return true; } catch { return false; }
    }

    function stopSnapshotPolling(): void {
      snapshotAbort?.abort();
      snapshotAbort = undefined;
    }

    function clearSnapshot(): void {
      stopSnapshotPolling();
      if (snapshotAddress) URL.revokeObjectURL(snapshotAddress);
      snapshotAddress = '';
      setSnapshot('');
    }

    function selectQuality(next: BrowserPreviewQuality, keepSnapshotUntilFrame = false): void {
      if (stopped || next === mode) return;
      if (!send({ type: 'quality', requestId, quality: next })) { stop('unavailable'); return; }
      mode = next;
      setQuality(next);
      if (next === 'snapshot') {
        recoveringAt = performance.now() + 15_000;
        probeAt = 0;
        setStatus('snapshot');
      } else if (keepSnapshotUntilFrame) {
        stopSnapshotPolling();
      } else if (snapshotAbort || snapshotAddress) {
        clearSnapshot();
      }
    }

    probeVideo.current = () => {
      if (stopped || mode !== 'snapshot') return;
      if (peer?.connectionState === 'connected') {
        probeAt = performance.now() + 3500;
        selectQuality('low', true);
      } else {
        setAttempt(value => value + 1);
      }
    };

    async function loadSnapshots(token: string): Promise<void> {
      stopSnapshotPolling();
      const controller = snapshotAbort = new AbortController();
      let after = 0;
      let receivedAt = snapshotAddress ? performance.now() : 0;
      while (!controller.signal.aborted) {
        try {
          const response = await apiFetch(apiUrl(`/api/browser/preview/${requestId}/snapshot?after=${after}`), {
            signal: AbortSignal.any([controller.signal, AbortSignal.timeout(1400)]),
            headers: { 'X-Xopc-Preview': token },
          });
          if (response.status === 200) {
            const data = await response.blob();
            if (controller.signal.aborted) return;
            after = Number(response.headers.get('X-Xopc-Preview-Frame')) || after;
            if (snapshotAddress) URL.revokeObjectURL(snapshotAddress);
            snapshotAddress = URL.createObjectURL(data);
            setSnapshot(snapshotAddress);
            receivedAt = performance.now();
          } else if (response.status === 403 || response.status === 404) {
            if (!controller.signal.aborted) stop('ended');
            return;
          }
        } catch { /* A later current frame supersedes transient network errors. */ }
        if (controller.signal.aborted) return;
        if (snapshotAddress && performance.now() - receivedAt > 2000) {
          URL.revokeObjectURL(snapshotAddress); snapshotAddress = ''; setSnapshot('');
        }
        await new Promise(resolve => setTimeout(resolve, 600));
      }
    }

    function stop(reason: Status, notify = true): void {
      if (stopped) return;
      stopped = true;
      probeVideo.current = null;
      clearTimeout(expires);
      clearInterval(renew);
      clearTimeout(mediaDeadline);
      clearInterval(monitor);
      clearSnapshot();
      peer?.close();
      element.srcObject = null;
      if (notify) send({ type: 'close', requestId });
      setStatus(reason);
    }

    function armLease(ms: number): void {
      clearTimeout(expires);
      const duration = accepted ? ms : Math.max(0, Math.min(ms, requestDeadline - performance.now()));
      expires = setTimeout(() => stop('expired'), duration);
    }

    function outgoingCandidate(candidate: RTCIceCandidateInit): void {
      if (!candidate.candidate) return;
      if (!send({ type: 'signal', requestId, signal: { type: 'candidate', ...candidate, candidate: candidate.candidate } })) stop('unavailable');
    }

    async function makeOffer(connection: RTCPeerConnection, iceRestart = false): Promise<void> {
      offerSent = false;
      await connection.setLocalDescription(await connection.createOffer({ iceRestart }));
      if (stopped || !connection.localDescription) return;
      if (!send({ type: 'signal', requestId, signal: { type: 'offer', sdp: connection.localDescription.sdp } })) {
        stop('unavailable');
        return;
      }
      offerSent = true;
      outgoing.splice(0).forEach(outgoingCandidate);
    }

    function onTransportFailure(): void {
      if (stopped || mode === 'snapshot') return;
      if (peer?.remoteDescription && peer.signalingState === 'stable' && !restarted) {
        restarted = true;
        clearTimeout(mediaDeadline);
        mediaDeadline = setTimeout(() => selectQuality('snapshot'), 3000);
        void makeOffer(peer, true).catch(() => selectQuality('snapshot'));
      } else selectQuality('snapshot');
    }

    async function sampleStats(connection: RTCPeerConnection): Promise<void> {
      const stats = await connection.getStats();
      if (stopped) return;
      const inbound = Array.from(stats.values()).find(entry => entry.type === 'inbound-rtp' && entry.kind === 'video');
      const previousFrames = frames;
      frames = inbound?.framesDecoded ?? frames;
      const freezes = inbound?.freezeCount ?? freezeCount;
      const previousPackets = packets;
      packets = inbound && { received: inbound.packetsReceived ?? 0, lost: inbound.packetsLost ?? 0 };
      const received = packets && previousPackets ? Math.max(0, packets.received - previousPackets.received) : 0;
      const lost = packets && previousPackets ? Math.max(0, packets.lost - previousPackets.lost) : 0;
      if (mode === 'snapshot') {
        if (connection.connectionState === 'connected' && performance.now() >= recoveringAt) {
          probeAt = performance.now() + 3500;
          selectQuality('low', true);
        }
        return;
      }
      if (probeAt) {
        if (frames > previousFrames) {
          probeAt = 0;
          playing = true;
          clearSnapshot();
          setStatus('ready');
        } else if (performance.now() >= probeAt) selectQuality('snapshot');
        return;
      }
      if (!playing) return;
      const transport = Array.from(stats.values()).find(entry => entry.type === 'transport' && entry.selectedCandidatePairId);
      const pair = transport && stats.get(transport.selectedCandidatePairId);
      const congested = freezes > freezeCount || (pair?.currentRoundTripTime ?? 0) >= 0.25
        || (received + lost >= 20 && lost / (received + lost) >= 0.03);
      freezeCount = freezes;
      badSamples = congested ? badSamples + 1 : 0;
      goodSamples = congested ? 0 : goodSamples + 1;
      if (mode === 'normal' && badSamples >= 2) { badSamples = 0; selectQuality('low'); }
      else if (mode === 'low' && badSamples >= 5) selectQuality('snapshot');
      else if (mode === 'low' && goodSamples >= 10) selectQuality('normal');
    }

    async function startPeer(ice?: BrowserPreviewIce): Promise<void> {
      setStatus('connecting');
      const connection = peer = new RTCPeerConnection(ice);
      mediaDeadline = setTimeout(onTransportFailure, 5000);
      monitor = setInterval(() => { void sampleStats(connection).catch(() => {}); }, 1000);
      connection.onconnectionstatechange = () => {
        if (connection.connectionState === 'failed') onTransportFailure();
        else if (connection.connectionState === 'disconnected') {
          clearTimeout(mediaDeadline);
          mediaDeadline = setTimeout(onTransportFailure, 2000);
        } else if (connection.connectionState === 'connected' && playing) clearTimeout(mediaDeadline);
      };
      connection.onicecandidate = ({ candidate }) => {
        if (!candidate || stopped) return;
        if (offerSent) outgoingCandidate(candidate.toJSON());
        else if (outgoing.length < 64) outgoing.push(candidate.toJSON());
      };
      connection.ontrack = ({ track, streams }) => {
        if (stopped || track.kind !== 'video') return;
        element.srcObject = streams[0] ?? new MediaStream([track]);
        void element.play().catch(onTransportFailure);
      };
      const transceiver = connection.addTransceiver('video', { direction: 'recvonly' });
      const codecs = RTCRtpReceiver.getCapabilities?.('video')?.codecs ?? [];
      const h264 = codecs.filter(codec => codec.mimeType === 'video/H264');
      if (h264.length && transceiver.setCodecPreferences) {
        transceiver.setCodecPreferences([...h264, ...codecs.filter(codec => codec.mimeType !== 'video/H264')]);
      }
      await makeOffer(connection);
    }

    async function startApprovedPreview(): Promise<void> {
      if (stopped || document.hidden || !pendingApproval) return;
      const { ice } = pendingApproval;
      pendingApproval = undefined;
      const starting = startPeer(ice);
      armLease(BROWSER_PREVIEW_LEASE_MS);
      await starting;
    }

    async function handle(message: BrowserPreviewServerMessage): Promise<void> {
      if (stopped || message.requestId !== requestId) return;
      if (message.type === 'waiting') {
        armLease(BROWSER_PREVIEW_REQUEST_MS);
        setOrigin(message.origin);
        setStatus('waiting');
      } else if (message.type === 'accepted' && !peer && !pendingApproval) {
        accepted = true;
        pendingApproval = { ice: message.ice };
        armLease(BROWSER_PREVIEW_LEASE_MS);
        renew = setInterval(() => { if (!send({ type: 'renew', requestId })) stop('unavailable'); }, 3000);
        await startApprovedPreview();
      } else if (message.type === 'quality' && message.quality === 'snapshot' && message.snapshotToken && mode === 'snapshot') {
        void loadSnapshots(message.snapshotToken);
      } else if (message.type === 'lease') {
        armLease(BROWSER_PREVIEW_LEASE_MS);
      } else if (message.type === 'closed') {
        stop(message.reason, false);
      } else if (message.type === 'signal' && peer) {
        const signal = message.signal;
        if (signal.type === 'answer') {
          await peer.setRemoteDescription({ type: 'answer', sdp: signal.sdp });
          for (const candidate of candidates.splice(0)) await peer.addIceCandidate(candidate).catch(() => {});
        } else if (signal.type === 'candidate') {
          if (peer.remoteDescription && peer.signalingState === 'stable') await peer.addIceCandidate(signal).catch(() => {});
          else if (candidates.length < 64) candidates.push(signal);
        }
      }
    }

    const unsubscribe = listenGatewayBrowserPreview(message => {
      if (message.requestId !== requestId) return;
      if (message.type === 'closed') { stop(message.reason, false); return; }
      signals = signals.then(() => handle(message)).catch(() => stop('unavailable'));
    });
    const onPlaying = () => {
      if (stopped) return;
      clearTimeout(mediaDeadline);
      if (!playing) {
        playing = true;
        if (mode !== 'snapshot' && !probeAt) {
          clearSnapshot();
          setStatus('ready');
        }
      }
    };
    const onVisibility = () => { void startApprovedPreview().catch(() => stop('unavailable')); };
    const onPageHide = () => stop('ended');
    element.addEventListener('playing', onPlaying);
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', onPageHide);
    expires = setTimeout(() => stop('no-response'), 5000);
    if (document.hidden || !send({ type: 'view', requestId, conversationId })) stop('unavailable', false);
    return () => {
      unsubscribe();
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', onPageHide);
      element.removeEventListener('playing', onPlaying);
      stop('ended');
    };
  }, [attempt, connected, conversationId, identity]);

  const copy = {
    connecting: zh ? '正在连接浏览器' : 'Connecting to browser',
    waiting: zh ? '在来源 Chrome 的任务标签上，点一下工具栏的 xopc 图标即可共享。' : 'Click the xopc toolbar icon once on the source Chrome tab to share it.',
    ready: zh ? '实时画面' : 'Live view',
    snapshot: zh ? '低帧率预览' : 'Low frame-rate preview',
    unavailable: zh ? '当前任务的浏览器画面不可用。' : 'The browser preview is unavailable for this task.',
    'no-response': zh ? 'Gateway 未响应浏览器预览请求。' : 'The Gateway did not respond to the browser preview request.',
    ended: zh ? '浏览器画面已停止共享。' : 'The browser preview has stopped.',
    expired: zh ? '观看请求或连接已过期。' : 'The preview request or connection has expired.',
    busy: zh ? '已有设备正在观看或等待共享。' : 'Another device is viewing or waiting to connect.',
  };
  const loading = status === 'connecting' || status === 'waiting';
  const showHeader = Boolean(origin) || status === 'ready' || status === 'snapshot';
  const canFullscreen = (status === 'ready' || (status === 'snapshot' && Boolean(snapshot)))
    && typeof document !== 'undefined' && document.fullscreenEnabled !== false;
  const toggleFullscreen = () => {
    const host = stage.current;
    if (!host) return;
    if (document.fullscreenElement) void document.exitFullscreen?.().catch(() => {});
    else void host.requestFullscreen?.().catch(() => {});
  };
  return <section className="flex min-h-0 flex-1 flex-col overflow-hidden bg-surface-base">
    {showHeader ? <div className="flex items-center justify-between gap-2 border-b border-edge px-3 py-1.5 text-xs text-fg-muted">
      <div className="flex min-w-0 items-center gap-2">
        {status === 'ready' ? <span className="size-2 shrink-0 rounded-full bg-emerald-500" aria-hidden /> : null}
        <span className="truncate">{origin || copy[status]}</span>
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        {status === 'ready' ? <span>{quality === 'low' ? (zh ? '弱网 · 已降低画质' : 'Weak connection') : copy.ready}</span> : null}
        {canFullscreen ? <button type="button" onClick={toggleFullscreen}
          className="rounded p-1 text-fg-muted hover:bg-surface-hover hover:text-fg"
          aria-label={zh ? '全屏查看' : 'Fullscreen'} title={zh ? '全屏查看' : 'Fullscreen'}>
          <Maximize2 className="size-3.5" aria-hidden />
        </button> : null}
      </div>
    </div> : null}
    <div ref={stage} className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
      <video ref={video} muted playsInline autoPlay aria-label={copy.ready}
        className={status === 'ready' ? 'min-h-0 h-full w-full flex-1 object-contain' : 'pointer-events-none absolute inset-0 h-full w-full object-contain opacity-0'} />
      {status === 'snapshot' && snapshot ? <img src={snapshot} alt={copy.snapshot} className="min-h-0 w-full flex-1 object-contain" /> : null}
      {status !== 'ready' ? <div role="status" className={status === 'snapshot' && snapshot ? 'flex items-center justify-center gap-2 p-2 text-center' : 'mx-auto flex w-full max-w-md flex-1 flex-col items-center justify-center gap-4 p-5 text-center'}>
        {loading || (status === 'snapshot' && !snapshot) ? <Skeleton className="aspect-video w-full rounded-lg" /> : null}
        <p className="text-sm text-fg-muted">{copy[status]}</p>
        {status === 'snapshot' ? <Button variant="secondary" className="h-7 px-2.5 text-xs" disabled={!connected} onClick={() => probeVideo.current?.()}>{zh ? '尝试恢复视频' : 'Try video'}</Button> : null}
        {!loading && status !== 'snapshot' ? <Button variant="secondary" disabled={!connected} onClick={() => setAttempt(value => value + 1)}>{zh ? '重试' : 'Retry'}</Button> : null}
      </div> : null}
    </div>
  </section>;
}
