import { Check, Loader2, X } from 'lucide-react';
import { memo } from 'react';

import type { VoiceInputPhase } from '@/features/chat/composer/use-composer-voice-input';
import type { ChatMessages } from '@/i18n/messages';
import { cn } from '@/lib/cn';
import { interaction } from '@/lib/interaction';

export interface ComposerVoiceInputBarProps {
  phase: VoiceInputPhase;
  elapsedLabel: string;
  disabled?: boolean;
  chat: ChatMessages;
  onCancel: () => void;
  onConfirm: () => void;
}

const iconBtnClass = cn(
  'inline-flex size-8 shrink-0 items-center justify-center rounded-lg text-fg-muted',
  'hover:bg-surface-hover hover:text-fg',
  interaction.transition,
  interaction.press,
  interaction.focusRingPanel,
  'disabled:cursor-not-allowed disabled:opacity-50',
);

export const ComposerVoiceInputBar = memo(function ComposerVoiceInputBar({
  phase,
  elapsedLabel,
  disabled,
  chat: m,
  onCancel,
  onConfirm,
}: ComposerVoiceInputBarProps) {
  const transcribing = phase === 'transcribing';

  return (
    <div
      className="flex min-h-10 w-full items-center gap-2 py-2"
      role="region"
      aria-label={m.voiceInput}
    >
      <span
        className={cn(
          'size-2 shrink-0 rounded-full bg-red-500',
          !transcribing && 'animate-pulse',
        )}
        aria-hidden
      />

      <span className="min-w-0 flex-1 truncate text-sm text-fg-muted">
        {transcribing ? m.voiceTranscribing : m.voiceRecordingStatus}
      </span>

      <span className="shrink-0 tabular-nums text-sm text-fg-subtle" aria-live="polite">
        {transcribing ? '' : elapsedLabel}
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
        <button
          type="button"
          className={cn(iconBtnClass, 'text-fg')}
          disabled={disabled || transcribing}
          title={m.voiceInputConfirm}
          aria-label={m.voiceInputConfirm}
          onClick={onConfirm}
        >
          {transcribing ? (
            <Loader2 className="size-4 animate-spin" aria-hidden />
          ) : (
            <Check className="size-4" />
          )}
        </button>
      </div>
    </div>
  );
});
