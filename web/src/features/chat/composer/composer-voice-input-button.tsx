import { Mic } from 'lucide-react';

import type { VoiceReadiness } from '@/features/chat/composer/voice-transcribe-api';
import type { ChatMessages } from '@/i18n/messages';
import { cn } from '@/lib/cn';
import { interaction } from '@/lib/interaction';
import { shortcutDisplayKeys } from '@/stores/quick-capture-shortcut-store';
import { useVoiceInputShortcutStore } from '@/stores/voice-input-shortcut-store';

export interface ComposerVoiceInputButtonProps {
  disabled: boolean;
  readiness: VoiceReadiness;
  chat: ChatMessages;
  onStart: () => void;
}

export function ComposerVoiceInputButton({
  disabled,
  readiness,
  chat: m,
  onStart,
}: ComposerVoiceInputButtonProps) {
  const voiceShortcut = useVoiceInputShortcutStore((state) => state.shortcut);
  const actionTitle = readiness.state === 'preparing'
    ? m.voicePreparing
    : readiness.state === 'error' || readiness.state === 'needs_download'
      ? m.voiceNeedsPreparation
      : m.voiceInput;
  const title = `${actionTitle} (${shortcutDisplayKeys(voiceShortcut).join('+')})`;

  return (
    <button
      type="button"
      className={cn(
        'relative inline-flex size-8 shrink-0 items-center justify-center rounded-lg border border-transparent text-fg-subtle hover:bg-surface-hover hover:text-fg',
        interaction.transition,
        interaction.press,
        interaction.focusRingPanel,
        'disabled:cursor-not-allowed disabled:opacity-50',
      )}
      disabled={disabled}
      title={title}
      aria-label={title}
      onClick={() => void onStart()}
    >
      <Mic className="size-4 stroke-[1.75]" />
      {readiness.state === 'preparing' ? (
        <span className="absolute right-0.5 top-0.5 size-1.5 rounded-full bg-amber-500 motion-safe:animate-pulse" aria-hidden />
      ) : readiness.state === 'error' || readiness.state === 'needs_download' ? (
        <span className="absolute right-0.5 top-0.5 size-1.5 rounded-full bg-red-500" aria-hidden />
      ) : null}
    </button>
  );
}
