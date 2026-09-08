import { AudioLines, Plus, Send, Square } from 'lucide-react';
import { memo, type HTMLAttributes } from 'react';

import { ComposerModelConfigControl } from '@/features/chat/model/composer-model-config-control';
import { ComposerVoiceInputButton } from '@/features/chat/composer/composer-voice-input-button';
import { interpolate } from '@/features/chat/composer/composer.types';
import { cn } from '@/lib/cn';
import { interaction } from '@/lib/interaction';
import type { MessageBundle } from '@/i18n/messages';

export interface ComposerToolbarProps {
  disabled: boolean;
  sending: boolean;
  streaming: boolean;
  runBusy: boolean;
  /** Chat message bundle (toolbar labels). */
  chat: MessageBundle['chat'];
  /** Non-empty text or at least one attachment. */
  hasDraft: boolean;
  /** Show “send now” during streaming (requires follow-up / interrupt affordance). */
  showSteeringInterrupt: boolean;

  attachmentCount: number;
  maxAttachments: number;
  onPickFiles: () => void;

  thinkingLevel: string;
  onThinkingChange: (level: string) => void | Promise<void>;

  voiceActive: boolean;
  onStartVoiceInput: () => void;
  voiceConversationEnabled: boolean;
  onStartVoiceConversation: () => void;

  onSend: () => void;
  onAbort: () => void;
  onInterrupt?: () => void;

  sessionModel: string;
  showModelSelector: boolean;
  onModelChange: (modelId: string) => void | Promise<void>;
  modelDisabled: boolean;
}

export function ComposerAttachButton({
  disabled,
  runBusy,
  attachmentCount,
  maxAttachments,
  chat: m,
  onPickFiles,
}: Pick<ComposerToolbarProps, 'disabled' | 'runBusy' | 'attachmentCount' | 'maxAttachments' | 'chat' | 'onPickFiles'>) {
  const attachmentsFull = attachmentCount >= maxAttachments;
  const title = attachmentsFull
    ? interpolate(m.maxAttachmentsReached, { max: maxAttachments })
    : `${m.attachFile} (${attachmentCount}/${maxAttachments})`;

  return (
    <button
      type="button"
      className={cn(
        'inline-flex size-8 shrink-0 items-center justify-center rounded-lg text-fg-muted hover:bg-surface-hover hover:text-fg',
        interaction.transition,
        interaction.press,
        interaction.focusRingPanel,
        'disabled:cursor-not-allowed disabled:opacity-50',
      )}
      disabled={attachmentsFull || disabled || runBusy}
      title={title}
      aria-label={title}
      onClick={onPickFiles}
    >
      <Plus className="size-4" />
    </button>
  );
}

export function ComposerRunControl({
  disabled,
  voiceActive,
  runBusy,
  hasDraft,
  showSteeringInterrupt,
  chat: m,
  onSend,
  onAbort,
  onInterrupt,
}: Pick<ComposerToolbarProps, 'disabled' | 'voiceActive' | 'runBusy' | 'hasDraft' | 'showSteeringInterrupt' | 'chat' | 'onSend' | 'onAbort' | 'onInterrupt'>) {
  return (
    <div className="flex shrink-0 items-center gap-1">
      {runBusy ? (
        <>
          {showSteeringInterrupt && onInterrupt ? (
            <button
              type="button"
              className={cn(
                'inline-flex size-8 shrink-0 items-center justify-center rounded-lg border border-transparent text-accent-fg hover:bg-accent-soft dark:hover:bg-accent-soft',
                interaction.transition,
                interaction.press,
                interaction.focusRingPanel,
              )}
              title={m.steeringInterruptSend}
              aria-label={m.steeringInterruptSend}
              onClick={() => void onInterrupt()}
            >
              <Send className="size-4 stroke-[1.75]" />
            </button>
          ) : null}
          <button
            type="button"
            className={cn(
              'inline-flex size-8 shrink-0 items-center justify-center rounded-lg bg-surface-hover/70 text-fg-muted hover:bg-surface-hover hover:text-fg dark:bg-surface-hover/50',
              interaction.transition,
              interaction.press,
              interaction.focusRingPanel,
            )}
            title={m.abort}
            aria-label={m.abort}
            onClick={onAbort}
          >
            <Square className="size-4 stroke-[1.75]" />
          </button>
        </>
      ) : (
        <button
          type="button"
          className={cn(
            'inline-flex size-8 shrink-0 items-center justify-center rounded-lg border transition-colors duration-150 ease-out',
            interaction.press,
            interaction.focusRingPanel,
            hasDraft
              ? 'border-transparent text-accent-fg hover:bg-accent-soft dark:text-accent-fg dark:hover:bg-accent-soft'
              : 'border-transparent text-fg-disabled',
          )}
          disabled={disabled || voiceActive || !hasDraft}
          title={m.sendMessage}
          aria-label={m.sendMessage}
          onClick={onSend}
        >
          <Send className="size-4 stroke-[1.75]" />
        </button>
      )}
    </div>
  );
}

export function ComposerToolbarRow({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('flex flex-wrap items-center gap-2 px-3 py-1.5 sm:px-4 sm:py-2.5', className)}
      {...props}
    />
  );
}

export const ComposerToolbar = memo(function ComposerToolbar({
  disabled,
  sending,
  streaming,
  runBusy,
  chat: m,
  hasDraft,
  showSteeringInterrupt,
  attachmentCount,
  maxAttachments,
  onPickFiles,
  thinkingLevel,
  onThinkingChange,
  voiceActive,
  onStartVoiceInput,
  voiceConversationEnabled,
  onStartVoiceConversation,
  onSend,
  onAbort,
  onInterrupt,
  sessionModel,
  showModelSelector,
  onModelChange,
  modelDisabled,
}: ComposerToolbarProps) {
  return (
    <ComposerToolbarRow>
      <ComposerAttachButton
        disabled={disabled}
        runBusy={runBusy}
        attachmentCount={attachmentCount}
        maxAttachments={maxAttachments}
        chat={m}
        onPickFiles={onPickFiles}
      />

      <div className="ml-auto flex min-w-0 items-center gap-2">
        {showModelSelector ? (
          <ComposerModelConfigControl
            chat={m}
            sessionModel={sessionModel}
            modelDisabled={modelDisabled}
            onModelChange={onModelChange}
            thinkingLevel={thinkingLevel}
            thinkingDisabled={disabled || sending || streaming}
            onThinkingChange={onThinkingChange}
          />
        ) : null}
        <div className="flex shrink-0 items-center gap-1">
          {!voiceActive ? (
            <>
              <ComposerVoiceInputButton
                disabled={disabled}
                chat={m}
                onStart={onStartVoiceInput}
              />
              <button
                type="button"
                className={cn(
                  'inline-flex size-8 shrink-0 items-center justify-center rounded-lg border border-transparent text-fg-subtle hover:bg-surface-hover hover:text-fg',
                  interaction.transition,
                  interaction.press,
                  interaction.focusRingPanel,
                  'disabled:cursor-not-allowed disabled:opacity-50',
                )}
                disabled={disabled || !voiceConversationEnabled}
                title={m.voiceConversation}
                aria-label={m.voiceConversation}
                onClick={() => void onStartVoiceConversation()}
              >
                <AudioLines className="size-4 stroke-[1.75]" />
              </button>

            </>
          ) : null}
          <ComposerRunControl
            disabled={disabled}
            voiceActive={voiceActive}
            runBusy={runBusy}
            hasDraft={hasDraft}
            showSteeringInterrupt={showSteeringInterrupt}
            chat={m}
            onSend={onSend}
            onAbort={onAbort}
            onInterrupt={onInterrupt}
          />
        </div>
      </div>
    </ComposerToolbarRow>
  );
});
