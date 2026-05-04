import { Ban, File as FileIcon, Mic, Send, Sparkles, Square } from 'lucide-react';
import { memo } from 'react';

import { ModelSelector } from '@/features/chat/model-selector';
import { SessionWorkingDirectoryControl } from '@/features/chat/session-working-directory-control';
import type { SessionManager } from '@/features/chat/session-manager';
import type { ThinkingLevel } from '@/features/chat/composer.types';
import { interpolate } from '@/features/chat/composer.types';
import { cn } from '@/lib/cn';
import { interaction } from '@/lib/interaction';
import type { MessageBundle } from '@/i18n/messages';

function thinkingIcon(level: ThinkingLevel) {
  return level === 'off' ? Ban : Sparkles;
}

export interface ComposerToolbarProps {
  sessionKey: string | null;
  sessionManager: SessionManager;
  disabled: boolean;
  sending: boolean;
  streaming: boolean;
  canSelectWorkingDirectory: boolean;
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
  showThinkingSelector: boolean;
  onThinkingChange: (level: string) => void;

  voiceRecording: boolean;
  onToggleVoice: () => void;

  onSend: () => void;
  onAbort: () => void;
  onInterrupt?: () => void;

  sessionModel: string;
  showModelSelector: boolean;
  onModelChange: (modelId: string) => void;
  modelDisabled: boolean;
}

export const ComposerToolbar = memo(function ComposerToolbar({
  sessionKey,
  sessionManager,
  disabled,
  sending,
  streaming,
  canSelectWorkingDirectory,
  runBusy,
  chat: m,
  hasDraft,
  showSteeringInterrupt,
  attachmentCount,
  maxAttachments,
  onPickFiles,
  thinkingLevel,
  showThinkingSelector,
  onThinkingChange,
  voiceRecording,
  onToggleVoice,
  onSend,
  onAbort,
  onInterrupt,
  sessionModel,
  showModelSelector,
  onModelChange,
  modelDisabled,
}: ComposerToolbarProps) {
  const ThinkingIcon = thinkingIcon(thinkingLevel as ThinkingLevel);

  return (
    <div
      className={cn(
        'flex flex-wrap items-center gap-2 border-t border-edge-subtle/90 px-4 py-2.5 dark:border-edge-subtle',
      )}
    >
      <SessionWorkingDirectoryControl
        sessionKey={sessionKey}
        sessionMgr={sessionManager}
        canSelectWorkingDirectory={canSelectWorkingDirectory}
        disabled={disabled || runBusy}
      />
      <button
        type="button"
        className={cn(
          'inline-flex size-8 shrink-0 items-center justify-center rounded-lg bg-surface-hover/70 text-fg-subtle hover:bg-surface-hover hover:text-fg dark:bg-surface-hover/50',
          interaction.transition,
          interaction.press,
          interaction.focusRingPanel,
          'disabled:opacity-50 disabled:cursor-not-allowed',
        )}
        disabled={attachmentCount >= maxAttachments || disabled || runBusy}
        title={
          attachmentCount >= maxAttachments
            ? interpolate(m.maxAttachmentsReached, { max: maxAttachments })
            : `${m.attachFile} (${attachmentCount}/${maxAttachments})`
        }
        onClick={onPickFiles}
      >
        <FileIcon className="h-4 w-4" />
      </button>

      {showThinkingSelector ? (
        <div
          className="inline-flex min-h-8 items-center gap-1 rounded-full bg-surface-hover px-2.5 py-1 text-xs dark:bg-surface-hover/80"
          title={`${m.thinkingLevelLabel}: ${m.thinkingLevels[thinkingLevel as ThinkingLevel] ?? thinkingLevel}`}
        >
          <ThinkingIcon className="h-3.5 w-3.5 shrink-0 text-accent-fg" aria-hidden />
          <select
            className="max-w-[min(6.5rem,30vw)] cursor-pointer appearance-none bg-transparent pl-0 pr-0 text-[0.8125rem] font-medium text-fg focus:outline-none"
            value={thinkingLevel}
            disabled={disabled || (sending && !streaming)}
            onChange={(e) => onThinkingChange(e.target.value)}
          >
            {(Object.keys(m.thinkingLevels) as ThinkingLevel[]).map((lvl) => (
              <option key={lvl} value={lvl}>
                {m.thinkingLevels[lvl]}
              </option>
            ))}
          </select>
        </div>
      ) : null}

      <div className="ml-auto flex min-w-0 items-center gap-2">
        {showModelSelector ? (
          <div className="min-w-0 w-fit max-w-[min(20rem,calc(100vw-10rem))] shrink-0">
            <ModelSelector
              value={sessionModel}
              disabled={modelDisabled}
              placeholder={m.modelPlaceholder}
              searchPlaceholder={m.modelSearchPlaceholder}
              noMatches={m.modelNoMatches}
              compact
              showProviderInTrigger={false}
              contentSide="top"
              contentAlign="end"
              showProviderSettingsFooter
              onChange={onModelChange}
            />
          </div>
        ) : null}
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            className={cn(
              'inline-flex size-8 shrink-0 items-center justify-center rounded-lg border border-transparent',
              interaction.transition,
              interaction.press,
              interaction.focusRingPanel,
              voiceRecording
                ? 'bg-red-500/20 text-red-600 dark:bg-red-500/25 dark:text-red-400'
                : 'text-fg-subtle hover:bg-surface-hover hover:text-fg',
              'disabled:opacity-50 disabled:cursor-not-allowed',
            )}
            disabled={disabled || runBusy || attachmentCount >= maxAttachments}
            title={voiceRecording ? m.voiceRecordingStop : m.voiceRecording}
            aria-label={voiceRecording ? m.voiceRecordingStop : m.voiceRecording}
            onClick={() => void onToggleVoice()}
          >
            <Mic className={cn('h-4 w-4 stroke-[1.75]', voiceRecording && 'animate-pulse')} />
          </button>

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
                  <Send className="h-4 w-4 stroke-[1.75]" />
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
                <Square className="h-4 w-4 stroke-[1.75]" />
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
              disabled={disabled || !hasDraft}
              title={m.sendMessage}
              aria-label={m.sendMessage}
              onClick={onSend}
            >
              <Send className="h-4 w-4 stroke-[1.75]" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
});
