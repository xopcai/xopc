import { GripVertical, Loader2, Pause, Play, Volume2, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';

import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { cn } from '@/lib/cn';
import { useLocaleStore } from '@/stores/locale-store';

import {
  clampFloatingPlayerPosition,
  type FloatingPlayerPosition,
} from './floating-player-position';
import { useReadAloudStore } from './read-aloud-store';

type DragState = {
  pointerId: number;
  offsetX: number;
  offsetY: number;
  width: number;
  height: number;
};

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
}

export function GlobalReadAloudPlayer() {
  const language = useLocaleStore((state) => state.language);
  const state = useReadAloudStore();
  const zh = language === 'zh';
  const visible = state.source && state.status !== 'idle';
  const progress = state.duration > 0 ? Math.min(100, (state.currentTime / state.duration) * 100) : 0;
  const rates = [0.75, 1, 1.25, 1.5, 2];
  const nextRate = rates[(rates.indexOf(state.rate) + 1) % rates.length] ?? 1;
  const playerRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const [position, setPosition] = useState<FloatingPlayerPosition | null>(null);
  const [dragging, setDragging] = useState(false);

  const clampPosition = useCallback((next: FloatingPlayerPosition, width: number, height: number) => (
    clampFloatingPlayerPosition(
      next,
      { width, height },
      { width: window.innerWidth, height: window.innerHeight },
    )
  ), []);

  const handlePointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || !(event.target instanceof Element)) return;
    if (event.target.closest('button, a, input, select, textarea, [role="button"]')) return;
    const player = playerRef.current;
    if (!player) return;
    const rect = player.getBoundingClientRect();
    dragRef.current = {
      pointerId: event.pointerId,
      offsetX: event.clientX - rect.left,
      offsetY: event.clientY - rect.top,
      width: rect.width,
      height: rect.height,
    };
    setPosition(clampPosition({ x: rect.left, y: rect.top }, rect.width, rect.height));
    setDragging(true);
    player.setPointerCapture(event.pointerId);
    event.preventDefault();
  }, [clampPosition]);

  const handlePointerMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    setPosition(clampPosition(
      { x: event.clientX - drag.offsetX, y: event.clientY - drag.offsetY },
      drag.width,
      drag.height,
    ));
  }, [clampPosition]);

  const finishDrag = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    dragRef.current = null;
    setDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }, []);

  useEffect(() => {
    if (!visible) return;
    const keepInsideViewport = () => {
      const rect = playerRef.current?.getBoundingClientRect();
      if (!rect) return;
      setPosition((current) => current
        ? clampPosition(current, rect.width, rect.height)
        : current);
    };
    keepInsideViewport();
    window.addEventListener('resize', keepInsideViewport);
    return () => window.removeEventListener('resize', keepInsideViewport);
  }, [clampPosition, visible]);

  return (
    <>
      {visible ? (
        <div className="pointer-events-none fixed inset-0 z-50">
          <div
            ref={playerRef}
            className={cn(
              'pointer-events-auto isolate absolute flex w-[min(20rem,calc(100%-1.5rem))] touch-none items-center gap-2 rounded-xl border border-edge-strong bg-surface-panel px-2.5 py-2.5 shadow-popover',
              !position && 'bottom-3 left-1/2 -translate-x-1/2 sm:bottom-5',
              dragging ? 'cursor-grabbing select-none' : 'cursor-grab',
            )}
            style={position ? { left: position.x, top: position.y } : undefined}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={finishDrag}
            onPointerCancel={finishDrag}
          >
            <div
              className="flex shrink-0 items-center self-stretch text-fg-subtle"
              title={zh ? '拖动可移动播放器' : 'Drag to move the player'}
            >
              <GripVertical className="size-4" aria-hidden />
            </div>
            <button
              type="button"
              onClick={state.status === 'playing' ? state.pause : state.resume}
              disabled={state.status === 'preparing'}
              className="inline-flex size-9 shrink-0 items-center justify-center rounded-full bg-accent text-white transition-transform active:scale-95 disabled:opacity-70"
              aria-label={state.status === 'playing' ? (zh ? '暂停朗读' : 'Pause reading') : (zh ? '继续朗读' : 'Resume reading')}
            >
              {state.status === 'preparing' ? (
                <Loader2 className="size-4 animate-spin" aria-hidden />
              ) : state.status === 'playing' ? (
                <Pause className="size-4" aria-hidden />
              ) : (
                <Play className="ml-0.5 size-4" aria-hidden />
              )}
            </button>

            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <Volume2 className="size-3.5 shrink-0 text-accent" aria-hidden />
                <span className="truncate text-xs font-medium text-fg">{state.source?.title}</span>
                <span className="shrink-0 text-[10px] text-fg-subtle">
                  {state.currentChunkIndex + 1}/{state.chunkCount}
                </span>
              </div>
              <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-surface-active">
                <div
                  className={cn('h-full rounded-full bg-accent transition-[width] duration-200', state.status === 'preparing' && 'animate-pulse')}
                  style={{ width: `${progress}%` }}
                />
              </div>
              <div className="mt-1 flex items-center justify-between text-[10px] tabular-nums text-fg-subtle">
                <span>{state.error ?? `${formatTime(state.currentTime)} / ${state.duration ? formatTime(state.duration) : '—'}`}</span>
                <button
                  type="button"
                  onClick={() => state.setRate(nextRate)}
                  className="rounded px-1 py-0.5 text-fg-muted hover:bg-surface-hover hover:text-fg"
                  aria-label={zh ? '切换播放速度' : 'Change playback speed'}
                >
                  {state.rate}×
                </button>
              </div>
            </div>

            <button
              type="button"
              onClick={state.stop}
              className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg text-fg-muted hover:bg-surface-hover hover:text-fg"
              aria-label={zh ? '停止朗读' : 'Stop reading'}
            >
              <X className="size-4" aria-hidden />
            </button>
          </div>
        </div>
      ) : null}

      <ConfirmDialog
        open={state.consentRequired}
        title={zh ? '使用在线朗读' : 'Use online read aloud'}
        description={zh
          ? '朗读默认使用 Microsoft Edge 在线语音服务，待朗读文本会发送至 Microsoft 进行语音合成。'
          : 'Read aloud uses Microsoft Edge online speech by default. The text will be sent to Microsoft for speech synthesis.'}
        confirmLabel={zh ? '同意并朗读' : 'Agree and read'}
        cancelLabel={zh ? '取消' : 'Cancel'}
        onConfirm={state.acceptConsent}
        onCancel={state.declineConsent}
      />
    </>
  );
}
