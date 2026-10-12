import { ListEnd } from 'lucide-react';

import type { ChatMessages } from '@/i18n/messages';
import { cn } from '@/lib/cn';
import { interaction } from '@/lib/interaction';

export function FollowUpQueueModeControl({ enabled, onToggle, disabled, chat }: {
  enabled: boolean;
  onToggle: () => void;
  disabled?: boolean;
  chat: ChatMessages;
}) {
  return (
    <button type="button" aria-pressed={enabled} disabled={disabled} onClick={onToggle}
      aria-label={enabled ? chat.followUpQueueTurnOff : chat.followUpQueueTurnOn}
      title={enabled ? chat.followUpQueueModeHint : chat.followUpImmediateModeHint}
      className={cn('inline-flex size-8 shrink-0 items-center justify-center rounded-lg text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg disabled:opacity-35',
        enabled && 'bg-surface-hover text-fg', interaction.focusRingPanel)}>
      <ListEnd className="size-4" aria-hidden />
    </button>
  );
}
