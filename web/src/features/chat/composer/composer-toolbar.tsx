import * as Popover from '@radix-ui/react-popover';
import { Activity, Ban, File as FileIcon, Mic, Plus, Send, Sparkles, Square } from 'lucide-react';
import { memo, useState } from 'react';

import type { Message, ReasoningLevel } from '@/features/chat/messages/messages.types';
import { ModelContextRing } from '@/features/chat/model/model-context-ring';
import { ModelSelector } from '@/features/chat/model/model-selector';
import { SessionWorkingDirectoryControl } from '@/features/chat/session/session-working-directory-control';
import type { SessionManager } from '@/features/chat/session/session-manager';
import type { ThinkingLevel } from '@/features/chat/composer/composer.types';
import type { VoiceReadiness } from '@/features/chat/composer/voice-transcribe-api';
import { interpolate } from '@/features/chat/composer/composer.types';
import { cn } from '@/lib/cn';
import { interaction } from '@/lib/interaction';
import type { MessageBundle } from '@/i18n/messages';
import { Select, SelectOption } from '@/components/ui/popover-select';
import { shortcutDisplayKeys } from '@/stores/quick-capture-shortcut-store';
import { useVoiceInputShortcutStore } from '@/stores/voice-input-shortcut-store';

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
  modelSupportsThinking: boolean;
  onThinkingChange: (level: string) => void;
  reasoningLevel: ReasoningLevel;
  activityDetailDefault: ReasoningLevel;
  activityDetailOverride: ReasoningLevel | null;
  onReasoningChange: (level: ReasoningLevel | null) => void;

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
  /** For context-window ring next to the model selector. */
  contextUsageMessages: readonly Message[];
  composerDraftChars: number;
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
  modelSupportsThinking,
  onThinkingChange,
  reasoningLevel,
  activityDetailDefault,
  activityDetailOverride,
  onReasoningChange,
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
  contextUsageMessages,
  composerDraftChars,
}: ComposerToolbarProps) {
  const voiceShortcut = useVoiceInputShortcutStore((s) => s.shortcut);
  const [moreOpen, setMoreOpen] = useState(false);
  const ThinkingIcon = thinkingIcon(thinkingLevel as ThinkingLevel);
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
      <SessionWorkingDirectoryControl
        sessionKey={sessionKey}
        sessionMgr={sessionManager}
        canSelectWorkingDirectory={canSelectWorkingDirectory}
        disabled={disabled || runBusy}
      />

      <Popover.Root open={moreOpen} onOpenChange={setMoreOpen}>
        <Popover.Trigger asChild>
          <button
            type="button"
            className={cn(
              'inline-flex size-8 shrink-0 items-center justify-center rounded-lg bg-surface-hover/70 text-fg-subtle hover:bg-surface-hover hover:text-fg dark:bg-surface-hover/50',
              interaction.transition,
              interaction.press,
              interaction.focusRingPanel,
            )}
            title={m.moreActions}
            aria-label={m.moreActions}
            aria-expanded={moreOpen}
          >
            <Plus className="size-4" />
          </button>
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content
            className={cn(
              'z-50 min-w-[12rem] rounded-xl border border-edge bg-surface-panel p-1.5 shadow-popover dark:border-edge',
            )}
            side="top"
            align="start"
            sideOffset={8}
            collisionPadding={12}
            onOpenAutoFocus={(e) => e.preventDefault()}
          >
            <div className="flex flex-col gap-0.5">
              <button
                type="button"
                className={cn(
                  'flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm text-fg',
                  'hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
                  'disabled:cursor-not-allowed disabled:opacity-50',
                )}
                disabled={attachmentsFull || disabled || runBusy}
                title={attachTitle}
                onClick={() => {
                  onPickFiles();
                  setMoreOpen(false);
                }}
              >
                <FileIcon className="size-4 shrink-0 text-fg-subtle" aria-hidden />
                <span className="min-w-0 flex-1 truncate">{m.attachFile}</span>
                <span className="shrink-0 text-xs text-fg-subtle">
                  {attachmentCount}/{maxAttachments}
                </span>
              </button>

              <label
                className={cn(
                  'flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-sm text-fg',
                  'hover:bg-surface-hover',
                )}
                title={
                  modelSupportsThinking
                    ? `${m.thinkingLevelLabel}: ${m.thinkingLevels[thinkingLevel as ThinkingLevel] ?? thinkingLevel}`
                    : m.thinkingUnsupported
                }
              >
                <ThinkingIcon className="size-4 shrink-0 text-accent-fg" aria-hidden />
                <span className="shrink-0 text-fg-muted">{m.thinkingLevelLabel}</span>
                {modelSupportsThinking ? (
                  <Select
                    className="min-w-0 flex-1 cursor-pointer appearance-none rounded-md bg-surface-hover/80 px-2 py-0.5 text-sm font-medium text-fg focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                    value={thinkingLevel}
                    disabled={disabled || (sending && !streaming)}
                    onChange={(event) => onThinkingChange(event.target.value)}
                  >
                    {(Object.keys(m.thinkingLevels) as ThinkingLevel[]).map((level) => (
                      <SelectOption key={level} value={level}>
                        {m.thinkingLevels[level]}
                      </SelectOption>
                    ))}
                  </Select>
                ) : (
                  <span className="min-w-0 flex-1 truncate text-right text-xs text-fg-disabled">
                    {m.thinkingUnsupported}
                  </span>
                )}
              </label>
              <label
                className={cn(
                  'flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-sm text-fg',
                  'hover:bg-surface-hover',
                )}
                title={`${m.activityDetailLabel}: ${m.activityDetailLevels[reasoningLevel]}`}
              >
                <Activity className="size-4 shrink-0 text-fg-subtle" aria-hidden />
                <span className="shrink-0 text-fg-muted">{m.activityDetailLabel}</span>
                <Select
                  className="min-w-0 flex-1 cursor-pointer appearance-none rounded-md bg-surface-hover/80 px-2 py-0.5 text-sm font-medium text-fg focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                  value={activityDetailOverride ?? 'default'}
                  disabled={disabled}
                  onChange={(event) => onReasoningChange(
                    event.target.value === 'default'
                      ? null
                      : event.target.value as ReasoningLevel,
                  )}
                >
                  <SelectOption value="default">
                    {m.activityDetailUseDefault.replace(
                      '{{level}}',
                      m.activityDetailLevels[activityDetailDefault],
                    )}
                  </SelectOption>
                  {(Object.keys(m.activityDetailLevels) as ReasoningLevel[]).map((level) => (
                    <SelectOption key={level} value={level}>
                      {m.activityDetailLevels[level]}
                    </SelectOption>
                  ))}
                </Select>
              </label>
            </div>
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>

      <div className="ml-auto flex min-w-0 items-center gap-2">
        {showModelSelector ? (
          <div className="flex min-w-0 items-center gap-1.5">
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
            <ModelContextRing
              sessionModel={sessionModel}
              messages={contextUsageMessages}
              draftChars={composerDraftChars}
              chat={m}
              disabled={modelDisabled}
            />
          </div>
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
