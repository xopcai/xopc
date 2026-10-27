import * as Dialog from '@radix-ui/react-dialog';
import { ArrowLeft, CircleCheck, Hand, Info, Keyboard, Loader2, MoreHorizontal, Play, RefreshCw, Settings2, Smartphone, Square, X } from 'lucide-react';
import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import { Select, SelectOption } from '@/components/ui/popover-select';
import { Skeleton } from '@/components/ui/skeleton';
import { useLocaleStore } from '@/stores/locale-store';
import { cn } from '@/lib/cn';
import { setPhoneExecutionMode, controlPhone, phoneEnded, phoneErrorMessage, phoneFrame, phonePoint, type PhoneAction, type PhoneLiveState } from './phone-live-api';
import { usePhoneVideo } from './use-phone-video';
import { PhoneLocationShare } from './phone-location-share';

import './phone-live-panel.css';

type Frame = { url: string; seq: number; capturedAt: number; width: number; height: number };
export function PhoneLivePanel({ conversationId, state, onChange, readOnly = false, active = true, sourceAction, headerActions, connectionActions, connectionNotice, onControlsClose, onHeaderPointerDown, onHeaderKeyDown }: {
  conversationId: string; state: PhoneLiveState; onChange: (state?: PhoneLiveState) => void; readOnly?: boolean; active?: boolean; sourceAction?: ReactNode;
  headerActions?: ReactNode; connectionActions?: ReactNode; connectionNotice?: ReactNode; onControlsClose?: () => void;
  onHeaderPointerDown?: (event: PointerEvent<HTMLElement>) => void;
  onHeaderKeyDown?: (event: KeyboardEvent<HTMLElement>) => void;
}) {
  const zh = useLocaleStore(s => s.language) === 'zh';
  const [frame, setFrame] = useState<Frame>();
  const [error, setError] = useState(''); const [frameError, setFrameError] = useState('');
  const [busy, setBusy] = useState(''); const [text, setText] = useState(''); const [now, setNow] = useState(Date.now());
  const [showText, setShowText] = useState(false);
  const [showControls, setShowControls] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [confirmMode, setConfirmMode] = useState(false);
  const [confirmStop, setConfirmStop] = useState(false);
  const refreshFrame = useRef<(() => void) | undefined>(undefined);
  const [visible, setVisible] = useState(document.visibilityState === 'visible');
  const latest = useRef(state); latest.current = state;
  const changeRef = useRef(onChange); changeRef.current = onChange;
  const busyRef = useRef(false); const urlRef = useRef('');
  const gesture = useRef<{ point: number[]; at: number; seq: number } | null>(null);
  const ended = phoneEnded(state.report.status);
  const working = state.report.handoff !== undefined && state.report.handoff !== 'idle';
  const interactive = active && visible;
  const lifecycle = useRef(0);
  const activeRef = useRef(interactive); activeRef.current = interactive;
  const human = !readOnly && state.ownControl && state.report.controlOwner === 'human';
  const canvas = useRef<HTMLCanvasElement>(null);
  const video = usePhoneVideo(conversationId, state.report.sessionId, !ended && !state.report.reconnectRequired && interactive, canvas, state.report.controlEpoch, human);
  const floating = Boolean(onHeaderPointerDown);
  useEffect(() => { video.cancel(); gesture.current = null; }, [floating, video.cancel]);
  useEffect(() => { if (!interactive) { lifecycle.current++; video.cancel(); gesture.current = null; setShowText(false); setText(''); } }, [interactive, video.cancel]);
  const videoPlaying = video.status === 'playing';
  const snapshot = video.status === 'fallback';
  const inspection = ['paused', 'needs_user', 'failed', 'outcome_unknown'].includes(state.report.status);
  const idle = state.report.controlOwner === 'none' && !inspection;
  const paused = state.report.controlOwner === 'none' || inspection;
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    activeRef.current = active && document.visibilityState === 'visible';
    const release = () => {
      activeRef.current = false; lifecycle.current++;
      const current = latest.current;
      if (!readOnly && current.ownControl && !phoneEnded(current.report.status)) void controlPhone(conversationId, current, 'release', {}, true).catch(() => {});
    };
    const visibility = () => { setVisible(document.visibilityState === 'visible'); };
    window.addEventListener('pagehide', release); document.addEventListener('visibilitychange', visibility);
    return () => { release(); window.removeEventListener('pagehide', release); document.removeEventListener('visibilitychange', visibility); };
  }, [conversationId, readOnly]);
  useEffect(() => {
    if (!interactive && !readOnly && latest.current.ownControl && !phoneEnded(latest.current.report.status)) {
      void controlPhone(conversationId, latest.current, 'release', {}, true).then(value => changeRef.current(value)).catch(() => changeRef.current());
    }
  }, [interactive, conversationId, readOnly]);
  useEffect(() => {
    if (!human || ended || !interactive) return;
    const heartbeat = setInterval(() => { void controlPhone(conversationId, latest.current, 'heartbeat').catch(() => changeRef.current()); }, 5000);
    return () => clearInterval(heartbeat);
  }, [conversationId, human, ended, interactive]);
  useEffect(() => {
    if (ended || state.report.reconnectRequired || !interactive || !snapshot) { setFrame(undefined); if (urlRef.current) URL.revokeObjectURL(urlRef.current); urlRef.current = ''; return; }
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
  }, [conversationId, state.report.sessionId, state.report.reconnectRequired, ended, interactive, zh, snapshot]);
  async function command(op: string, action?: PhoneAction, frameSeq?: number) {
    if (readOnly || !activeRef.current) return false;
    if (busyRef.current) return;
    const generation = lifecycle.current;
    video.cancel(); gesture.current = null; busyRef.current = true; setBusy(op); setError('');
    if (['takeover', 'handback', 'release', 'pause', 'cancel'].includes(op)) { setShowText(false); setText(''); }
    try {
      const next = await controlPhone(conversationId, latest.current, op, { action, frameSeq, ...(videoPlaying && video.geometry ? { geometry: video.geometry.version } : {}) });
      if ((!activeRef.current || generation !== lifecycle.current) && next.ownControl) {
        onChange(await controlPhone(conversationId, next, 'release'));
      } else onChange(next);
      return true;
    }
    catch (failure) { setError(phoneErrorMessage(failure, zh)); onChange(); return false; }
    finally { busyRef.current = false; setBusy(''); refreshFrame.current?.(); }
  }
  async function changeMode(mode: 'collaborative' | 'direct', applyCurrent = false) {
    if (readOnly || busyRef.current) return;
    busyRef.current = true; setBusy('execution-mode'); setError('');
    try { onChange(await setPhoneExecutionMode(conversationId, latest.current, mode, applyCurrent)); setConfirmMode(false); }
    catch (failure) { setError(phoneErrorMessage(failure, zh)); onChange(); }
    finally { busyRef.current = false; setBusy(''); }
  }
  async function sendText() {
    if (showControls || !text || (!frame && !videoPlaying)) return;
    const sent = text;
    if (await command('input', { type: 'typeText', text: sent }, frame?.seq)) setText(current => current === sent ? '' : current);
  }
  function point(event: PointerEvent<HTMLImageElement>) {
    return frame ? phonePoint(event.currentTarget.getBoundingClientRect(), frame.width, frame.height, event.clientX, event.clientY) : null;
  }
  const age = frame ? Math.max(0, (now - frame.capturedAt) / 1000) : null;
  const otherHuman = state.report.controlOwner === 'human' && !human;
  const controlMode = !readOnly && state.report.mode === 'control';
  const disabled = Boolean(busy) || working || ended || otherHuman || showControls;
  const pendingTask = state.report.hasPendingTask ?? Boolean(state.report.task || state.report.assistanceId);
  const title = ended ? (zh ? '连接已结束' : 'Connection ended')
    : busy === 'takeover' || state.report.handoff === 'acquiring' ? (zh ? '正在接管…' : 'Taking control…')
      : busy === 'handback' || state.report.handoff === 'returning' ? (zh ? '正在检查手机…' : 'Checking phone…')
        : human ? (pendingTask ? (zh ? '你正在操作 · AI 已暂停' : 'You control the phone · AI paused') : (zh ? '你正在操作' : 'You control the phone'))
          : otherHuman ? (zh ? '另一设备正在操作' : 'Another device is operating')
            : state.report.status === 'needs_user' ? (zh ? '等待你处理' : 'Your help is needed')
              : inspection ? (zh ? '任务已暂停' : 'Task paused')
                : state.report.controlOwner === 'agent' ? (zh ? 'AI 操作中' : 'AI is operating')
                  : (zh ? '已连接' : 'Connected');
  const connected = !ended && (videoPlaying || Boolean(frame));
  const connectionLabel = state.report.reconnectRequired ? (zh ? '进度已保留 · 等待重连' : 'Progress saved · Reconnect to continue')
    : video.status === 'blocked' ? (zh ? '画面受限' : 'Preview restricted')
      : snapshot ? (age !== null && age > 4 ? (zh ? '画面更新较慢' : 'Preview delayed') : (zh ? '截图模式' : 'Snapshot mode'))
        : connected ? '' : (zh ? '正在连接画面…' : 'Connecting preview…');
  const continuePaused = !human && paused && state.report.status !== 'needs_user' && pendingTask && !state.report.assistanceId;
  const primaryOp = human ? pendingTask ? 'handback' : 'release' : continuePaused ? 'handback' : 'takeover';
  const dimensions = frame ?? video.geometry;
  const ratio = dimensions ? dimensions.width / dimensions.height : 9 / 20;
  const primaryLabel = busy === 'takeover' ? (zh ? '正在接管…' : 'Taking control…')
    : busy === 'handback' ? (zh ? '正在检查手机…' : 'Checking phone…')
      : human ? (pendingTask ? (zh ? '完成，继续任务' : 'Done, continue task') : (zh ? '结束手动操作' : 'End manual control'))
        : continuePaused ? (zh ? '继续任务' : 'Continue task')
          : idle && !pendingTask ? (zh ? '手动操作' : 'Control phone') : (zh ? '接管手机' : 'Take over phone');
  const previewProblem = video.status === 'blocked' || snapshot && (Boolean(frameError) || !frame || (age ?? 0) > 4);
  const showFooter = controlMode && !ended || Boolean(error) || Boolean(sourceAction);
  function changeControls(open: boolean) {
    if (open) { video.cancel(); gesture.current = null; }
    else { setConfirmMode(false); setConfirmStop(false); setShowSettings(false); setShowDetails(false); onControlsClose?.(); }
    setShowControls(open);
  }
  return <Dialog.Root modal={false} open={showControls} onOpenChange={changeControls}><section style={{ '--phone-screen-ratio': ratio } as CSSProperties} className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-surface-panel" aria-label={zh ? '手机实时画面' : 'Live phone'}>
    <header className={cn('flex shrink-0 items-center gap-1 bg-surface-panel px-5 py-4', onHeaderPointerDown && 'cursor-grab touch-none select-none active:cursor-grabbing')}
      data-phone-drag-handle={onHeaderPointerDown ? '' : undefined} tabIndex={onHeaderPointerDown ? 0 : undefined}
      aria-label={onHeaderPointerDown ? (zh ? '拖动手机小窗，可使用方向键移动' : 'Drag phone window, or use arrow keys to move') : undefined}
      onPointerDown={onHeaderPointerDown} onKeyDown={onHeaderKeyDown}>
      <div className="min-w-0 flex-1" role="status" aria-live="polite">
        <h3 className="truncate text-[15px] font-semibold tracking-tight text-fg">{state.report.deviceName}</h3>
        <p className="mt-1 flex items-center gap-1.5 text-xs text-fg-muted"><span aria-hidden className={cn('size-1.5 shrink-0 rounded-full', connected && !previewProblem ? 'bg-success' : 'bg-fg-muted')} />{title}</p>
      </div>
      <Dialog.Trigger asChild><Button variant="ghost" className="size-8 shrink-0 rounded-full p-0 text-fg-muted" aria-label={zh ? '更多手机操作' : 'More phone actions'}><MoreHorizontal className="size-4" aria-hidden /></Button></Dialog.Trigger>
      {headerActions}
      {!readOnly && !ended && state.report.deviceId && <PhoneLocationShare key={`${state.report.deviceId}:${conversationId}`} phoneId={state.report.deviceId} conversationId={conversationId} />}
    </header>
    {(snapshot || !connected || previewProblem) && <div role="status" className="flex shrink-0 items-center justify-center gap-2 px-3 text-xs text-fg-muted"><span>{connectionLabel}</span>{snapshot && <Button variant="ghost" className="min-h-8 px-2 text-xs" onClick={video.retry}>{zh ? '重连画面' : 'Reconnect preview'}</Button>}</div>}
    <div className="phone-live-stage relative flex min-h-0 items-center justify-center bg-surface-panel p-3">
      <div className={cn('phone-device-shell relative shrink-0 border border-phone-rim/60 bg-phone-shell', human && 'outline outline-2 outline-accent/60 outline-offset-4')} style={{ '--phone-screen-ratio': ratio } as CSSProperties} data-phone-device-shell>
        <div className="phone-device-screen relative w-full overflow-hidden bg-surface-base">
          {state.report.reconnectRequired && <div role="status" className="absolute inset-0 z-10 flex items-center justify-center bg-surface-base px-4 text-center text-sm text-fg-muted">{zh ? '任务进度已保留。点击接管手机后重新连接，或完成实体手机操作后直接继续任务。' : 'Progress is saved. Take over to reconnect, or complete the action on the physical phone and continue.'}</div>}
          <canvas ref={canvas} aria-label={zh ? '手机视频画面' : 'Phone video screen'}
            data-phone-video-status={video.status} data-phone-video-error={video.error} data-phone-video-frames={video.frames} data-phone-video-fps={video.fps.toFixed(1)} data-phone-input-ack-ms={video.ackMs?.toFixed(1)}
            className={cn('absolute inset-0 h-full w-full select-none object-contain', videoPlaying ? '' : 'hidden', human ? 'touch-none cursor-crosshair' : 'cursor-default')}
            onPointerDown={event => {
              if (!interactive || showControls || !human || busy || working || !videoPlaying || !video.geometry || event.button !== 0) return;
              const p = phonePoint(event.currentTarget.getBoundingClientRect(), video.geometry.width, video.geometry.height, event.clientX, event.clientY);
              if (!p) return; event.currentTarget.setPointerCapture(event.pointerId); video.pointer('down', p);
            }}
            onPointerMove={event => {
              if (!interactive || showControls || !human || busy || working || !video.geometry || !event.currentTarget.hasPointerCapture(event.pointerId)) return;
              const p = phonePoint(event.currentTarget.getBoundingClientRect(), video.geometry.width, video.geometry.height, event.clientX, event.clientY);
              if (p) video.pointer('move', p);
            }}
            onPointerUp={event => {
              if (showControls || !video.geometry || !event.currentTarget.hasPointerCapture(event.pointerId)) return;
              const p = phonePoint(event.currentTarget.getBoundingClientRect(), video.geometry.width, video.geometry.height, event.clientX, event.clientY);
              if (p) video.pointer('up', p); else video.cancel(); event.currentTarget.releasePointerCapture(event.pointerId);
            }} onPointerCancel={video.cancel} onLostPointerCapture={video.cancel} />
          {!snapshot && !videoPlaying && !ended ? <div className="absolute inset-0 flex items-center justify-center">{video.status === 'blocked' ? <div className="px-4 text-center"><p role="alert" className="text-sm text-fg-muted">{zh ? '当前页面不在授权应用范围内。' : 'This page is outside the authorized applications.'}</p>{human ? state.allowedApps?.map(app => <Button className="mt-3" key={app} onClick={() => void command('recover', { type: 'launch', package: app })}>{zh ? '返回授权应用' : 'Return to allowed app'}</Button>) : null}</div> : <Skeleton className="h-full w-full rounded-none" />}</div> : null}
          {frame ? <img src={frame.url} alt={zh ? '手机当前屏幕' : 'Current phone screen'} width={frame.width} height={frame.height} draggable={false}
            className={cn('absolute inset-0 h-full w-full select-none object-contain', human ? 'touch-none cursor-crosshair' : 'cursor-default')}
            onPointerDown={event => {
              if (!interactive || showControls || !human || busy || working || !frame || (age ?? 99) > 5) return;
              const p = point(event); if (!p) return;
              gesture.current = { point: p, at: Date.now(), seq: frame.seq }; event.currentTarget.setPointerCapture(event.pointerId);
            }} onPointerCancel={() => { gesture.current = null; }}
            onPointerUp={event => {
              const start = gesture.current; gesture.current = null;
              if (showControls || !start || !human || busy) return;
              const end = point(event); if (!end) return;
              const duration = Date.now() - start.at;
              const distance = Math.hypot(end[0] - start.point[0], end[1] - start.point[1]);
              const action: PhoneAction = distance > 18 ? { type: 'swipe', start: start.point, end, durationMs: Math.min(1500, Math.max(200, duration)) }
                : duration > 600 ? { type: 'longPress', point: end, durationMs: Math.min(2000, duration) } : { type: 'tap', point: end };
              void command('input', action, start.seq);
            }} /> : ended ? <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-5 text-center text-sm text-fg-muted"><Smartphone className="size-8" strokeWidth={1.25} aria-hidden /><p>{zh ? '会话已结束' : 'Session ended'}</p></div>
              : snapshot && frameError ? <div className="absolute inset-0 flex flex-col items-center justify-center overflow-y-auto px-4 text-center"><p role="alert" className="text-sm text-fg-muted">{zh ? '暂时无法显示手机画面，请检查连接或授权应用。' : 'Phone preview unavailable. Check the connection or allowed app.'}</p>{human ? <div className="mt-3 flex flex-wrap justify-center gap-2">{state.allowedApps?.map(app => <Button key={app} disabled={Boolean(busy)} onClick={() => void command('recover', { type: 'launch', package: app })}>{state.allowedApps?.length === 1 ? (zh ? '返回授权应用' : 'Return to allowed app') : `${zh ? '打开' : 'Open'} ${app}`}</Button>)}</div> : null}</div> : snapshot ? <Skeleton className="h-full w-full rounded-none" /> : null}
          {showControls && <div className="absolute inset-0 z-20 bg-surface-base/30 backdrop-blur-sm" aria-hidden onPointerDown={event => { event.preventDefault(); event.stopPropagation(); changeControls(false); }} />}
          <Dialog.Content aria-describedby={undefined} onInteractOutside={event => event.preventDefault()} className="phone-control-shade absolute inset-x-0 top-0 z-30 flex max-h-full flex-col overflow-hidden rounded-b-[24px] border-b border-edge bg-surface-overlay text-fg shadow-popover">
            <div aria-hidden className="mx-auto mt-2 h-1 w-9 shrink-0 rounded-full bg-fg-muted/30" />
            <header className="flex shrink-0 items-center justify-between px-4 pb-3 pt-2">
              <Dialog.Title className="text-sm font-semibold">{zh ? '控制中心' : 'Control center'}</Dialog.Title>
              <Dialog.Close asChild><Button variant="ghost" className="size-8 rounded-full p-0" aria-label={zh ? '收起控制中心' : 'Close control center'}><X className="size-4" /></Button></Dialog.Close>
            </header>
            <div className="min-h-0 space-y-3 overflow-y-auto overscroll-contain px-3 pb-4">
              <div className="rounded-2xl bg-surface-panel/80 p-4"><p className="text-sm font-medium">{state.report.deviceName}</p><p className="mt-1 text-xs text-fg-muted">{title}</p></div>
              <div className="grid grid-cols-2 gap-2">
                {controlMode && human && <Button variant="secondary" disabled={Boolean(busy) || working} className="min-h-14 rounded-2xl text-xs" onClick={() => { changeControls(false); void command('release'); }}>{zh ? '结束控制，保持暂停' : 'Release, keep paused'}</Button>}
                {controlMode && !human && !otherHuman && !idle && !ended && <Button variant="secondary" disabled={Boolean(busy) || working} className="min-h-14 rounded-2xl text-xs" onClick={() => void command(paused ? 'handback' : 'pause')}>{paused ? (zh ? '继续任务' : 'Continue task') : (zh ? '暂停任务' : 'Pause task')}</Button>}
                {!readOnly && !ended && <Button variant="secondary" className="min-h-14 rounded-2xl text-xs" aria-expanded={showSettings} onClick={() => setShowSettings(value => !value)}><Settings2 className="size-4" />{zh ? '操作设置' : 'Control settings'}</Button>}
                <Button variant="secondary" className="min-h-14 rounded-2xl text-xs" aria-expanded={showDetails} onClick={() => setShowDetails(value => !value)}><Info className="size-4" />{zh ? '连接详情' : 'Connection details'}</Button>
                {connectionActions}
                {!readOnly && !idle && !ended && <Button variant="secondary" disabled={Boolean(busy) || working} className="min-h-14 rounded-2xl text-xs text-danger" onClick={() => setConfirmStop(true)}><Square className="size-4" />{zh ? '停止当前任务…' : 'Stop current task…'}</Button>}
              </div>
              {error && <p role="alert" className="px-1 text-xs text-danger">{error}</p>}
              {connectionNotice}
              {!readOnly && !ended && showSettings && <div className="space-y-3 rounded-2xl bg-surface-panel/80 p-4 text-xs text-fg-muted">
                <div className="flex items-center justify-between"><h4 className="text-sm font-medium text-fg">{zh ? '操作设置' : 'Control settings'}</h4><Button variant="ghost" className="size-7 rounded-full p-0" aria-label={zh ? '关闭操作设置' : 'Close control settings'} onClick={() => setShowSettings(false)}><X className="size-3.5" /></Button></div>
                <p>{zh ? '当前任务：' : 'Current task: '}{(state.report.executionMode ?? state.report.nextExecutionMode) === 'direct' ? (zh ? '直接执行' : 'Direct execution') : (zh ? '主 Agent 协作' : 'Main Agent collaboration')}</p>
                <label className="flex items-center gap-2"><span>{zh ? '下一任务' : 'Next task'}</span><Select aria-label={zh ? '下一任务执行方式' : 'Next task strategy'} value={state.report.nextExecutionMode ?? 'collaborative'} disabled={Boolean(busy) || working} onChange={event => void changeMode(event.target.value as 'collaborative' | 'direct')}>
                  <SelectOption value="collaborative">{zh ? '主 Agent 协作' : 'Main Agent collaboration'}</SelectOption>
                  <SelectOption value="direct">{zh ? '直接执行' : 'Direct execution'}</SelectOption>
                </Select></label>
                {state.report.task && state.report.executionMode !== state.report.nextExecutionMode && <Button variant="ghost" disabled={Boolean(busy) || working || human || otherHuman || state.report.status === 'outcome_unknown' || state.report.status === 'needs_user'} onClick={() => setConfirmMode(true)}>{zh ? '切换当前任务…' : 'Switch current task…'}</Button>}
                {confirmMode && <div role="alert" className="space-y-2"><p>{zh ? '将暂停当前任务，等待已派发操作结束并重新观察。切换后需检查并交还 Agent，已执行操作不会撤销，预算不会重置。' : 'Pause, wait for dispatched input and observe again. Inspect and hand back after switching. Delivered input and consumed budget are preserved.'}</p><Button disabled={Boolean(busy)} onClick={() => void changeMode(state.report.nextExecutionMode ?? 'collaborative', true)}>{zh ? '暂停并切换' : 'Pause and switch'}</Button><Button variant="ghost" onClick={() => setConfirmMode(false)}>{zh ? '取消' : 'Cancel'}</Button></div>}
              </div>}
              {confirmStop && <div role="alert" className="shrink-0 space-y-2 border-b border-edge p-4 text-sm"><p>{zh ? '确认停止来源聊天的当前手机任务？手机将保持连接，已执行的操作无法撤回。' : 'Stop the source chat’s phone task? The phone stays connected. Delivered input cannot be undone.'}</p><Button disabled={Boolean(busy)} onClick={() => { void command('cancel').then(ok => { if (ok) setConfirmStop(false); }); }}>{zh ? '确认停止' : 'Stop task'}</Button><Button variant="ghost" onClick={() => setConfirmStop(false)}>{zh ? '继续任务' : 'Keep task'}</Button></div>}
              {showDetails && <div className="rounded-2xl bg-surface-panel/80">
                <div className="flex items-center justify-between px-5 py-3"><h4  className="text-sm font-medium outline-none">{zh ? '连接详情' : 'Connection details'}</h4><Button variant="ghost" className="size-7 rounded-full p-0" aria-label={zh ? '关闭连接详情' : 'Close connection details'} onClick={() => setShowDetails(false)}><X className="size-3.5" /></Button></div>
                <div id={`phone-details-${state.report.sessionId}`} className="px-5 pb-4 text-xs text-fg-muted">
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
              </div>}
            </div>
          </Dialog.Content>
        </div>
      </div>
    </div>
    {showFooter && <footer className="shrink-0 bg-surface-panel">
      <div className="mx-auto w-full max-w-xl px-5 py-4">
        {error && !showControls ? <p role="alert" className="mb-2 text-xs text-danger">{error}</p> : null}
        {!ended ? <div className="flex flex-wrap justify-center gap-2">
          {controlMode ? <Button variant={human ? 'primary' : 'secondary'} className="min-h-10 min-w-36 rounded-full px-5" disabled={disabled} onClick={() => void command(primaryOp)}>
            {busy || working ? <Loader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden /> : human ? <Play className="size-4" aria-hidden /> : <Hand className="size-4" aria-hidden />}{primaryLabel}
          </Button> : null}
          {!human && !otherHuman && state.report.assistanceId && controlMode && <Button variant="ghost" disabled={disabled} onClick={() => void command('handback')}>{zh ? '我已处理，继续' : 'Already done, continue'}</Button>}
          {sourceAction}
        </div> : null}
        {human ? <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <Button variant="ghost" className="size-9 rounded-lg p-0" aria-label={zh ? '手机返回' : 'Phone back'} disabled={showControls || Boolean(busy) || working || (!frame && !videoPlaying)} onClick={() => void command('input', { type: 'back' }, frame?.seq)}><ArrowLeft className="size-4" aria-hidden /></Button>
          <Button variant="ghost" className="size-9 rounded-lg p-0" aria-label={zh ? '手机输入' : 'Phone keyboard'} aria-expanded={showText} disabled={showControls || state.textInput === 'manual' || Boolean(busy) || working || (!frame && !videoPlaying)} onClick={() => setShowText(value => !value)}><Keyboard className="size-4" aria-hidden /></Button>
          {state.textInput === 'manual' && <span className="text-xs text-fg-muted">{zh ? '请使用手机自带键盘输入' : 'Use the phone keyboard to type'}</span>}
        </div> : null}
        {human && <Dialog.Root open={showText} onOpenChange={setShowText}><Dialog.Portal><Dialog.Overlay className="xopc-dialog-overlay fixed inset-0 z-[90] bg-scrim" /><Dialog.Content aria-describedby={undefined} onOpenAutoFocus={event => event.preventDefault()} className="xopc-dialog-content fixed bottom-4 left-1/2 z-[91] flex h-[min(18rem,80dvh)] w-[min(28rem,calc(100vw-2rem))] -translate-x-1/2 flex-col overflow-hidden rounded-2xl border border-edge bg-surface-overlay p-5 shadow-popover">
          <div className="mb-4 flex shrink-0 items-center justify-between"><Dialog.Title>{zh ? '输入文字' : 'Type on phone'}</Dialog.Title><Dialog.Close asChild><Button variant="ghost" aria-label={zh ? '关闭文字输入' : 'Close text input'}><X className="size-4" /></Button></Dialog.Close></div>
          <form className="mt-2 flex gap-2" onSubmit={event => { event.preventDefault(); void sendText(); }}>
          <input aria-label={zh ? '发送到手机的文本' : 'Text to send to phone'} placeholder={zh ? '输入非密码文本…' : 'Type non-password text…'} autoComplete="off" value={text} disabled={showControls || Boolean(busy) || working || (!frame && !videoPlaying)} onChange={event => setText(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && event.nativeEvent.isComposing) event.preventDefault(); }} className="min-h-11 min-w-0 flex-1 rounded-lg border border-edge bg-surface-panel px-3 text-sm focus-visible:outline-2 focus-visible:outline-accent" />
          <Button type="submit" className="rounded-lg" disabled={showControls || Boolean(busy) || working || !text || (!frame && !videoPlaying)}>{zh ? '输入' : 'Type'}</Button>
          </form>
        </Dialog.Content></Dialog.Portal></Dialog.Root>}
      </div>
    </footer>}
  </section></Dialog.Root>;
}
