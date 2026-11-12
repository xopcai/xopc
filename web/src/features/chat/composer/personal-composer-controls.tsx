import { Mic, Plus, Square, ArrowUp } from 'lucide-react';

import { ComposerAddMenu, type ComposerAddActions } from './composer-add-menu';
import { cn } from '@/lib/cn';
import type { ChatMessages } from '@/i18n/messages';
import { interpolate } from '@/features/chat/composer/composer.types';

const controlClass = 'flex size-11 shrink-0 items-center justify-center rounded-full text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent sm:size-10';

export function PersonalComposerAttachButton({ disabled, attachmentCount, maxAttachments, chat, onPickFiles, addActions }: {
  disabled: boolean;
  attachmentCount: number;
  maxAttachments: number;
  chat: ChatMessages;
  onPickFiles: () => void;
  addActions?: ComposerAddActions;
}) {
  const full = attachmentCount >= maxAttachments;
  const label = full ? interpolate(chat.maxAttachmentsReached, { max: maxAttachments }) : chat.attachFile;
  const trigger = <button type="button" className={controlClass} disabled={disabled || (!addActions && full)}
    aria-label={addActions?.label ?? label} title={addActions?.label ?? label} onClick={addActions ? undefined : onPickFiles}>
    <Plus className="size-5" aria-hidden />
  </button>;
  return addActions ? <ComposerAddMenu trigger={trigger} fileLabel={chat.attachFile} filesDisabled={full}
    onPickFiles={onPickFiles} actions={addActions} /> : trigger;
}

export function PersonalComposerActions({ disabled, voiceActive, runBusy, hasDraft, chat, onStartVoiceInput,
  onSend, onAbort }: {
  disabled: boolean;
  voiceActive: boolean;
  runBusy: boolean;
  hasDraft: boolean;
  chat: ChatMessages;
  onStartVoiceInput: () => void;
  onSend: () => void;
  onAbort: () => void;
}) {
  if (voiceActive) return null;
  const stop = runBusy && !hasDraft;
  const actionLabel = stop ? chat.abort : chat.sendMessage;
  return <div className="flex shrink-0 items-center gap-0.5">
    <button type="button" className={controlClass} disabled={disabled} title={chat.voiceInput}
      aria-label={chat.voiceInput} onClick={onStartVoiceInput}>
      <Mic className="size-[1.125rem]" aria-hidden />
    </button>
    <button type="button" className={cn(controlClass, 'bg-accent text-on-accent hover:bg-accent-hover hover:text-on-accent disabled:bg-surface-hover disabled:text-fg-disabled')}
      disabled={!stop && (disabled || !hasDraft)}
      aria-label={actionLabel} title={actionLabel}
      onClick={stop ? onAbort : onSend}>
      {stop ? <Square className="size-4 fill-current" aria-hidden /> : <ArrowUp className="size-5" aria-hidden />}
    </button>
  </div>;
}
