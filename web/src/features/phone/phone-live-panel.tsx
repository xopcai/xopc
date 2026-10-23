import { ArrowLeft, Hand, Keyboard, Loader2, Pause, Play, Square } from 'lucide-react';
import { useEffect, useRef, useState, type PointerEvent } from 'react';

import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useLocaleStore } from '@/stores/locale-store';
import { cn } from '@/lib/cn';
import { controlPhone, phoneEnded, phoneFrame, phonePoint, type PhoneAction, type PhoneLiveState } from './phone-live-api';
import { usePhoneVideo } from './use-phone-video';

type Frame = { url: string; seq: number; capturedAt: number; width: number; height: number };
export function PhoneLivePanel({ conversationId, state, onChange }: {
  conversationId: string; state: PhoneLiveState; onChange: (state?: PhoneLiveState) => void;
}) {
  const zh = useLocaleStore(s => s.language) === 'zh';
  const [frame, setFrame] = useState<Frame>();
  const [error, setError] = useState(''); const [frameError, setFrameError] = useState('');
  const [busy, setBusy] = useState(''); const [text, setText] = useState(''); const [now, setNow] = useState(Date.now());
  const [showText, setShowText] = useState(false);
  const refreshFrame = useRef<(() => void) | undefined>(undefined);
  const [visible, setVisible] = useState(document.visibilityState === 'visible');
  const latest = useRef(state); latest.current = state;
  const busyRef = useRef(false); const urlRef = useRef('');
  const gesture = useRef<{ point: number[]; at: number; seq: number } | null>(null);
  const ended = phoneEnded(state.report.status);
  const working = state.report.handoff !== undefined && state.report.handoff !== 'idle';
  const human = state.ownControl && state.report.controlOwner === 'human';
  const canvas = useRef<HTMLCanvasElement>(null);
  const video = usePhoneVideo(conversationId, state.report.sessionId, !ended && visible, canvas, state.report.controlEpoch);
  const videoPlaying = video.status === 'playing';
  const snapshot = video.status === 'fallback';
  const paused = state.report.controlOwner === 'none' || ['paused', 'needs_user'].includes(state.report.status);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    const release = () => {
      const current = latest.current;
      if (current.ownControl && !phoneEnded(current.report.status)) void controlPhone(conversationId, current, 'release', {}, true).catch(() => {});
    };
    const visibility = () => { setVisible(document.visibilityState === 'visible'); if (document.hidden) release(); };
    window.addEventListener('pagehide', release); document.addEventListener('visibilitychange', visibility);
    return () => { release(); window.removeEventListener('pagehide', release); document.removeEventListener('visibilitychange', visibility); };
  }, [conversationId]);
  useEffect(() => {
    if (!human || !visible) return;
    const heartbeat = setInterval(() => { void controlPhone(conversationId, latest.current, 'heartbeat').catch(() => onChange()); }, 5000);
    return () => clearInterval(heartbeat);
  }, [conversationId, human, visible, onChange]);
  useEffect(() => {
    if (ended || !visible || !snapshot) { setFrame(undefined); if (urlRef.current) URL.revokeObjectURL(urlRef.current); urlRef.current = ''; return; }
    const abort = new AbortController(); let disposed = false; let timer: ReturnType<typeof setTimeout>; let inFlight = false;
    const update = async () => {
      if (disposed || inFlight) return;
      inFlight = true; clearTimeout(timer); const started = performance.now();
      try {
        if (!gesture.current) {
          const result = await phoneFrame(conversationId, state.report.sessionId, abort.signal);
          if (!disposed && !gesture.current) {
            const url = URL.createObjectURL(result.blob); const previous = urlRef.current;
            urlRef.current = url; setFrame({ ...result, url }); setFrameError('');
            if (previous) URL.revokeObjectURL(previous);
          }
        }
      } catch (failure) {
        if (!disposed) {
          setFrameError(zh && (failure as { code?: string }).code === 'PHONE_APP_DENIED' ? '当前页面不在授权应用范围内，请返回授权应用。' : failure instanceof Error ? failure.message : String(failure));
          // Never retain pixels after an authorization, app or device refusal.
          setFrame(undefined); if (urlRef.current) URL.revokeObjectURL(urlRef.current); urlRef.current = '';
        }
      } finally { inFlight = false; if (!disposed) timer = setTimeout(() => void update(), Math.max(50, (latest.current.ownControl ? 250 : 800) - (performance.now() - started))); }
    };
    const refresh = () => { void update(); }; refreshFrame.current = refresh;
    void update();
    return () => { if (refreshFrame.current === refresh) refreshFrame.current = undefined; disposed = true; abort.abort(); clearTimeout(timer); if (urlRef.current) URL.revokeObjectURL(urlRef.current); urlRef.current = ''; };
  }, [conversationId, state.report.sessionId, ended, visible, zh, snapshot]);
  async function command(op: string, action?: PhoneAction, frameSeq?: number) {
    if (busyRef.current) return;
    video.cancel(); busyRef.current = true; setBusy(op); setError('');
    try { onChange(await controlPhone(conversationId, latest.current, op, { action, frameSeq, ...(videoPlaying && video.geometry ? { geometry: video.geometry.version } : {}) })); return true; }
    catch (failure) { setError(failure instanceof Error ? failure.message : String(failure)); onChange(); return false; }
    finally { busyRef.current = false; setBusy(''); refreshFrame.current?.(); }
  }
  async function sendText() {
    if (!text || (!frame && !videoPlaying)) return;
    const sent = text;
    if (await command('input', { type: 'typeText', text: sent }, frame?.seq)) setText(current => current === sent ? '' : current);
  }
  function point(event: PointerEvent<HTMLImageElement>) {
    return frame ? phonePoint(event.currentTarget.getBoundingClientRect(), frame.width, frame.height, event.clientX, event.clientY) : null;
  }
  const age = frame ? Math.max(0, (now - frame.capturedAt) / 1000) : null;
  const title = ended ? (zh ? '操作已结束' : 'Session ended') : working ? (zh ? '正在交接控制权…' : 'Transferring control…')
    : human ? (zh ? `你正在操作 · ${state.report.agentId} 已暂停` : 'You control the phone · Agent paused')
      : state.report.controlOwner === 'human' ? (zh ? '另一窗口正在操作' : 'Controlled in another window')
        : paused ? (zh ? '仅查看 · 等待你处理' : 'View only · Awaiting your input')
          : (zh ? `仅查看 · ${state.report.agentId} 正在操作` : `View only · ${state.report.agentId} is operating`);
  return <section className="flex min-h-0 flex-1 flex-col overflow-hidden bg-surface-base" aria-label={zh ? '手机实时画面' : 'Live phone'}>
    <div className="shrink-0 border-b border-edge px-3 py-2">
      <div className="truncate text-sm font-medium text-fg" title={state.report.modelRef}>{state.report.deviceName}</div>
      <div className="mt-2 flex rounded-lg border border-edge p-1" aria-label={zh ? '手机交互模式' : 'Phone interaction mode'}>
        <Button variant={human ? 'ghost' : 'secondary'} className="min-h-8 flex-1 rounded-md" aria-pressed={!human} disabled={Boolean(busy) || working || ended} onClick={() => human && void command('release')}>{zh ? '仅查看' : 'View only'}</Button>
        <Button variant={human ? 'secondary' : 'ghost'} className="min-h-8 flex-1 rounded-md" aria-pressed={human} disabled={Boolean(busy) || working || ended || state.report.mode !== 'control' || (state.report.controlOwner === 'human' && !human)} onClick={() => !human && void command('takeover')}><Hand className="size-4" aria-hidden />{zh ? '接管操作' : 'Take over'}</Button>
      </div>
      <div role="status" aria-live="polite" className="mt-2 truncate text-xs text-fg">{title}</div>
      {state.report.message ? <p className="mt-1 line-clamp-2 text-xs text-fg-muted">{state.report.message}</p> : null}
    </div>
    <div className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden bg-surface-panel p-3">
      <canvas ref={canvas} aria-label={zh ? '手机视频画面' : 'Phone video screen'}
        data-phone-video-status={video.status} data-phone-video-error={video.error} data-phone-video-frames={video.frames} data-phone-video-fps={video.fps.toFixed(1)} data-phone-input-ack-ms={video.ackMs?.toFixed(1)}
        className={cn('h-full w-full select-none object-contain', videoPlaying ? '' : 'hidden', human ? 'touch-none cursor-crosshair' : 'cursor-default')}
        onPointerDown={event => {
          if (!human || busy || working || !videoPlaying || !video.geometry || event.button !== 0) return;
          const p = phonePoint(event.currentTarget.getBoundingClientRect(), video.geometry.width, video.geometry.height, event.clientX, event.clientY);
          if (!p) return; event.currentTarget.setPointerCapture(event.pointerId); video.pointer('down', p);
        }}
        onPointerMove={event => {
          if (!human || !video.geometry || !event.currentTarget.hasPointerCapture(event.pointerId)) return;
          const p = phonePoint(event.currentTarget.getBoundingClientRect(), video.geometry.width, video.geometry.height, event.clientX, event.clientY);
          if (p) video.pointer('move', p);
        }}
        onPointerUp={event => {
          if (!video.geometry || !event.currentTarget.hasPointerCapture(event.pointerId)) return;
          const p = phonePoint(event.currentTarget.getBoundingClientRect(), video.geometry.width, video.geometry.height, event.clientX, event.clientY);
          if (p) video.pointer('up', p); else video.cancel(); event.currentTarget.releasePointerCapture(event.pointerId);
        }} onPointerCancel={video.cancel} onLostPointerCapture={video.cancel} />
      {!snapshot && !videoPlaying && !ended ? <div className="absolute inset-3 flex items-center justify-center">{video.status === 'blocked' ? <div className="px-4 text-center"><p role="alert" className="text-sm text-fg-muted">{zh ? '当前页面不在授权应用范围内。' : 'This page is outside the authorized applications.'}</p>{human ? state.allowedApps?.map(app => <Button className="mt-3" key={app} onClick={() => void command('recover', { type: 'launch', package: app })}>{zh ? '返回授权应用' : 'Return to allowed app'}</Button>) : null}</div> : <Skeleton className="h-full max-h-[36rem] w-auto aspect-[9/20] rounded-xl" />}</div> : null}
      {frame ? <img src={frame.url} alt={zh ? '手机当前屏幕' : 'Current phone screen'} width={frame.width} height={frame.height} draggable={false}
        className={cn('h-full w-full select-none object-contain', human ? 'touch-none cursor-crosshair' : 'cursor-default')}
        onPointerDown={event => {
          if (!human || busy || working || !frame || (age ?? 99) > 5) return;
          const p = point(event); if (!p) return;
          gesture.current = { point: p, at: Date.now(), seq: frame.seq }; event.currentTarget.setPointerCapture(event.pointerId);
        }} onPointerCancel={() => { gesture.current = null; }}
        onPointerUp={event => {
          const start = gesture.current; gesture.current = null;
          if (!start || !human || busy) return;
          const end = point(event); if (!end) return;
          const duration = Date.now() - start.at;
          const distance = Math.hypot(end[0] - start.point[0], end[1] - start.point[1]);
          const action: PhoneAction = distance > 18 ? { type: 'swipe', start: start.point, end, durationMs: Math.min(1500, Math.max(200, duration)) }
            : duration > 600 ? { type: 'longPress', point: end, durationMs: Math.min(2000, duration) } : { type: 'tap', point: end };
          void command('input', action, start.seq);
        }} /> : ended ? <p className="px-6 text-center text-sm text-fg-muted">{zh ? '会话已结束，停止显示手机画面。' : 'Session ended. Phone preview stopped.'}</p>
          : snapshot && frameError ? <div className="max-h-full overflow-y-auto px-6 text-center"><p role="alert" className="text-sm text-fg-muted">{frameError}</p>{human ? <div className="mt-3 flex flex-wrap justify-center gap-2">{state.allowedApps?.map(app => <Button key={app} disabled={Boolean(busy)} onClick={() => void command('recover', { type: 'launch', package: app })}>{state.allowedApps?.length === 1 ? (zh ? '返回授权应用' : 'Return to allowed app') : `${zh ? '打开' : 'Open'} ${app}`}</Button>)}</div> : null}</div> : snapshot ? <Skeleton className="h-full max-h-[36rem] w-auto aspect-[9/20] rounded-xl" /> : null}
    </div>
    <div className="shrink-0 border-t border-edge px-3 py-2">
      <div className="flex justify-between gap-2 text-xs text-fg-muted"><span>{videoPlaying ? `${zh ? '实时视频' : 'Live video'} · ${video.fps.toFixed(0)} FPS${video.ackMs !== undefined ? ` · ${zh ? '输入应答' : 'Input ACK'} ${video.ackMs.toFixed(0)}ms` : ''}` : !snapshot && !ended ? (zh ? '正在连接视频…' : 'Connecting video…') : age === null ? (ended ? (zh ? '已停止画面采集' : 'Capture stopped') : (zh ? '等待手机画面' : 'Waiting for frame')) : `${zh ? '截图模式' : 'Screenshot mode'} · ${age.toFixed(1)}s ${age > 4 ? (zh ? '· 画面延迟' : '· delayed') : ''}`}</span><span>{state.report.actions} {zh ? '次操作' : 'actions'}</span></div>
      {snapshot && video.error && !ended ? <div className="mt-1 flex items-center justify-between gap-2 text-xs text-fg-muted"><span>{zh ? '视频不可用，已降级为截图。' : 'Video unavailable. Using snapshots.'}</span><button className="shrink-0 text-accent hover:underline" onClick={video.retry}>{zh ? '重试视频' : 'Retry video'}</button></div> : null}
      {error ? <p role="alert" className="mt-2 text-xs text-fg-muted">{error}</p> : null}
      <div className="mt-2 flex gap-2">
        <Button variant="primary" className="min-h-9 flex-1" disabled={Boolean(busy) || working || ended || (state.report.controlOwner === 'human' && !human)} onClick={() => void command(human || paused ? 'handback' : 'takeover')}>
          {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : human || paused ? <Play className="size-4" aria-hidden /> : <Hand className="size-4" aria-hidden />}
          {ended ? (zh ? '已结束' : 'Ended') : human ? (zh ? `交还给 ${state.report.agentId}` : `Hand back to ${state.report.agentId}`) : paused ? (zh ? '继续原任务' : 'Continue task') : (zh ? '接管操作' : 'Take over')}
        </Button>
        <Button className="min-h-9" disabled={Boolean(busy) || working || ended || (state.report.controlOwner === 'human' && !human)} onClick={() => void command(human ? 'release' : 'pause')}><Pause className="size-4" aria-hidden />{human ? (zh ? '退出接管' : 'Release') : (zh ? '暂停' : 'Pause')}</Button>
        <Button className="min-h-9" disabled={Boolean(busy) || ended} onClick={() => void command('cancel')}><Square className="size-4" aria-hidden />{zh ? '停止' : 'Stop'}</Button>
      </div>
      {human ? <div className="mt-2 flex gap-2"><Button aria-label={zh ? '手机返回' : 'Phone back'} disabled={Boolean(busy) || (!frame && !videoPlaying)} onClick={() => void command('input', { type: 'back' }, frame?.seq)}><ArrowLeft className="size-4" aria-hidden /></Button><Button aria-label={zh ? '手机输入' : 'Phone keyboard'} aria-expanded={showText} onClick={() => setShowText(value => !value)}><Keyboard className="size-4" aria-hidden /></Button>{showText ? <><input aria-label={zh ? '发送到手机的文本' : 'Text to send to phone'} placeholder={zh ? '非密码文本' : 'Non-password text'} value={text} onChange={event => setText(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.nativeEvent.isComposing) { event.preventDefault(); void sendText(); } }} className="min-w-0 flex-1 rounded-lg border border-edge bg-surface-base px-2 text-sm focus-visible:outline-2 focus-visible:outline-accent" /><Button disabled={Boolean(busy) || !text || (!frame && !videoPlaying)} onClick={() => { void sendText(); }}>{zh ? '发送' : 'Send'}</Button></> : <span className="self-center text-xs text-fg-muted">{zh ? '点击或拖动 · 退出接管保持暂停' : 'Click or drag · Release keeps the task paused'}</span>}</div> : null}
    </div>
  </section>;
}
