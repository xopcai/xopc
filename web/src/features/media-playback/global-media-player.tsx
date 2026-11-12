import { GripVertical, LoaderCircle, Music2, Pause, Play, RotateCcw, Video, X } from 'lucide-react';
import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { createPortal } from 'react-dom';

import { Button } from '@/components/ui/button';
import { useComposerSafeFloatingLayout } from '@/features/chat/composer/use-composer-safe-floating-layout';
import { useLocaleStore } from '@/stores/locale-store';

import { closeGeneratedMedia, setFloatingVideoHost, useGeneratedMediaStore } from './generated-media';
import { interruptPlayback, observeNativePlayback } from './playback-coordinator';
import { formatPlaybackTime, useGeneratedMediaControls } from './use-generated-media';

type Point = { x: number; y: number };

export function GlobalMediaPlayer() {
  const zh = useLocaleStore(state => state.language) === 'zh';
  const active = useGeneratedMediaStore(state => state.active);
  const floating = active && !active.inline ? active.entry : null;
  const audio = floating?.source.kind === 'audio' ? floating.element : null;
  const { playing, starting, failed, duration, position, toggle, seek } = useGeneratedMediaControls(audio);
  const [point, setPoint] = useState<Point | null>(null);
  const windowRef = useRef<HTMLElement>(null);
  const layout = useComposerSafeFloatingLayout(windowRef, Boolean(floating), point, '[data-recording-window]');
  const drag = useRef<{ id: number; pointer: Point; origin: Point; moved: boolean } | null>(null);
  const suppressClick = useRef(false);

  useEffect(() => {
    const stopObserving = observeNativePlayback();
    return () => {
      stopObserving();
      closeGeneratedMedia();
      interruptPlayback();
    };
  }, []);

  function endDrag(event: PointerEvent<HTMLButtonElement>) {
    if (drag.current?.id !== event.pointerId) return;
    suppressClick.current = drag.current.moved;
    drag.current = null;
  }

  if (!floating) return null;
  const isVideo = floating.source.kind === 'video';
  const Icon = isVideo ? Video : Music2;
  const PlayIcon = failed ? RotateCcw : starting ? LoaderCircle : playing ? Pause : Play;
  const playLabel = failed ? (zh ? '重试播放' : 'Retry playback') : playing || starting ? (zh ? '暂停' : 'Pause') : (zh ? '播放' : 'Play');
  const moveLabel = zh ? '移动播放器' : 'Move player';
  const progress = Math.min(position, duration);

  return createPortal(<aside ref={windowRef} aria-label={zh ? '媒体浮窗' : 'Floating media player'}
    className="fixed z-[65] flex w-80 flex-col overflow-hidden rounded-xl border border-edge bg-surface-overlay text-fg shadow-elevated [-webkit-app-region:no-drag]"
    style={layout.style}>
    <header className="flex min-w-0 shrink-0 items-center gap-1 p-1.5">
      <Button variant="ghost" className="size-10 shrink-0 touch-none cursor-grab rounded-lg p-0 select-none active:cursor-grabbing"
        aria-label={moveLabel} title={zh ? '拖动或用方向键移动，点击回到默认位置' : 'Drag or use arrow keys. Click to reset position.'}
        onPointerDown={event => {
          if (event.button !== 0 || !event.isPrimary) return;
          const bounds = windowRef.current?.getBoundingClientRect();
          if (!bounds) return;
          event.preventDefault();
          event.currentTarget.focus({ preventScroll: true });
          suppressClick.current = false;
          drag.current = { id: event.pointerId, pointer: { x: event.clientX, y: event.clientY }, origin: { x: bounds.left, y: bounds.top }, moved: false };
          event.currentTarget.setPointerCapture?.(event.pointerId);
        }}
        onDragStart={event => event.preventDefault()}
        onPointerMove={event => {
          const gesture = drag.current;
          if (!gesture || gesture.id !== event.pointerId) return;
          const x = event.clientX - gesture.pointer.x;
          const y = event.clientY - gesture.pointer.y;
          if (!gesture.moved && Math.hypot(x, y) < 4) return;
          gesture.moved = true;
          setPoint(layout.clamp({ x: gesture.origin.x + x, y: gesture.origin.y + y }));
        }}
        onPointerUp={endDrag} onPointerCancel={endDrag} onLostPointerCapture={endDrag}
        onClick={event => { if (!suppressClick.current || !event.detail) setPoint(null); suppressClick.current = false; }}
        onKeyDown={event => {
          const step = event.shiftKey ? 48 : 16;
          const directions: Record<string, Point> = { ArrowLeft: { x: -step, y: 0 }, ArrowRight: { x: step, y: 0 },
            ArrowUp: { x: 0, y: -step }, ArrowDown: { x: 0, y: step } };
          const delta = directions[event.key];
          const bounds = windowRef.current?.getBoundingClientRect();
          if (delta && bounds) {
            event.preventDefault();
            setPoint(layout.clamp({ x: bounds.left + delta.x, y: bounds.top + delta.y }));
          }
        }}><GripVertical size={16} aria-hidden /></Button>
      <Icon size={15} className="shrink-0 text-fg-muted" aria-hidden />
      <span className="min-w-0 flex-1 truncate text-sm font-medium" title={floating.source.title}>{floating.source.title}</span>
      {!isVideo && <Button variant="ghost" className="size-10 shrink-0 rounded-lg p-0" aria-label={playLabel} onClick={toggle}>
        <PlayIcon size={17} aria-hidden className={starting ? 'motion-safe:animate-spin' : undefined} />
      </Button>}
      <Button variant="ghost" className="size-10 shrink-0 rounded-lg p-0" onClick={closeGeneratedMedia}
        aria-label={zh ? '关闭播放器' : 'Close player'}><X size={17} aria-hidden /></Button>
    </header>
    {isVideo ? <div ref={setFloatingVideoHost} className="min-h-0 overflow-y-auto px-2 pb-2 [&>video]:block [&>video]:max-h-[min(11rem,38dvh)]" />
      : <div className="flex min-h-0 items-center gap-2 overflow-hidden px-3 pb-1 text-xs tabular-nums text-fg-muted">
        <span aria-hidden>{formatPlaybackTime(progress)}</span>
        <input type="range" aria-label={zh ? '播放进度' : 'Playback position'} min={0} max={duration || 1} step={0.1} value={progress}
          disabled={!duration || failed} onChange={event => seek(event.currentTarget.valueAsNumber)}
          className="h-7 min-w-0 flex-1 cursor-pointer accent-accent focus-visible:outline-2 focus-visible:outline-accent" />
        <span aria-hidden>{duration ? formatPlaybackTime(duration) : '—'}</span>
      </div>}
  </aside>, document.body);
}
