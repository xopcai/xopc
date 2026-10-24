import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { ArrowLeft, Bot, ChevronDown, CircleCheck, Hand, Info, Keyboard, Loader2, MoreHorizontal, Pause, Play, RefreshCw, Smartphone, Square } from 'lucide-react';
import { useEffect, useRef, useState, type CSSProperties, type PointerEvent } from 'react';

import { BetaBadge } from '@/components/ui/beta-badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useLocaleStore } from '@/stores/locale-store';
import { cn } from '@/lib/cn';
import { controlPhone, phoneEnded, phoneFrame, phonePoint, type PhoneAction, type PhoneLiveState } from './phone-live-api';
import { usePhoneVideo } from './use-phone-video';

import './phone-live-panel.css';

type Frame = { url: string; seq: number; capturedAt: number; width: number; height: number };
export function PhoneLivePanel({ conversationId, state, onChange }: {
  conversationId: string; state: PhoneLiveState; onChange: (state?: PhoneLiveState) => void;
}) {
  const zh = useLocaleStore(s => s.language) === 'zh';
  const [frame, setFrame] = useState<Frame>();
  const [error, setError] = useState(''); const [frameError, setFrameError] = useState('');
  const [busy, setBusy] = useState(''); const [text, setText] = useState(''); const [now, setNow] = useState(Date.now());
  const [showText, setShowText] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  const detailsTrigger = useRef<HTMLButtonElement>(null);
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
    video.cancel(); gesture.current = null; busyRef.current = true; setBusy(op); setError('');
    if (['takeover', 'handback', 'release', 'pause', 'cancel'].includes(op)) { setShowText(false); setText(''); }
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
  const otherHuman = state.report.controlOwner === 'human' && !human;
  const controlMode = state.report.mode === 'control';
  const disabled = Boolean(busy) || working || ended || otherHuman;
  const title = ended ? (zh ? '会话已结束' : 'Session ended')
    : busy === 'takeover' || state.report.handoff === 'acquiring' ? (zh ? '正在接管…' : 'Taking control…')
      : busy === 'handback' || state.report.handoff === 'returning' ? (zh ? '正在交还 Agent…' : 'Returning to Agent…')
        : working ? (zh ? '正在交接控制权…' : 'Transferring control…')
          : human ? (zh ? '你正在操作' : 'You control the phone')
            : otherHuman ? (zh ? '另一窗口正在操作' : 'Controlled in another window')
              : !controlMode ? (zh ? '仅查看' : 'View only')
                : paused ? (zh ? '等待你接管' : 'Ready for you to take over')
                  : (zh ? 'Agent 正在操作' : 'Agent is operating');
  const connected = !ended && (videoPlaying || Boolean(frame));
  const connectionLabel = ended ? (zh ? '画面已停止' : 'Preview stopped')
    : video.status === 'blocked' ? (zh ? '画面受限' : 'Preview restricted')
      : snapshot && !frame ? (frameError ? (zh ? '画面暂不可用' : 'Preview unavailable') : (zh ? '正在获取画面…' : 'Getting preview…'))
        : snapshot ? (age !== null && age > 4 ? (zh ? '画面更新较慢' : 'Preview delayed') : (zh ? '定时更新画面' : 'Snapshot preview'))
          : connected ? (zh ? '已连接' : 'Connected') : (zh ? '正在连接…' : 'Connecting…');
  const helper = ended ? (zh ? '在聊天中让 Agent 重新打开手机，即可继续使用。' : 'Ask the Agent in chat to reopen the phone to continue.')
    : state.report.stopReason === 'text_input_required' ? (human ? (zh ? '请使用手机自带键盘输入，完成后交还 Agent。' : 'Type with the phone keyboard, then hand back to the Agent.') : (zh ? '请接管并使用手机自带键盘输入，完成后交还 Agent。' : 'Take over, type with the phone keyboard, then hand back to the Agent.'))
      : state.report.stopReason === 'text_input_unconfirmed' ? (human ? (zh ? '请检查输入框，避免重复输入；确认后交还 Agent。' : 'Inspect the field to avoid duplicate text, then hand back to the Agent.') : (zh ? '请先接管检查输入框，避免重复输入；确认后交还 Agent。' : 'Take over and inspect the field before retrying to avoid duplicate text. Then hand back to the Agent.'))
    : video.status === 'blocked' ? (zh ? '当前页面不在授权范围内，请先返回授权应用。' : 'This page is outside the allowed apps. Return to an authorized app first.')
      : working || busy === 'takeover' || busy === 'handback' ? (zh ? '控制权交接完成后，即可继续操作。' : 'Controls become available once the handoff completes.')
      : human ? (snapshot ? (zh ? '当前画面定时更新，拖动可能稍有延迟。' : 'Snapshot preview; dragging may be delayed.') : (zh ? '可以点击、滑动和输入文字，Agent 已暂停。' : 'Click, swipe or type. The Agent is paused.'))
        : otherHuman ? (zh ? '此窗口仅查看，操作由另一窗口控制。' : 'View only here. Another window controls the phone.')
          : !controlMode ? (zh ? '当前会话仅查看，可在聊天中请求操作手机。' : 'This session is view only. Ask in chat to control the phone.')
            : paused ? (zh ? '接管后，可以直接点击、滑动和输入文字。' : 'Take over to click, swipe and type on the phone.')
              : (zh ? '随时接管，Agent 会先暂停操作。' : 'Take over at any time. The Agent will pause first.');
  const dimensions = frame ?? video.geometry;
  const ratio = dimensions ? dimensions.width / dimensions.height : 9 / 20;
  const primaryLabel = ended ? (zh ? '会话已结束' : 'Session ended')
    : busy === 'takeover' ? (zh ? '正在接管…' : 'Taking control…')
      : busy === 'handback' ? (zh ? '正在交还…' : 'Returning control…')
        : human ? (zh ? '交还 Agent' : 'Hand back to Agent') : (zh ? '接管手机' : 'Take over phone');
  return <section className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-surface-base" aria-label={zh ? '手机实时画面' : 'Live phone'}>
    <header className="flex shrink-0 items-center gap-2 border-b border-edge px-4 py-2.5">
      {human || paused ? <Hand className="size-4 shrink-0 text-accent" aria-hidden /> : <Bot className="size-4 shrink-0 text-accent" aria-hidden />}
      <div className="min-w-0 flex-1" role="status" aria-live="polite">
        <p className="truncate text-sm font-medium text-fg">{title}</p>
        <p className="mt-0.5 flex items-center gap-1.5 text-xs text-fg-muted"><span aria-hidden className={cn('size-1.5 shrink-0 rounded-full', connected ? 'bg-success' : 'bg-fg-muted')} />{connectionLabel}</p>
      </div>
      <BetaBadge />
      <DropdownMenu.Root modal={false}>
        <DropdownMenu.Trigger asChild><Button variant="ghost" className="size-9 shrink-0 rounded-lg p-0" aria-label={zh ? '更多手机操作' : 'More phone actions'}><MoreHorizontal className="size-4" aria-hidden /></Button></DropdownMenu.Trigger>
        <DropdownMenu.Portal><DropdownMenu.Content align="end" sideOffset={6} className="z-[150] min-w-40 rounded-xl border border-edge bg-surface-overlay p-1 shadow-popover">
          <DropdownMenu.Item className="flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-sm text-fg outline-none focus:bg-surface-hover" onSelect={() => { setShowDetails(true); requestAnimationFrame(() => detailsTrigger.current?.focus()); }}><Info className="size-4" aria-hidden />{zh ? '连接详情' : 'Connection details'}</DropdownMenu.Item>
          <DropdownMenu.Item disabled={Boolean(busy) || working || ended} className="flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-sm text-danger outline-none focus:bg-surface-hover data-[disabled]:pointer-events-none data-[disabled]:opacity-50" onSelect={() => void command('cancel')}><Square className="size-4" aria-hidden />{zh ? '结束会话' : 'End session'}</DropdownMenu.Item>
        </DropdownMenu.Content></DropdownMenu.Portal>
      </DropdownMenu.Root>
    </header>
    <div className="phone-live-stage relative flex min-h-0 flex-1 items-center justify-center bg-surface-inset p-4">
      <div className={cn('phone-device-shell relative shrink-0 rounded-[28px] border border-phone-rim bg-phone-shell shadow-phone-device', human && 'ring-2 ring-accent/60 ring-offset-2 ring-offset-surface-inset')} style={{ '--phone-screen-ratio': ratio } as CSSProperties} data-phone-device-shell>
        <span className="pointer-events-none absolute left-1/2 top-1.5 h-[3px] w-8 -translate-x-1/2 rounded-full bg-phone-rim" aria-hidden />
        <span className="pointer-events-none absolute -right-[3px] top-20 h-9 w-0.5 rounded-r bg-phone-rim" aria-hidden />
        <div className="phone-device-screen relative w-full overflow-hidden rounded-[18px] bg-surface-base">
          <canvas ref={canvas} aria-label={zh ? '手机视频画面' : 'Phone video screen'}
            data-phone-video-status={video.status} data-phone-video-error={video.error} data-phone-video-frames={video.frames} data-phone-video-fps={video.fps.toFixed(1)} data-phone-input-ack-ms={video.ackMs?.toFixed(1)}
            className={cn('absolute inset-0 h-full w-full select-none object-contain', videoPlaying ? '' : 'hidden', human ? 'touch-none cursor-crosshair' : 'cursor-default')}
            onPointerDown={event => {
              if (!human || busy || working || !videoPlaying || !video.geometry || event.button !== 0) return;
              const p = phonePoint(event.currentTarget.getBoundingClientRect(), video.geometry.width, video.geometry.height, event.clientX, event.clientY);
              if (!p) return; event.currentTarget.setPointerCapture(event.pointerId); video.pointer('down', p);
            }}
            onPointerMove={event => {
              if (!human || busy || working || !video.geometry || !event.currentTarget.hasPointerCapture(event.pointerId)) return;
              const p = phonePoint(event.currentTarget.getBoundingClientRect(), video.geometry.width, video.geometry.height, event.clientX, event.clientY);
              if (p) video.pointer('move', p);
            }}
            onPointerUp={event => {
              if (!video.geometry || !event.currentTarget.hasPointerCapture(event.pointerId)) return;
              const p = phonePoint(event.currentTarget.getBoundingClientRect(), video.geometry.width, video.geometry.height, event.clientX, event.clientY);
              if (p) video.pointer('up', p); else video.cancel(); event.currentTarget.releasePointerCapture(event.pointerId);
            }} onPointerCancel={video.cancel} onLostPointerCapture={video.cancel} />
          {!snapshot && !videoPlaying && !ended ? <div className="absolute inset-0 flex items-center justify-center">{video.status === 'blocked' ? <div className="px-4 text-center"><p role="alert" className="text-sm text-fg-muted">{zh ? '当前页面不在授权应用范围内。' : 'This page is outside the authorized applications.'}</p>{human ? state.allowedApps?.map(app => <Button className="mt-3" key={app} onClick={() => void command('recover', { type: 'launch', package: app })}>{zh ? '返回授权应用' : 'Return to allowed app'}</Button>) : null}</div> : <Skeleton className="h-full w-full rounded-none" />}</div> : null}
          {frame ? <img src={frame.url} alt={zh ? '手机当前屏幕' : 'Current phone screen'} width={frame.width} height={frame.height} draggable={false}
            className={cn('absolute inset-0 h-full w-full select-none object-contain', human ? 'touch-none cursor-crosshair' : 'cursor-default')}
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
            }} /> : ended ? <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-5 text-center text-sm text-fg-muted"><Smartphone className="size-8" strokeWidth={1.25} aria-hidden /><p>{zh ? '会话已结束' : 'Session ended'}</p></div>
              : snapshot && frameError ? <div className="absolute inset-0 flex flex-col items-center justify-center overflow-y-auto px-4 text-center"><p role="alert" className="text-sm text-fg-muted">{zh ? '暂时无法显示手机画面，请检查连接或授权应用。' : 'Phone preview unavailable. Check the connection or allowed app.'}</p>{human ? <div className="mt-3 flex flex-wrap justify-center gap-2">{state.allowedApps?.map(app => <Button key={app} disabled={Boolean(busy)} onClick={() => void command('recover', { type: 'launch', package: app })}>{state.allowedApps?.length === 1 ? (zh ? '返回授权应用' : 'Return to allowed app') : `${zh ? '打开' : 'Open'} ${app}`}</Button>)}</div> : null}</div> : snapshot ? <Skeleton className="h-full w-full rounded-none" /> : null}
        </div>
      </div>
    </div>
    <footer className="shrink-0 border-t border-edge bg-surface-base">
      <div className="mx-auto w-full max-w-xl px-4 pb-3 pt-2.5">
        <p className="mb-2 text-center text-xs leading-relaxed text-fg-muted">{helper}</p>
        {error ? <p role="alert" className="mb-2 text-xs text-danger">{zh ? '操作未完成，请重试。详细原因可在连接详情中查看。' : 'Action failed. Try again or check connection details.'}</p> : null}
        {!ended ? <div className="flex flex-wrap gap-2">
          {controlMode ? <Button variant={human ? 'primary' : 'ghost'} className={cn('min-h-11 min-w-0 flex-1 rounded-lg', !human && 'border border-accent/20 bg-accent-soft text-accent-fg hover:border-accent/40 hover:bg-accent-soft hover:text-accent-fg dark:border-accent/30 dark:hover:bg-accent/30')} disabled={disabled} onClick={() => void command(human ? 'handback' : 'takeover')}>
            {busy || working ? <Loader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden /> : human ? <Play className="size-4" aria-hidden /> : <Hand className="size-4" aria-hidden />}{primaryLabel}
          </Button> : null}
          {!otherHuman && controlMode ? <Button variant="ghost" className="min-h-11 rounded-lg" disabled={disabled} onClick={() => void command(human ? 'release' : paused ? 'handback' : 'pause')}>
            {!human && !paused ? <Pause className="size-4" aria-hidden /> : null}{human ? (zh ? '仅查看' : 'View only') : paused ? (zh ? '让 Agent 继续' : 'Let Agent continue') : (zh ? '暂停任务' : 'Pause task')}
          </Button> : null}
        </div> : null}
        {human ? <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <Button variant="ghost" className="size-9 rounded-lg p-0" aria-label={zh ? '手机返回' : 'Phone back'} disabled={Boolean(busy) || working || (!frame && !videoPlaying)} onClick={() => void command('input', { type: 'back' }, frame?.seq)}><ArrowLeft className="size-4" aria-hidden /></Button>
          <Button variant="ghost" className="size-9 rounded-lg p-0" aria-label={zh ? '手机输入' : 'Phone keyboard'} aria-expanded={showText} disabled={state.textInput === 'manual' || Boolean(busy) || working || (!frame && !videoPlaying)} onClick={() => setShowText(value => !value)}><Keyboard className="size-4" aria-hidden /></Button>
          <span className="text-xs text-fg-muted">{state.textInput === 'manual' ? (zh ? '请使用手机自带键盘输入' : 'Use the phone keyboard to type') : (zh ? '仅查看会保持任务暂停' : 'View only keeps the task paused')}</span>
        </div> : null}
        {human && showText ? <form className="mt-2 flex gap-2" onSubmit={event => { event.preventDefault(); void sendText(); }}>
          <input aria-label={zh ? '发送到手机的文本' : 'Text to send to phone'} placeholder={zh ? '输入非密码文本…' : 'Type non-password text…'} autoComplete="off" value={text} disabled={Boolean(busy) || working || (!frame && !videoPlaying)} onChange={event => setText(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && event.nativeEvent.isComposing) event.preventDefault(); }} className="min-h-11 min-w-0 flex-1 rounded-lg border border-edge bg-surface-panel px-3 text-sm focus-visible:outline-2 focus-visible:outline-accent" />
          <Button type="submit" className="rounded-lg" disabled={Boolean(busy) || working || !text || (!frame && !videoPlaying)}>{zh ? '输入' : 'Type'}</Button>
        </form> : null}
      </div>
      <div className="border-t border-edge">
        <button ref={detailsTrigger} type="button" aria-expanded={showDetails} aria-controls={`phone-details-${state.report.sessionId}`} onClick={() => setShowDetails(value => !value)} className="flex min-h-9 w-full items-center gap-1.5 px-4 py-2 text-left text-xs text-fg-muted hover:text-fg focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent"><ChevronDown className={cn('size-3.5 transition-transform motion-reduce:transition-none', showDetails && 'rotate-180')} aria-hidden />{zh ? '连接详情' : 'Connection details'}</button>
        <div id={`phone-details-${state.report.sessionId}`} hidden={!showDetails} className="max-h-[min(30vh,12rem)] overflow-y-auto overscroll-contain px-4 pb-3 text-xs text-fg-muted">
          <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1.5 break-words">
            <dt>{zh ? '手机' : 'Phone'}</dt><dd>{state.report.deviceName}</dd>
            <dt>Agent</dt><dd>{state.report.agentId}</dd>
            <dt>{zh ? '手机模型' : 'Phone model'}</dt><dd>{state.report.modelRef}</dd>
            <dt>{zh ? '画面' : 'Preview'}</dt><dd>{ended ? (zh ? '已停止' : 'Stopped') : videoPlaying ? (zh ? '实时视频' : 'Live video') : snapshot ? (zh ? '定时截图' : 'Snapshots') : connectionLabel}</dd>
            {videoPlaying ? <><dt>{zh ? '帧率' : 'Frame rate'}</dt><dd>{video.fps.toFixed(0)} FPS{video.fps < 1 ? (zh ? ' · 静止画面时可能不产生新帧' : ' · Static screens may not produce new frames') : ''}</dd></> : null}
            {video.ackMs !== undefined ? <><dt>{zh ? '输入应答' : 'Input ACK'}</dt><dd>{video.ackMs.toFixed(0)} ms</dd></> : null}
            {snapshot && age !== null ? <><dt>{zh ? '画面时间' : 'Frame age'}</dt><dd>{age.toFixed(1)} s</dd></> : null}
            <dt>{zh ? '操作次数' : 'Actions'}</dt><dd>{state.report.actions}</dd>
          </dl>
          {snapshot && video.error && !ended ? <div className="mt-3 flex items-center gap-2"><span>{zh ? '实时视频不可用，正在使用定时截图。' : 'Video unavailable. Using snapshots.'}</span><Button variant="ghost" className="shrink-0 px-2 py-1 text-xs text-accent" onClick={video.retry}><RefreshCw className="size-3" aria-hidden />{zh ? '重试视频' : 'Retry video'}</Button></div> : null}
          {error || frameError || video.error || state.report.message ? <p className="mt-2 whitespace-pre-wrap break-words">{[error, frameError, video.error, state.report.message].filter(Boolean).join(' · ')}</p> : null}
          {ended ? <p className="mt-2 flex items-center gap-1"><CircleCheck className="size-3.5" aria-hidden />{zh ? '画面采集与手机控制已结束' : 'Screen capture and control have ended'}</p> : null}
        </div>
      </div>
    </footer>
  </section>;
}
