import { Lightbulb, Loader2 } from 'lucide-react';

import { cn } from '@/lib/cn';
import { interaction } from '@/lib/interaction';
import { messages } from '@/i18n/messages';
import { useLocaleStore } from '@/stores/locale-store';

interface ThinkingEntryRowProps {
  isStreaming: boolean;
  /** Drawer is showing this row's steps — click again collapses. */
  isActive?: boolean;
  onClick: () => void;
}

export function ThinkingEntryRow({
  isStreaming,
  isActive = false,
  onClick,
}: ThinkingEntryRowProps) {
  const language = useLocaleStore((s) => s.language);
  const m = messages(language);

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={isStreaming}
      aria-expanded={isActive}
      title={isActive ? m.chat.thinkingEntryCollapseHint : m.chat.thinkingEntryOpenHint}
      className={cn(
        'flex items-center gap-1.5 rounded-md px-1 py-0.5 text-xs text-fg-muted',
        interaction.transition,
        'hover:bg-surface-hover hover:text-fg',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
        'disabled:cursor-default disabled:opacity-70',
        isActive && 'bg-surface-hover/80 text-fg',
      )}
    >
      {isStreaming ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin text-accent-fg" aria-hidden />
      ) : (
        <Lightbulb className="h-3.5 w-3.5 text-accent-fg" aria-hidden />
      )}
      <span>{isStreaming ? m.chat.thinkingEntryStreaming : m.chat.thinkingEntryDone}</span>
      {!isStreaming ? (
        <span className="text-fg-disabled" aria-hidden>
          {isActive ? '‹' : '›'}
        </span>
      ) : null}
    </button>
  );
}
