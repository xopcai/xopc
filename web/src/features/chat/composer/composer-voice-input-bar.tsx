import { Check, CircleAlert, RotateCcw, Settings2, X } from 'lucide-react';
import { memo } from 'react';

import type { VoiceInputPhase } from '@/features/voice/realtime/use-realtime-voice';
import type { ChatMessages } from '@/i18n/messages';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/cn';
import { interaction } from '@/lib/interaction';

export interface ComposerVoiceInputBarProps {
  phase: VoiceInputPhase;
  elapsedLabel: string;
  audioLevel: number;
  partialTranscript: string;
  finalTranscript: string;
  error?: string | null;
  settingsRequired?: boolean;
  disabled?: boolean;
  chat: ChatMessages;
  onCancel: () => void;
  onConfirm: () => void;
  onRetry: () => void;
}

const iconBtnClass = cn(
  'inline-flex min-h-11 min-w-11 shrink-0 gap-2 px-3 items-center justify-center rounded-lg text-fg-muted',
  'hover:bg-surface-hover hover:text-fg',
  interaction.transition,
  interaction.press,
  interaction.focusRingPanel,
  'disabled:cursor-not-allowed disabled:opacity-50',
);

export const ComposerVoiceInputBar = memo(function ComposerVoiceInputBar({
  phase,
  elapsedLabel,
  audioLevel,
  partialTranscript,
  finalTranscript,
  error,
  settingsRequired,
  disabled,
  chat: m,
  onCancel,
  onConfirm,
  onRetry,
}: ComposerVoiceInputBarProps) {
  const transcribing = phase === 'transcribing';
  const requesting = phase === 'requesting';
  const starting = phase === 'starting';
  const failed = phase === 'error';
  const status = failed
    ? error || m.voiceTranscribeFailed
    : requesting ? m.voiceRequestingMicrophone
      : starting ? m.voiceStartingMicrophone
        : transcribing ? m.voiceTranscribing : m.voiceRecordingStatus;
  const transcript = [finalTranscript, partialTranscript].filter(Boolean).join(' ');

  return (
    <section className="w-full space-y-3 py-3" aria-label={m.voiceInput} aria-busy={requesting || starting || transcribing}>
      <div className="flex items-center gap-3 px-1">
        {phase === 'recording' ? (
          <div className="flex h-5 shrink-0 items-center gap-0.5" aria-hidden>
            {Array.from({ length: 9 }, (_, index) => {
              const emphasis = 0.35 + ((index % 4) + 1) * 0.16;
              const height = Math.max(3, Math.round(18 * Math.min(1, audioLevel * emphasis + 0.08)));
              return <span key={index} className="w-0.5 rounded-full bg-fg-muted motion-safe:transition-[height] motion-safe:duration-75" style={{ height }} />;
            })}
          </div>
        ) : failed ? <CircleAlert className="size-4 shrink-0 text-danger" aria-hidden /> : <Skeleton className="h-4 w-8" />}
        <p className="min-w-0 flex-1 break-words text-sm text-fg-muted" role={failed ? 'alert' : 'status'}>{status}</p>
        {phase === 'recording' ? <span className="shrink-0 text-sm tabular-nums text-fg-muted">{elapsedLabel}</span> : null}
      </div>
      {transcript ? <p className="max-h-28 overflow-y-auto overscroll-contain whitespace-pre-wrap break-words px-1 text-base text-fg">{transcript}</p> : null}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <button type="button" className={iconBtnClass} title={m.voiceInputCancel} aria-label={m.voiceInputCancel} onClick={onCancel}>
          <X className="size-4" aria-hidden />{m.voiceInputCancel}
        </button>
        {failed && settingsRequired ? (
          <a href="#/settings/capabilities/voice" className={cn(iconBtnClass, 'text-accent-fg')}>
            <Settings2 className="size-4" aria-hidden />{m.voiceOpenSettings}
          </a>
        ) : failed ? (
          <button type="button" className={iconBtnClass} disabled={disabled} aria-label={m.voiceRetry} onClick={onRetry}>
            <RotateCcw className="size-4" aria-hidden />{m.voiceRetry}
          </button>
        ) : null}
        {phase === 'recording' || (failed && finalTranscript) ? (
          <button type="button" className={cn(iconBtnClass, 'rounded-full bg-accent text-on-accent hover:bg-accent-hover hover:text-on-accent')}
            disabled={disabled} aria-label={m.voiceInputConfirm} onClick={onConfirm}>
            <Check className="size-4" aria-hidden />{m.voiceInputConfirm}
          </button>
        ) : null}
      </div>
    </section>
  );
});
