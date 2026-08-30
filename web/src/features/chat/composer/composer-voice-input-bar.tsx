import { Check, Loader2, RotateCcw, X } from 'lucide-react';
import { memo } from 'react';

import type { VoiceInputPhase } from '@/features/chat/composer/use-composer-voice-input';
import type { VoiceReadiness } from '@/features/chat/composer/voice-transcribe-api';
import type { ChatMessages } from '@/i18n/messages';
import { cn } from '@/lib/cn';
import { interaction } from '@/lib/interaction';

export interface ComposerVoiceInputBarProps {
  phase: VoiceInputPhase;
  elapsedLabel: string;
  audioLevel: number;
  readiness: VoiceReadiness;
  hasRetainedRecording: boolean;
  disabled?: boolean;
  chat: ChatMessages;
  onCancel: () => void;
  onConfirm: () => void;
  onRetry: () => void;
}

const iconBtnClass = cn(
  'inline-flex size-8 shrink-0 items-center justify-center rounded-lg text-fg-muted',
  'hover:bg-surface-hover hover:text-fg',
  interaction.transition,
  interaction.press,
  interaction.focusRingPanel,
  'disabled:cursor-not-allowed disabled:opacity-50',
);

function formatDownloadBytes(bytes: number | undefined): string | null {
  if (typeof bytes !== 'number' || !Number.isFinite(bytes) || bytes <= 0) return null;
  return `${(bytes / 1024 / 1024).toFixed(bytes >= 100 * 1024 * 1024 ? 0 : 1)} MB`;
}

export const ComposerVoiceInputBar = memo(function ComposerVoiceInputBar({
  phase,
  elapsedLabel,
  audioLevel,
  readiness,
  hasRetainedRecording,
  disabled,
  chat: m,
  onCancel,
  onConfirm,
  onRetry,
}: ComposerVoiceInputBarProps) {
  const transcribing = phase === 'transcribing';
  const preparing = phase === 'preparing';
  const requesting = phase === 'requesting';
  const starting = phase === 'starting';
  const failed = phase === 'error';
  const progress = typeof readiness.progress === 'number'
    ? Math.round(Math.max(0, Math.min(1, readiness.progress)) * 100)
    : null;
  const downloaded = formatDownloadBytes(readiness.downloadedBytes);
  const total = formatDownloadBytes(readiness.totalBytes);
  const preparingStatus = progress === null
    ? m.voicePreparing
    : `${m.voicePreparingProgress.replace('{progress}', String(progress))}${downloaded && total ? ` · ${downloaded} / ${total}` : ''}`;
  const status = failed
    ? hasRetainedRecording ? m.voiceRetryAvailable : m.voicePreparationFailed
    : preparing
      ? preparingStatus
      : requesting
        ? m.voiceRequestingMicrophone
        : starting
          ? m.voiceStartingMicrophone
        : transcribing
          ? m.voiceTranscribing
          : m.voiceRecordingStatus;

  return (
    <div
      className="flex min-h-10 w-full items-center gap-2 py-2"
      role="region"
      aria-label={m.voiceInput}
    >
      {phase === 'recording' ? (
        <div className="flex h-5 shrink-0 items-center gap-0.5" aria-hidden>
          {Array.from({ length: 9 }, (_, index) => {
            const emphasis = 0.35 + ((index % 4) + 1) * 0.16;
            const height = Math.max(3, Math.round(18 * Math.min(1, audioLevel * emphasis + 0.08)));
            return <span key={index} className="w-0.5 rounded-full bg-red-500 transition-[height] duration-75" style={{ height }} />;
          })}
        </div>
      ) : (
        <Loader2 className={cn('size-4 shrink-0', !failed && 'animate-spin', failed && 'text-red-500')} aria-hidden />
      )}

      <span className="min-w-0 flex-1 truncate text-sm text-fg-muted">
        {status}
      </span>

      <span className="shrink-0 tabular-nums text-sm text-fg-subtle" aria-live="polite">
        {phase === 'recording' ? elapsedLabel : ''}
      </span>

      <div className="flex shrink-0 items-center gap-0.5">
        <button
          type="button"
          className={iconBtnClass}
          disabled={disabled || transcribing}
          title={m.voiceInputCancel}
          aria-label={m.voiceInputCancel}
          onClick={onCancel}
        >
          <X className="size-4" />
        </button>
        {failed ? (
          <button type="button" className={cn(iconBtnClass, 'text-fg')} disabled={disabled} title={m.voiceRetry} aria-label={m.voiceRetry} onClick={onRetry}>
            <RotateCcw className="size-4" />
          </button>
        ) : phase === 'recording' ? (
          <button type="button" className={cn(iconBtnClass, 'text-fg')} disabled={disabled} title={m.voiceInputConfirm} aria-label={m.voiceInputConfirm} onClick={onConfirm}>
            <Check className="size-4" />
          </button>
        ) : null}
      </div>
    </div>
  );
});
