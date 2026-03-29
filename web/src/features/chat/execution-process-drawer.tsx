import { X } from 'lucide-react';

import {
  AssistantStepsTimeline,
  collectAssistantStepBlocks,
} from '@/features/chat/assistant-steps-block';
import type { Message } from '@/features/chat/messages.types';
import { SearchSourceList } from '@/features/chat/search-source-list';
import { messages } from '@/i18n/messages';
import { cn } from '@/lib/cn';
import { interaction } from '@/lib/interaction';
import { useChatExecutionDrawerStore } from '@/stores/chat-execution-drawer-store';
import { useLocaleStore } from '@/stores/locale-store';
import { useLayoutEffect, useMemo, useState } from 'react';

export function ExecutionProcessDrawer({ messages: list }: { messages: Message[] }) {
  const language = useLocaleStore((s) => s.language);
  const m = messages(language);
  const open = useChatExecutionDrawerStore((s) => s.open);
  const focusedIndex = useChatExecutionDrawerStore((s) => s.focusedMessageIndex);
  const closeDrawer = useChatExecutionDrawerStore((s) => s.closeDrawer);

  const focused = focusedIndex != null ? list[focusedIndex] : undefined;
  const stepBlocks = useMemo(
    () => (focused ? collectAssistantStepBlocks(focused) : []),
    [focused],
  );

  const toolLabels = useMemo(
    () => ({ input: m.chat.toolInput, output: m.chat.toolOutput, noOutput: m.chat.noOutput }),
    [m.chat.toolInput, m.chat.toolOutput, m.chat.noOutput],
  );
  const stepLabels = useMemo(
    () => ({
      thoughts: m.chat.thoughts,
      thoughtsStreaming: m.chat.thoughtsStreaming,
      searchedWeb: m.chat.stepSearchedWeb,
      readFile: m.chat.stepReadFile,
      stepDetails: m.chat.stepDetails,
    }),
    [
      m.chat.thoughts,
      m.chat.thoughtsStreaming,
      m.chat.stepSearchedWeb,
      m.chat.stepReadFile,
      m.chat.stepDetails,
    ],
  );

  const [entered, setEntered] = useState(false);

  useLayoutEffect(() => {
    const id = requestAnimationFrame(() => {
      setEntered(true);
    });
    return () => cancelAnimationFrame(id);
  }, []);

  if (!open) {
    return null;
  }

  const overlayMotionClass =
    'transition-opacity duration-300 ease-[cubic-bezier(0.33,1,0.68,1)] motion-reduce:transition-none motion-reduce:duration-0';
  const drawerSlideClass =
    'transition-transform duration-300 ease-[cubic-bezier(0.33,1,0.68,1)] motion-reduce:transition-none motion-reduce:duration-0';

  return (
    <>
      <button
        type="button"
        className={cn(
          'fixed inset-0 z-30 bg-black/20 lg:hidden',
          overlayMotionClass,
          entered ? 'opacity-100' : 'opacity-0 pointer-events-none',
        )}
        aria-label={m.chat.executionDrawerClose}
        onClick={() => closeDrawer()}
      />
      <aside
        id="chat-execution-drawer"
        className={cn(
          /* Shell split vs main chat: color only — no vertical border between large zones */
          'chat-execution-drawer flex min-h-0 w-[min(100%,420px)] max-w-[min(100%,420px)] min-w-0 flex-col overflow-x-hidden bg-surface-base text-fg',
          'fixed inset-y-0 right-0 z-40 max-h-full lg:static lg:z-auto lg:h-full lg:min-h-0 lg:w-full lg:max-w-none',
          drawerSlideClass,
          /* lg: no opacity fade on open — avoids stacking with main column reflow; mobile: slide in from right */
          entered
            ? 'translate-x-0 opacity-100'
            : 'translate-x-full opacity-100 lg:translate-x-0 lg:opacity-100',
          'motion-reduce:translate-x-0 motion-reduce:opacity-100',
        )}
        aria-label={m.chat.executionDrawerTitle}
      >
        <div className="flex min-w-0 shrink-0 items-start justify-between gap-3 bg-surface-hover/40 px-4 py-3 dark:bg-surface-hover/30">
          <p className="min-w-0 flex-1 text-sm font-medium leading-snug text-fg [overflow-wrap:anywhere]">
            {m.chat.executionDrawerTitle}
          </p>
          <button
            type="button"
            className={cn(
              'shrink-0 rounded-md p-1.5 text-fg-muted',
              interaction.transition,
              interaction.press,
              'hover:bg-surface-hover hover:text-fg',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface-base',
            )}
            aria-label={m.chat.executionDrawerClose}
            onClick={() => closeDrawer()}
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>
        <div className="chat-execution-drawer-scroll min-h-0 min-w-0 flex-1 overflow-y-auto overflow-x-hidden px-4 py-4 [overflow-wrap:anywhere]">
          {stepBlocks.length === 0 ? (
            <p className="text-sm text-fg-muted">{m.chat.executionDrawerEmpty}</p>
          ) : (
            <>
              <AssistantStepsTimeline blocks={stepBlocks} toolLabels={toolLabels} stepLabels={stepLabels} />
              <SearchSourceList blocks={stepBlocks} />
            </>
          )}
        </div>
      </aside>
    </>
  );
}
