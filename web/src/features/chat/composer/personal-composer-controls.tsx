import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { Ellipsis, Mic, Plus, Square, ArrowUp } from 'lucide-react';

import { cn } from '@/lib/cn';
import type { ChatMessages } from '@/i18n/messages';
import { interpolate } from '@/features/chat/composer/composer.types';

const controlClass = 'flex size-11 shrink-0 items-center justify-center rounded-full text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent sm:size-10';

export function PersonalComposerAttachButton({ disabled, attachmentCount, maxAttachments, chat, onPickFiles }: {
  disabled: boolean;
  attachmentCount: number;
  maxAttachments: number;
  chat: ChatMessages;
  onPickFiles: () => void;
}) {
  const full = attachmentCount >= maxAttachments;
  const label = full ? interpolate(chat.maxAttachmentsReached, { max: maxAttachments }) : chat.attachFile;
  return <button type="button" className={controlClass} disabled={disabled || full}
    aria-label={label} title={label} onClick={onPickFiles}>
    <Plus className="size-5" aria-hidden />
  </button>;
}

export function PersonalComposerActions({ disabled, voiceActive, runBusy, hasDraft, chat, onStartVoiceInput,
  onSend, onQueue, onAbort, onInterrupt }: {
  disabled: boolean;
  voiceActive: boolean;
  runBusy: boolean;
  hasDraft: boolean;
  chat: ChatMessages;
  onStartVoiceInput: () => void;
  onSend: () => void;
  onQueue?: () => void | Promise<void>;
  onAbort: () => void;
  onInterrupt?: () => void;
}) {
  if (voiceActive) return null;
  const canQueue = runBusy && hasDraft && Boolean(onQueue);
  const stop = runBusy && !hasDraft;
  const actionLabel = stop ? chat.abort : canQueue ? chat.followUpQueueAdd : chat.sendMessage;
  return <div className="flex shrink-0 items-center gap-0.5">
    <button type="button" className={controlClass} disabled={disabled} title={chat.voiceInput}
      aria-label={chat.voiceInput} onClick={onStartVoiceInput}>
      <Mic className="size-[1.125rem]" aria-hidden />
    </button>
    {canQueue && <DropdownMenu.Root modal={false}>
      <DropdownMenu.Trigger asChild><button type="button" className={controlClass} aria-label={chat.steeringInterruptSend} title={chat.steeringInterruptSend}>
        <Ellipsis className="size-5" aria-hidden />
      </button></DropdownMenu.Trigger>
      <DropdownMenu.Portal><DropdownMenu.Content side="top" align="end" sideOffset={8}
        className="z-50 min-w-44 rounded-xl border border-edge bg-surface-overlay p-1 shadow-popover">
        {onInterrupt && <DropdownMenu.Item onSelect={onInterrupt} className="cursor-pointer rounded-lg px-3 py-2 text-sm text-fg outline-none focus:bg-surface-hover">{chat.steeringInterruptSend}</DropdownMenu.Item>}
        <DropdownMenu.Item onSelect={onAbort} className="cursor-pointer rounded-lg px-3 py-2 text-sm text-fg outline-none focus:bg-surface-hover">{chat.abort}</DropdownMenu.Item>
      </DropdownMenu.Content></DropdownMenu.Portal>
    </DropdownMenu.Root>}
    <button type="button" className={cn(controlClass, 'bg-accent text-on-accent hover:bg-accent-hover hover:text-on-accent disabled:bg-surface-hover disabled:text-fg-disabled')}
      disabled={!stop && (disabled || !hasDraft || (runBusy && !onQueue))}
      aria-label={actionLabel} title={actionLabel}
      onClick={stop ? onAbort : canQueue ? () => void onQueue?.() : onSend}>
      {stop ? <Square className="size-4 fill-current" aria-hidden /> : <ArrowUp className="size-5" aria-hidden />}
    </button>
  </div>;
}
