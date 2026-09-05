import { Mic } from 'lucide-react';

import type { ChatMessages } from '@/i18n/messages';
import { cn } from '@/lib/cn';
import { interaction } from '@/lib/interaction';
import { shortcutDisplayKeys } from '@/stores/quick-capture-shortcut-store';
import { useVoiceInputShortcutStore } from '@/stores/voice-input-shortcut-store';

export interface ComposerVoiceInputButtonProps {
  disabled: boolean;
  chat: ChatMessages;
  onStart: () => void;
}

export function ComposerVoiceInputButton({
  disabled,
  chat: m,
  onStart,
}: ComposerVoiceInputButtonProps) {
  const voiceShortcut = useVoiceInputShortcutStore((state) => state.shortcut);
  const title = `${m.voiceInput} (${shortcutDisplayKeys(voiceShortcut).join('+')})`;

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
    </button>
  );
}
