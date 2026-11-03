import * as Dialog from '@radix-ui/react-dialog';
import { ChevronRight, Target, X } from 'lucide-react';
import { useRef, useState, type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';

import { TASK_DETAIL_MODAL_PARAM } from '@/features/tasks/task-detail-route';
import { messages } from '@/i18n/messages';

import { AssistantCapsuleContent, assistantCapsuleClassName, assistantCapsuleListClassName } from '../messages/assistant-capsule';
import type { productDeliveryReferences } from './product-delivery-model';

type Entry = ReturnType<typeof productDeliveryReferences>[number];

export function TaskDeliveryGroup({ entries, language, renderEntry }: {
  entries: Entry[];
  language: 'en' | 'zh';
  renderEntry: (entry: Entry, fullTitle: boolean) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const listScrollTopRef = useRef(0);
  const returnFocusRef = useRef(false);
  const location = useLocation();
  // Keep the list's state while the existing route-based task details are open.
  const showingTask = new URLSearchParams(location.search).has(TASK_DETAIL_MODAL_PARAM);
  const labels = messages(language).chat.productDelivery;
  const title = labels.relatedTaskCount.replace('{{count}}', String(entries.length));

  return <li className="min-w-0 max-w-full" data-product-task-group>
    <Dialog.Root open={open && !showingTask} onOpenChange={next => {
      returnFocusRef.current = !next;
      setOpen(next);
    }}>
      <Dialog.Trigger asChild>
        <button ref={triggerRef} type="button"
          className={assistantCapsuleClassName}>
          <AssistantCapsuleContent icon={<Target />} title={title}
            trailing={<ChevronRight className="size-3.5 shrink-0 text-fg-subtle" aria-hidden />} />
        </button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[80] bg-scrim" />
        <Dialog.Content
          className="fixed left-1/2 top-1/2 z-[90] flex h-[min(40rem,calc(100dvh-2rem))] w-[min(40rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-2xl border border-edge bg-surface-overlay focus:outline-none"
          onOpenAutoFocus={event => {
            event.preventDefault();
            titleRef.current?.focus({ preventScroll: true });
          }}
          onCloseAutoFocus={event => {
            event.preventDefault();
            // Focusing a transcript button normally can scroll the chat to it.
            if (returnFocusRef.current) triggerRef.current?.focus({ preventScroll: true });
          }}>
          <header className="flex shrink-0 items-center gap-3 border-b border-edge px-4 py-3">
            <Dialog.Title ref={titleRef} tabIndex={-1} className="min-w-0 flex-1 font-medium text-fg focus:outline-none">{title}</Dialog.Title>
            <Dialog.Close aria-label={labels.closeTaskList}
              className="flex size-11 shrink-0 items-center justify-center rounded-lg text-fg-muted hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">
              <X className="size-4" aria-hidden />
            </Dialog.Close>
          </header>
          <Dialog.Description className="sr-only">{labels.relatedTasksDescription}</Dialog.Description>
          <div data-task-delivery-list className="min-h-0 flex-1 overflow-y-auto overscroll-contain"
            ref={element => { if (element) element.scrollTop = listScrollTopRef.current; }}
            onScroll={event => { listScrollTopRef.current = event.currentTarget.scrollTop; }}>
            <ul className={`${assistantCapsuleListClassName} p-3`}>
              {entries.map(entry => renderEntry(entry, true))}
            </ul>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  </li>;
}
