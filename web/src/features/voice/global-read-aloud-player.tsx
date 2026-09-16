import { ChevronDown, Pause, Play, RotateCcw, X } from 'lucide-react';
import { useId, useState } from 'react';
import { createPortal } from 'react-dom';

import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { PopoverSelect } from '@/components/ui/popover-select';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/cn';
import { useLocaleStore } from '@/stores/locale-store';

import { useReadAloudDock } from './read-aloud-dock';
import { useReadAloudStore } from './read-aloud-store';

function formatTime(seconds: number): string {
  const value = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0;
  return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, '0')}`;
}

const controlClass = 'inline-flex size-11 shrink-0 items-center justify-center rounded-full text-fg hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent motion-safe:transition-colors';

export function GlobalReadAloudPlayer() {
  const zh = useLocaleStore((state) => state.language) === 'zh';
  const state = useReadAloudStore();
  const dock = useReadAloudDock();
  const [expanded, setExpanded] = useState(false);
  const detailsId = useId();
  const visible = state.source && state.status !== 'idle';
  const preparing = state.status === 'preparing';
  const playing = state.status === 'playing';
  const failed = state.status === 'error';
  const ended = state.status === 'ended';
  const status = preparing ? (zh ? '正在准备语音' : 'Preparing audio')
    : failed ? (zh ? '朗读失败，请重试' : 'Unable to play. Try again')
      : ended ? (zh ? '播放完毕' : 'Finished') : playing ? (zh ? '正在朗读' : 'Reading aloud') : (zh ? '已暂停' : 'Paused');
  const player = visible ? (
    <section aria-label={zh ? '语音播报' : 'Read aloud'} className={cn('shrink-0', dock ? 'pb-2' : 'px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-2')}>
      <div className="mx-auto w-full max-w-3xl overflow-hidden rounded-xl border border-edge bg-surface-panel">
        <div className="flex min-h-16 items-center gap-1 p-2">
          <button type="button" onClick={() => setExpanded(!expanded)} aria-expanded={expanded} aria-controls={detailsId}
            className="flex min-h-11 min-w-0 flex-1 items-center gap-2 rounded-lg px-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium text-fg">{state.source?.title}</span>
              <span className="block text-xs text-fg-muted"><span role="status">{status}</span>{!failed && !preparing ? <span className="tabular-nums"> · {formatTime(state.currentTime)}</span> : null}</span>
            </span>
            <ChevronDown aria-hidden className={cn('size-4 shrink-0 text-fg-muted', expanded && 'rotate-180')} />
          </button>
          <button type="button" onClick={playing ? state.pause : state.resume} disabled={preparing}
            className={cn(controlClass, 'disabled:opacity-50')}
            aria-label={ended ? (zh ? '重新播放' : 'Replay') : failed ? (zh ? '重试朗读' : 'Retry reading') : playing ? (zh ? '暂停朗读' : 'Pause reading') : (zh ? '继续朗读' : 'Resume reading')}>
            {preparing ? <Skeleton className="size-5 rounded-full" /> : failed ? <RotateCcw className="size-5" aria-hidden /> : playing ? <Pause className="size-5" aria-hidden /> : <Play className="size-5" aria-hidden />}
          </button>
          <button type="button" onClick={state.stop} className={controlClass} aria-label={zh ? '停止朗读' : 'Stop reading'}><X className="size-5" aria-hidden /></button>
        </div>
        {state.durationComplete ? <div className="h-0.5 bg-surface-active" aria-hidden><div className="h-full bg-accent" style={{ width: `${Math.min(100, state.currentTime / state.duration * 100)}%` }} /></div> : null}
        {expanded ? <div id={detailsId} className="space-y-3 border-t border-edge-subtle p-4">
          {state.durationComplete ? <ReadAloudProgress key={`${state.source?.type}:${state.source?.id}`} duration={state.duration} currentTime={state.currentTime} disabled={preparing} onSeek={state.seek} label={zh ? '播放进度' : 'Playback position'} /> : null}
          {state.currentText ? <p className="max-h-28 overflow-y-auto overscroll-contain whitespace-pre-wrap break-words text-sm text-fg-muted">{state.currentText}</p> : null}
          {state.source?.href ? <a href={state.source.href} className="inline-flex min-h-11 items-center rounded-lg text-sm text-accent-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">{zh ? '返回来源' : 'Return to source'}</a> : null}
          {failed ? <p role="alert" className="break-words text-sm text-fg-muted">{state.error}</p> : null}
          <PopoverSelect contentClassName="[&_button]:min-h-11" value={String(state.rate)} allowEmpty={false} placeholder="1×" ariaLabel={zh ? '播放速度' : 'Playback speed'}
            options={[0.75, 1, 1.25, 1.5, 2].map((rate) => ({ value: String(rate), label: `${rate}×` }))}
            triggerClassName="min-h-11 w-28" onChange={(value) => state.setRate(Number(value))} />
        </div> : null}
      </div>
    </section>
  ) : null;

  return <>
    {dock ? createPortal(player, dock) : player}
    <ConfirmDialog open={state.consentRequired} title={zh ? '使用在线朗读' : 'Use online read aloud'}
      description={zh ? '朗读默认使用 Microsoft Edge 在线语音服务，待朗读文本会发送至 Microsoft 进行语音合成。' : 'Read aloud uses Microsoft Edge online speech by default. The text will be sent to Microsoft for speech synthesis.'}
      confirmLabel={zh ? '同意并朗读' : 'Agree and read'} cancelLabel={zh ? '取消' : 'Cancel'} onConfirm={state.acceptConsent} onCancel={state.declineConsent} />
  </>;
}

function ReadAloudProgress({ duration, currentTime, disabled, onSeek, label }: {
  duration: number;
  currentTime: number;
  disabled: boolean;
  onSeek: (time: number) => void;
  label: string;
}) {
  const [preview, setPreview] = useState<number | null>(null);
  const commit = () => {
    if (preview === null) return;
    onSeek(preview);
    setPreview(null);
  };
  return <label className="block text-xs text-fg-muted">
    <span className="flex justify-between gap-3"><span>{label}</span><span className="tabular-nums">{formatTime(preview ?? currentTime)} / {formatTime(duration)}</span></span>
    <input type="range" min={0} max={duration} step={0.1} value={preview ?? Math.min(currentTime, duration)} disabled={disabled}
      onChange={(event) => setPreview(Number(event.target.value))} onPointerUp={commit} onKeyUp={commit} onBlur={commit}
      onPointerCancel={() => setPreview(null)} className="block h-11 w-full accent-accent" />
  </label>;
}
