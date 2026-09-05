import { Paperclip, Sparkles } from 'lucide-react';
import type {
  ClipboardEventHandler,
  DragEventHandler,
  FormEventHandler,
  ReactNode,
  Ref,
} from 'react';

import { Button } from '@/components/ui/button';
import { TabCompletionTextarea } from '@/components/ui/tab-completion-input';
import type { Attachment } from '@/features/chat/attachments/attachment-utils';
import { ComposerAttachmentChips } from '@/features/chat/composer/composer-attachment-chips';
import { ComposerVoiceInputBar } from '@/features/chat/composer/composer-voice-input-bar';
import { ComposerVoiceInputButton } from '@/features/chat/composer/composer-voice-input-button';
import type { UseComposerVoiceInputReturn } from '@/features/chat/composer/use-composer-voice-input';
import type { ChatMessages } from '@/i18n/messages';
import { cn } from '@/lib/cn';

const MAX_INTENT_LENGTH = 12_000;

export interface HomeQuickComposerLabels {
  attachTitle: string;
  dropFiles: string;
  intentLabel: string;
  intentPlaceholder: string;
  intentSuggestion: string;
  shortcut: string;
  submit: string;
}

export interface HomeQuickComposerProps {
  variant: 'inline' | 'dialog';
  inputId: string;
  inputRef: Ref<HTMLTextAreaElement>;
  intent: string;
  labels: HomeQuickComposerLabels;
  attachments: Attachment[];
  isDragging: boolean;
  attachmentBusy: boolean;
  attachmentsFull: boolean;
  voice: UseComposerVoiceInputReturn;
  chat: ChatMessages;
  cancelAction?: ReactNode;
  onIntentChange: (value: string) => void;
  onPickFiles: () => void;
  onRemoveAttachment: (index: number) => void;
  onPaste: ClipboardEventHandler<HTMLTextAreaElement>;
  onDragOver: DragEventHandler<HTMLFormElement>;
  onDragLeave: DragEventHandler<HTMLFormElement>;
  onDrop: DragEventHandler<HTMLFormElement>;
  onSubmit: FormEventHandler<HTMLFormElement>;
}

export function HomeQuickComposer({
  variant,
  inputId,
  inputRef,
  intent,
  labels,
  attachments,
  isDragging,
  attachmentBusy,
  attachmentsFull,
  voice,
  chat,
  cancelAction,
  onIntentChange,
  onPickFiles,
  onRemoveAttachment,
  onPaste,
  onDragOver,
  onDragLeave,
  onDrop,
  onSubmit,
}: HomeQuickComposerProps) {
  const inline = variant === 'inline';
  const hasDraft = Boolean(intent.trim()) || attachments.length > 0;
  const editorHidden = voice.voiceActive && voice.phase !== 'error';

  return (
    <form
      onSubmit={(event) => {
        if (voice.voiceActive) {
          event.preventDefault();
          return;
        }
        onSubmit(event);
      }}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      className={cn(
        'relative',
        inline
          ? 'mx-auto mt-8 w-full max-w-[640px] overflow-hidden rounded-2xl border border-edge bg-surface-base p-2 text-left shadow-surface transition-colors focus-within:border-accent focus-within:ring-2 focus-within:ring-accent/15'
          : 'flex min-h-0 flex-1 flex-col',
      )}
    >
      {isDragging ? (
        <div
          className={cn(
            'pointer-events-none absolute inset-0 z-10 flex items-center justify-center bg-accent-soft/90 text-sm font-medium text-accent-fg backdrop-blur-[1px]',
            inline && 'rounded-2xl',
          )}
        >
          {labels.dropFiles}
        </div>
      ) : null}

      <div className={cn(!inline && 'flex min-h-0 flex-1 flex-col overflow-y-auto px-5 py-4')}>
        <label
          htmlFor={inputId}
          className={inline ? 'sr-only' : 'mb-2 shrink-0 text-sm font-medium text-fg'}
        >
          {labels.intentLabel}
        </label>
        {voice.voiceActive ? (
          <ComposerVoiceInputBar
            phase={voice.phase}
            elapsedLabel={voice.elapsedLabel}
            audioLevel={voice.audioLevel}
            partialTranscript={voice.partialTranscript}
            finalTranscript={voice.finalTranscript}
            responseText={voice.responseText}
            responsePhase={voice.responsePhase}
            muted={voice.muted}
            mode={voice.mode}
            disabled={attachmentBusy}
            chat={chat}
            onCancel={voice.cancelVoiceInput}
            onConfirm={voice.confirmVoiceInput}
            onInterruptResponse={voice.interruptResponse}
            onToggleMute={voice.toggleMute}
            onRetry={voice.retryVoiceInput}
          />
        ) : null}
        <TabCompletionTextarea
          ref={inputRef}
          id={inputId}
          className={cn(
            'w-full resize-none text-sm font-normal leading-6 text-fg outline-none placeholder:text-fg-subtle',
            editorHidden && 'hidden',
            inline
              ? 'min-h-24 bg-transparent px-3 py-2'
              : 'min-h-32 flex-1 rounded-xl border border-edge bg-surface-base p-3 focus:border-accent focus:ring-2 focus:ring-accent/20',
          )}
          value={intent}
          onChange={(event) => onIntentChange(event.target.value)}
          onPaste={onPaste}
          suggestion={labels.intentSuggestion}
          onAcceptSuggestion={onIntentChange}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
              event.preventDefault();
              event.currentTarget.form?.requestSubmit();
            }
          }}
          placeholder={labels.intentPlaceholder}
          maxLength={MAX_INTENT_LENGTH}
          autoFocus={!inline}
        />
        <ComposerAttachmentChips
          attachments={attachments}
          topPadded={false}
          onRemove={onRemoveAttachment}
          className={inline
            ? 'border-b-0 bg-transparent px-3 pb-2 pt-0'
            : 'mt-3 border-b-0 bg-transparent px-0 pb-0'}
        />
        {!inline ? (
          <div className="mt-2 flex shrink-0 items-center justify-between gap-3 text-[11px] text-fg-subtle">
            <span>{labels.shortcut}</span>
            <span className="tabular-nums">
              {intent.length.toLocaleString()} / {MAX_INTENT_LENGTH.toLocaleString()}
            </span>
          </div>
        ) : null}
      </div>

      <div className={cn(
        'flex shrink-0 items-center gap-2 border-t',
        inline ? 'border-edge-subtle px-1 pt-2' : 'border-edge px-5 py-4',
      )}>
        <div className={cn('flex items-center gap-1', !inline && 'mr-auto')}>
          <Button
            type="button"
            variant="ghost"
            className="size-9 rounded-lg p-0"
            disabled={attachmentBusy || attachmentsFull}
            title={labels.attachTitle}
            aria-label={labels.attachTitle}
            onClick={onPickFiles}
          >
            <Paperclip className="size-4" aria-hidden />
          </Button>
          {!voice.voiceActive ? (
            <ComposerVoiceInputButton
              disabled={attachmentBusy}
              chat={chat}
              onStart={voice.startVoiceInput}
            />
          ) : null}
        </div>
        {inline ? (
          <span className="hidden text-[11px] text-fg-subtle sm:inline">{labels.shortcut}</span>
        ) : cancelAction}
        <Button
          type="submit"
          variant="primary"
          className={inline ? 'ml-auto h-9 rounded-lg px-3.5 text-xs' : 'min-w-32'}
          disabled={!hasDraft || attachmentBusy || voice.voiceActive}
        >
          <Sparkles className={inline ? 'size-3.5' : 'size-4'} aria-hidden />
          {labels.submit}
        </Button>
      </div>
    </form>
  );
}
