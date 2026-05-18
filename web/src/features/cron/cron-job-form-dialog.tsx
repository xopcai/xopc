import * as Dialog from '@radix-ui/react-dialog';
import { Eye, FolderInput, RefreshCw, SquarePen, X } from 'lucide-react';

import { MarkdownEditor } from '@/components/markdown/markdown-editor';
import { MarkdownView } from '@/components/markdown/markdown-view';
import { Button } from '@/components/ui/button';
import type { ChatAgentOption } from '@/features/chat/chat-agents-api';
import { ModelSelector } from '@/features/chat/model-selector';
import { folderDisplayName } from '@/features/chat/session-working-directory-control';
import { WorkingDirectoryPickerModal } from '@/features/chat/working-directory-picker-modal';
import type { ChannelStatus, SessionChatId } from '@/features/cron/cron-api';
import { CronSchedulePicker } from '@/features/cron/cron-schedule-form';
import { formatRecipientOptionLabel } from '@/features/cron/cron-utils';
import {
  cronRecipientSelectClass,
  inputClassName,
  selectClassName,
} from '@/features/cron/cron-page-lib';
import { agentListDisplayName } from '@/features/settings/agents/agent-display-names';
import type { MessageBundle } from '@/i18n/messages';
import { cn } from '@/lib/cn';
import { interaction } from '@/lib/interaction';

type CronCopy = MessageBundle['cron'];

export type CronJobFormDialogProps = {
  open: boolean;
  onRequestClose: () => void;
  c: CronCopy;
  chatM: MessageBundle['chat'];
  agentsMessages: MessageBundle['agentsSettings'];
  isDark: boolean;
  channels: ChannelStatus[];
  sessionChatIds: SessionChatId[];
  cronAgentSelectOptions: ChatAgentOption[];
  hasElectronFolderPicker: boolean;
  openNativeFolderPicker: () => Promise<string | null>;
  applyWorkingDirectory: (path: string) => Promise<void>;
  wdModalOpen: boolean;
  onWdModalOpenChange: (open: boolean) => void;
  defaultModelResolver: () => string;
  formMode: 'add' | 'edit';
  formJobId: string | null;
  formName: string;
  onFormNameChange: (v: string) => void;
  formSchedule: string;
  onFormScheduleChange: (v: string) => void;
  formSubmitting: boolean;
  formSessionTarget: 'main' | 'isolated';
  onFormSessionTargetChange: (
    target: 'main' | 'isolated',
    defaultModelFallback: () => string,
    currentModel: string,
  ) => void;
  formAgentLocalOnly: boolean;
  onFormAgentLocalOnlyChange: (v: boolean) => void;
  formModel: string;
  onFormModelUserChange: (id: string) => void;
  formAgentId: string;
  onFormAgentIdChange: (v: string) => void;
  formWorkingDirectory: string;
  onFormWorkingDirectoryChange: (v: string) => void;
  formChannel: string;
  onFormChannelChange: (channel: string) => void;
  formChatId: string;
  onFormChatIdChange: (v: string) => void;
  formMessage: string;
  onFormMessageChange: (v: string) => void;
  formMessageMdMode: 'edit' | 'preview';
  onSetMessageMdMode: (mode: 'edit' | 'preview') => void;
  messageEditorNonce: number;
  needsDeliveryChat: boolean;
  showChannelPicker: boolean;
  canSubmit: boolean;
  onSubmit: () => void;
  onRefreshRecipients: () => void;
};

export function CronJobFormDialog(props: CronJobFormDialogProps) {
  const {
    open,
    onRequestClose,
    c,
    chatM,
    agentsMessages,
    isDark,
    channels,
    sessionChatIds,
    cronAgentSelectOptions,
    hasElectronFolderPicker,
    openNativeFolderPicker,
    applyWorkingDirectory,
    wdModalOpen,
    onWdModalOpenChange,
    defaultModelResolver,
    formMode,
    formJobId,
    formName,
    onFormNameChange,
    formSchedule,
    onFormScheduleChange,
    formSubmitting,
    formSessionTarget,
    onFormSessionTargetChange,
    formAgentLocalOnly,
    onFormAgentLocalOnlyChange,
    formModel,
    onFormModelUserChange,
    formAgentId,
    onFormAgentIdChange,
    formWorkingDirectory,
    onFormWorkingDirectoryChange,
    formChannel,
    onFormChannelChange,
    formChatId,
    onFormChatIdChange,
    formMessage,
    onFormMessageChange,
    formMessageMdMode,
    onSetMessageMdMode,
    messageEditorNonce,
    needsDeliveryChat,
    showChannelPicker,
    canSubmit,
    onSubmit,
    onRefreshRecipients,
  } = props;

  return (
    <>
      <Dialog.Root open={open} onOpenChange={(o) => !o && onRequestClose()}>
        <Dialog.Portal>
          <Dialog.Overlay className="xopc-dialog-overlay fixed inset-0 z-[60] bg-scrim" />
          <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 pointer-events-none">
            <Dialog.Content
              className="xopc-dialog-content-pane pointer-events-auto relative flex max-h-[min(90vh,800px)] w-full max-w-md flex-col rounded-xl border border-edge bg-surface-panel shadow-popover outline-none sm:max-w-lg lg:max-w-xl dark:border-edge"
              onOpenAutoFocus={(e) => e.preventDefault()}
            >
              <div className="flex shrink-0 items-center justify-between gap-2 border-b border-edge px-4 py-3">
                <Dialog.Title className="text-base font-semibold text-fg">
                  {formMode === 'edit' ? c.editJob : c.addJob}
                </Dialog.Title>
                <Dialog.Close asChild>
                  <Button type="button" variant="ghost" className="size-9 shrink-0 p-0" aria-label={c.close}>
                    <X className="size-5" strokeWidth={1.75} />
                  </Button>
                </Dialog.Close>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
                <div className="flex flex-col gap-3">
                  <label className="flex flex-col gap-1">
                    <span className="text-xs font-medium text-fg-muted">{c.name}</span>
                    <input
                      type="text"
                      className={inputClassName()}
                      value={formName}
                      onChange={(e) => onFormNameChange(e.target.value)}
                      placeholder={c.namePlaceholder}
                    />
                  </label>
                  <CronSchedulePicker
                    value={formSchedule}
                    onChange={onFormScheduleChange}
                    disabled={formSubmitting}
                    labels={c.schedulePicker}
                  />
                  <label className="flex flex-col gap-1">
                    <span className="text-xs font-medium text-fg-muted">{c.mode}</span>
                    <select
                      className={selectClassName()}
                      value={formSessionTarget}
                      onChange={(e) => {
                        const v = e.target.value as 'main' | 'isolated';
                        onFormSessionTargetChange(v, defaultModelResolver, formModel.trim());
                      }}
                    >
                      <option value="main">{c.modeDirectOption}</option>
                      <option value="isolated">{c.modeAgentOption}</option>
                    </select>
                    <p className="text-xs text-fg-muted">
                      {formSessionTarget === 'main' ? c.modeDirect : c.modeAgent}
                    </p>
                  </label>
                  {formSessionTarget === 'isolated' ? (
                    <>
                      <div className="flex flex-col gap-1">
                        <span className="text-xs font-medium text-fg-muted">{c.model}</span>
                        <ModelSelector
                          value={formModel}
                          placeholder={chatM.modelPlaceholder}
                          searchPlaceholder={chatM.modelSearchPlaceholder}
                          noMatches={chatM.modelNoMatches}
                          className="w-full max-w-none min-w-0"
                          popoverContentClassName="z-[70]"
                          onChange={onFormModelUserChange}
                        />
                      </div>
                      <label className="flex flex-col gap-1">
                        <span className="text-xs font-medium text-fg-muted">{c.agentProfile}</span>
                        <select
                          className={selectClassName()}
                          value={formAgentId}
                          disabled={formSubmitting}
                          onChange={(e) => onFormAgentIdChange(e.target.value)}
                        >
                          <option value="">{c.agentProfileDefault}</option>
                          {cronAgentSelectOptions.map((ag) => (
                            <option key={ag.id} value={ag.id}>
                              {`${ag.id} — ${agentListDisplayName(ag, agentsMessages)}`}
                            </option>
                          ))}
                        </select>
                        <p className="text-xs text-fg-muted">{c.agentProfileHint}</p>
                      </label>
                      <div className="flex flex-col gap-1">
                        <span className="text-xs font-medium text-fg-muted">{c.workingDirectoryLabel}</span>
                        <div className="flex flex-wrap items-center gap-2">
                          <button
                            type="button"
                            disabled={formSubmitting}
                            className={cn(
                              'inline-flex min-h-8 max-w-[min(16rem,48vw)] min-w-0 shrink-0 items-center gap-1 rounded-lg px-2 py-1 text-xs',
                              'border border-edge-subtle/80 bg-surface-hover/40 dark:border-edge-subtle',
                              interaction.transition,
                              interaction.focusRingPanel,
                              'cursor-pointer hover:bg-surface-hover/70 dark:hover:bg-surface-hover/50',
                              formSubmitting && 'cursor-not-allowed opacity-60',
                            )}
                            title={
                              formWorkingDirectory.trim()
                                ? `${formWorkingDirectory.trim()}\n${chatM.workingDirectory.chooseFolder}`
                                : `${c.workingDirectoryHint}\n${chatM.workingDirectory.selectWorkingDirectory}`
                            }
                            onClick={(e) => {
                              e.stopPropagation();
                              if (formSubmitting) return;
                              if (hasElectronFolderPicker) {
                                void (async () => {
                                  const picked = await openNativeFolderPicker();
                                  if (picked) void applyWorkingDirectory(picked);
                                })();
                              } else {
                                onWdModalOpenChange(true);
                              }
                            }}
                          >
                            <FolderInput className="size-3.5 shrink-0 text-fg-muted" aria-hidden />
                            <span className="min-w-0 truncate text-left font-medium text-fg">
                              {formWorkingDirectory.trim()
                                ? folderDisplayName(formWorkingDirectory.trim())
                                : chatM.workingDirectory.notSet}
                            </span>
                          </button>
                          {formWorkingDirectory.trim() ? (
                            <button
                              type="button"
                              disabled={formSubmitting}
                              className="text-xs font-medium text-accent hover:underline disabled:opacity-50"
                              onClick={() => onFormWorkingDirectoryChange('')}
                            >
                              {c.workingDirectoryReset}
                            </button>
                          ) : null}
                        </div>
                        <p className="text-xs text-fg-muted">{c.workingDirectoryHint}</p>
                      </div>
                      <label className="flex cursor-pointer items-start gap-2 rounded-md bg-surface-hover/45 px-3 py-2 dark:bg-surface-hover/30">
                        <input
                          type="checkbox"
                          className={cn('ui-checkbox', 'mt-0.5')}
                          checked={formAgentLocalOnly}
                          onChange={(e) => onFormAgentLocalOnlyChange(e.target.checked)}
                        />
                        <span>
                          <span className="text-sm font-medium text-fg">{c.agentLocalOnly}</span>
                          <p className="mt-1 text-xs text-fg-muted">{c.agentLocalOnlyHint}</p>
                        </span>
                      </label>
                    </>
                  ) : null}
                  {showChannelPicker ? (
                    <>
                      <label className="flex flex-col gap-1">
                        <span className="text-xs font-medium text-fg-muted">{c.channel}</span>
                        <select
                          className={selectClassName()}
                          value={formChannel}
                          onChange={(e) => {
                            const v = e.target.value;
                            onFormChannelChange(v);
                          }}
                        >
                          <option value="local">{c.channelLocal}</option>
                          {channels.map((ch) => (
                            <option key={ch.name} value={ch.name} disabled={!ch.enabled}>
                              {ch.name} {!ch.enabled ? '(disabled)' : ''}
                            </option>
                          ))}
                        </select>
                      </label>
                      {needsDeliveryChat ? (
                        <div className="flex flex-col gap-1">
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-xs font-medium text-fg-muted">{c.recipient}</span>
                            <Button
                              type="button"
                              variant="ghost"
                              className="h-7 gap-1 px-2 text-xs"
                              title={c.refreshRecipientHint}
                              onClick={() => void onRefreshRecipients()}
                            >
                              <RefreshCw className="size-3.5" strokeWidth={1.75} />
                              {c.refreshList}
                            </Button>
                          </div>
                          <div className="flex flex-col gap-2 sm:flex-row sm:items-stretch sm:gap-2">
                            <input
                              type="text"
                              className={cn(inputClassName(), 'min-w-0 w-full sm:flex-1')}
                              value={formChatId}
                              onChange={(e) => onFormChatIdChange(e.target.value)}
                              placeholder={c.recipientPlaceholder}
                            />
                            <select
                              className={cronRecipientSelectClass}
                              value={formChatId}
                              onChange={(e) => {
                                const v = e.target.value;
                                if (v) onFormChatIdChange(v);
                              }}
                            >
                              <option value="">{c.selectRecipient}</option>
                              {sessionChatIds.length > 0 ? (
                                sessionChatIds.map((item) => (
                                  <option key={`${item.channel}-${item.chatId}`} value={item.chatId}>
                                    {formatRecipientOptionLabel(item, c.lastActiveLabels)}
                                  </option>
                                ))
                              ) : (
                                <option value="" disabled>
                                  {c.noRecentChatsOption}
                                </option>
                              )}
                            </select>
                          </div>
                          <p className="text-xs text-fg-muted">
                            {sessionChatIds.length > 0 ? c.enterManuallyOrSelect : c.noRecentChats}
                          </p>
                        </div>
                      ) : null}
                    </>
                  ) : null}
                  <div className="flex flex-col gap-1">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-xs font-medium text-fg-muted">{c.message}</span>
                      <div className="inline-flex rounded-lg border border-edge bg-surface-base p-0.5 dark:border-edge">
                        <button
                          type="button"
                          className={cn(
                            'inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium',
                            formMessageMdMode === 'edit'
                              ? 'bg-accent-soft text-accent-fg'
                              : 'text-fg-muted hover:bg-surface-hover',
                          )}
                          onClick={() => onSetMessageMdMode('edit')}
                        >
                          <SquarePen className="size-3.5 shrink-0" strokeWidth={1.75} aria-hidden />
                          {c.messageEdit}
                        </button>
                        <button
                          type="button"
                          className={cn(
                            'inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium',
                            formMessageMdMode === 'preview'
                              ? 'bg-accent-soft text-accent-fg'
                              : 'text-fg-muted hover:bg-surface-hover',
                          )}
                          onClick={() => onSetMessageMdMode('preview')}
                        >
                          <Eye className="size-3.5 shrink-0" strokeWidth={1.75} aria-hidden />
                          {c.messagePreview}
                        </button>
                      </div>
                    </div>
                    <div
                      className={cn(
                        'overflow-hidden rounded-md border border-edge bg-surface-base dark:border-edge',
                        formSubmitting && 'pointer-events-none opacity-60',
                      )}
                    >
                      {formMessageMdMode === 'edit' ? (
                        <MarkdownEditor
                          key={`cron-msg-${formJobId ?? 'new'}-${messageEditorNonce}`}
                          initialContent={formMessage}
                          onChange={onFormMessageChange}
                          isDark={isDark}
                          className="h-[min(18rem,40vh)] min-h-[12rem]"
                        />
                      ) : (
                        <div className="h-[min(18rem,40vh)] min-h-[12rem] max-h-[min(24rem,50vh)] overflow-y-auto px-3 py-2">
                          {formMessage.trim() ? (
                            <MarkdownView content={formMessage} compact className="text-sm" />
                          ) : (
                            <p className="text-sm text-fg-muted">{c.messagePlaceholder}</p>
                          )}
                        </div>
                      )}
                    </div>
                    <p className="text-xs text-fg-muted">{c.messageMarkdownHint}</p>
                  </div>
                </div>
              </div>
              <div className="flex shrink-0 justify-end gap-2 border-t border-edge px-4 py-3">
                <Button type="button" variant="secondary" onClick={onRequestClose}>
                  {c.cancel}
                </Button>
                <Button type="button" variant="primary" disabled={formSubmitting || !canSubmit} onClick={onSubmit}>
                  {formSubmitting ? c.loading : formMode === 'edit' ? c.save : c.create}
                </Button>
              </div>
            </Dialog.Content>
          </div>
        </Dialog.Portal>
      </Dialog.Root>

      {!hasElectronFolderPicker ? (
        <WorkingDirectoryPickerModal
          open={wdModalOpen}
          onOpenChange={onWdModalOpenChange}
          initialAbsolutePath={formWorkingDirectory.trim() || undefined}
          onConfirm={async (p) => {
            await applyWorkingDirectory(p);
            onWdModalOpenChange(false);
          }}
          wd={chatM.workingDirectory}
        />
      ) : null}
    </>
  );
}
