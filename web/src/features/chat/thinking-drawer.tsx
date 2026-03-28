import { X } from 'lucide-react';

import type { ThinkingContent, ToolUseContent } from '@/features/chat/messages.types';
import { SearchSourceList } from '@/features/chat/search-source-list';
import { StepTimeline } from '@/features/chat/step-timeline';
import { cn } from '@/lib/cn';
import { messages } from '@/i18n/messages';
import { useLocaleStore } from '@/stores/locale-store';

interface ThinkingDrawerProps {
  blocks: Array<ThinkingContent | ToolUseContent>;
  onClose: () => void;
  /** True while the shell is playing the close transition (before unmount). */
  isExiting?: boolean;
}

export function ThinkingDrawer({ blocks, onClose, isExiting = false }: ThinkingDrawerProps) {
  const language = useLocaleStore((s) => s.language);
  const m = messages(language);

  return (
    <aside
      className={cn(
        'thinking-drawer-panel flex max-h-full flex-col bg-surface-panel',
        isExiting && 'thinking-drawer-panel--exit',
        'max-md:fixed max-md:inset-x-0 max-md:bottom-0 max-md:z-30 max-md:max-h-[min(72vh,28rem)] max-md:rounded-t-xl max-md:border max-md:border-edge-subtle max-md:border-b-0 max-md:shadow-xl',
        'md:fixed md:inset-y-0 md:right-0 md:z-30 md:w-[var(--width-thinking-drawer)] md:border-l md:border-edge-subtle md:shadow-lg',
        'xl:relative xl:inset-auto xl:z-0 xl:h-full xl:w-[var(--width-thinking-drawer)] xl:shrink-0 xl:bg-surface-base xl:shadow-none',
      )}
    >
      <div className="flex shrink-0 items-center justify-between border-b border-edge-subtle px-4 py-3">
        <span className="text-sm font-medium text-fg">{m.chat.thinkingDrawerTitle}</span>
        <button
          type="button"
          onClick={onClose}
          className="rounded p-0.5 text-fg-muted hover:bg-surface-hover hover:text-fg"
          aria-label={m.chat.thinkingDrawerClose}
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4 pt-3">
        <StepTimeline blocks={blocks} />
        <SearchSourceList blocks={blocks} />
      </div>
    </aside>
  );
}
