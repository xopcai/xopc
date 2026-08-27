import { Mic, Plus, Send, Square } from 'lucide-react';
import { memo } from 'react';

import { ComposerModelConfigControl } from '@/features/chat/model/composer-model-config-control';
import type { VoiceReadiness } from '@/features/chat/composer/voice-transcribe-api';
import { interpolate } from '@/features/chat/composer/composer.types';
import { cn } from '@/lib/cn';
import { interaction } from '@/lib/interaction';
import type { MessageBundle } from '@/i18n/messages';
import { shortcutDisplayKeys } from '@/stores/quick-capture-shortcut-store';
import { useVoiceInputShortcutStore } from '@/stores/voice-input-shortcut-store';

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
  modelSupportsThinking: boolean;
  onThinkingChange: (level: string) => void;

  voiceActive: boolean;
  voiceReadiness: VoiceReadiness;
  onStartVoiceInput: () => void;

  onSend: () => void;
  onAbort: () => void;
  onInterrupt?: () => void;

  sessionModel: string;
  showModelSelector: boolean;
  onModelChange: (modelId: string) => void;
  modelDisabled: boolean;
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
  modelSupportsThinking,
  onThinkingChange,
  voiceActive,
  voiceReadiness,
  onStartVoiceInput,
  onSend,
  onAbort,
  onInterrupt,
  sessionModel,
  showModelSelector,
  onModelChange,
  modelDisabled,
}: ComposerToolbarProps) {
  const voiceShortcut = useVoiceInputShortcutStore((s) => s.shortcut);
  const attachmentsFull = attachmentCount >= maxAttachments;
  const attachTitle = attachmentsFull
    ? interpolate(m.maxAttachmentsReached, { max: maxAttachments })
    : `${m.attachFile} (${attachmentCount}/${maxAttachments})`;
  const voiceActionTitle = voiceReadiness.state === 'preparing'
    ? m.voicePreparing
    : voiceReadiness.state === 'error' || voiceReadiness.state === 'needs_download'
      ? m.voiceNeedsPreparation
      : m.voiceInput;
  const voiceTitle = `${voiceActionTitle} (${shortcutDisplayKeys(voiceShortcut).join('+')})`;

  return (
    <div
      className={cn(
        'flex flex-wrap items-center gap-2 border-t border-edge-subtle/90 px-4 py-2.5 dark:border-edge-subtle',
      )}
    >
      <button
        type="button"
        className={cn(
          'inline-flex size-8 shrink-0 items-center justify-center rounded-lg bg-surface-hover/70 text-fg-subtle hover:bg-surface-hover hover:text-fg dark:bg-surface-hover/50',
          interaction.transition,
          interaction.press,
          interaction.focusRingPanel,
          'disabled:cursor-not-allowed disabled:opacity-50',
        )}
        disabled={attachmentsFull || disabled || runBusy}
        title={attachTitle}
        aria-label={attachTitle}
        onClick={onPickFiles}
      >
        <Plus className="size-4" />
      </button>

      <div className="ml-auto flex min-w-0 items-center gap-2">
        {showModelSelector ? (
          <ComposerModelConfigControl
            chat={m}
            sessionModel={sessionModel}
            modelDisabled={modelDisabled}
            onModelChange={onModelChange}
            thinkingLevel={thinkingLevel}
            modelSupportsThinking={modelSupportsThinking}
            thinkingDisabled={disabled || (sending && !streaming)}
            onThinkingChange={onThinkingChange}
          />
        ) : null}
        <div className="flex shrink-0 items-center gap-1">
          {!voiceActive ? (
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
              title={voiceTitle}
              aria-label={voiceTitle}
              onClick={() => void onStartVoiceInput()}
            >
              <Mic className="size-4 stroke-[1.75]" />
              {voiceReadiness.state === 'preparing' ? (
                <span className="absolute right-0.5 top-0.5 size-1.5 rounded-full bg-amber-500 motion-safe:animate-pulse" aria-hidden />
              ) : voiceReadiness.state === 'error' || voiceReadiness.state === 'needs_download' ? (
                <span className="absolute right-0.5 top-0.5 size-1.5 rounded-full bg-red-500" aria-hidden />
              ) : null}
            </button>
          ) : null}
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
      </div>
    </div>
  );
});
