import * as Dialog from '@radix-ui/react-dialog';
import { Eye, RefreshCw, SquarePen, X } from 'lucide-react';
import {
  useCallback,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';

import { MarkdownEditor } from '@/components/markdown/markdown-editor';
import { MarkdownView } from '@/components/markdown/markdown-view';
import { Button } from '@/components/ui/button';
import { AiTextAssistButton } from '@/features/ai-assist/ai-text-assist-button';
import type { ChatAgentOption } from '@/features/chat/agent-selection/chat-agents-api';
import { ModelSelector } from '@/features/chat/model/model-selector';
import { DirectoryPickerField } from '@/features/fs/directory-picker-field';
import type { ChannelStatus, CronSchedule, SessionChatId } from '@/features/cron/cron-api';
import { CronSchedulePicker } from '@/features/cron/cron-schedule-form';
import {
  cronRecipientSelectClass,
  inputClassName,
  selectClassName,
} from '@/features/cron/cron-page-lib';
import { formatRecipientOptionLabel, scheduleTechnicalText } from '@/features/cron/cron-utils';
import { agentListDisplayName } from '@/features/settings/agents/agent-display-names';
import { WorkflowArgFieldsForm } from '@/features/workflows/workflow-arg-fields-form';
import type { WorkflowDefinition } from '@/features/workflows/workflow-api';
import { resolveWorkflowLocalizedCopy } from '@/features/workflows/workflow-meta-locale';
import type { MessageBundle } from '@/i18n/messages';
import { cn } from '@/lib/cn';
import { useLocaleStore } from '@/stores/locale-store';

type CronCopy = MessageBundle['cron'];

const FORM_SPLIT_MIN_PERCENT = 42;
const FORM_SPLIT_MAX_PERCENT = 68;
const FORM_SPLIT_DEFAULT_PERCENT = 56;

function clampFormSplitPercent(value: number): number {
  return Math.max(FORM_SPLIT_MIN_PERCENT, Math.min(FORM_SPLIT_MAX_PERCENT, value));
}

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
  defaultModelResolver: () => string;
  formMode: 'add' | 'edit';
  formJobId: string | null;
  formName: string;
  onFormNameChange: (v: string) => void;
  formSchedule: CronSchedule;
  onFormScheduleChange: (v: CronSchedule) => void;
  formSubmitting: boolean;
  formTaskKind: 'message' | 'workflowRun';
  onFormTaskKindChange: (v: 'message' | 'workflowRun') => void;
  workflowDefinitions: WorkflowDefinition[];
  workflowDefinitionsLoading: boolean;
  formWorkflowDefinitionId: string;
  onFormWorkflowDefinitionIdChange: (v: string) => void;
  formWorkflowGoal: string;
  onFormWorkflowGoalChange: (v: string) => void;
  formWorkflowArgValues: Record<string, string>;
  onFormWorkflowArgValuesChange: (v: Record<string, string>) => void;
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

function FormPanel({
  title,
  children,
  className,
}: {
  title?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn('rounded-2xl border border-edge bg-surface-base/35 p-4', className)}>
      {title ? <h3 className="mb-3 text-sm font-semibold text-fg">{title}</h3> : null}
      <div className="flex flex-col gap-3">{children}</div>
    </section>
  );
}

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
    defaultModelResolver,
    formMode,
    formJobId,
    formName,
    onFormNameChange,
    formSchedule,
    onFormScheduleChange,
    formSubmitting,
    formTaskKind,
    onFormTaskKindChange,
    workflowDefinitions,
    workflowDefinitionsLoading,
    formWorkflowDefinitionId,
    onFormWorkflowDefinitionIdChange,
    formWorkflowGoal,
    onFormWorkflowGoalChange,
    formWorkflowArgValues,
    onFormWorkflowArgValuesChange,
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

  const language = useLocaleStore((s) => s.language);
  const [splitPercent, setSplitPercent] = useState(FORM_SPLIT_DEFAULT_PERCENT);
  const [splitResizing, setSplitResizing] = useState(false);
  const [aiMessageEditorNonce, setAiMessageEditorNonce] = useState(0);
  const splitContainerRef = useRef<HTMLDivElement | null>(null);
  const selectedWorkflow = workflowDefinitions.find(
    (definition) => definition.id === formWorkflowDefinitionId.trim(),
  );
  const selectedWorkflowCopy = selectedWorkflow
    ? resolveWorkflowLocalizedCopy(selectedWorkflow, language)
    : null;
  const intervalMinutes =
    formSchedule.kind === 'every' ? Math.max(1, Math.round(formSchedule.everyMs / 60000)) : 60;
  const atLocalValue =
    formSchedule.kind === 'at' && formSchedule.at
      ? new Date(formSchedule.at).toISOString().slice(0, 16)
      : '';

  const onSplitResizePointerDown = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const container = splitContainerRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const el = e.currentTarget;
    const pid = e.pointerId;
    el.setPointerCapture(pid);
    setSplitResizing(true);

    const updateFromClientX = (clientX: number) => {
      const rawPercent = ((clientX - rect.left) / rect.width) * 100;
      setSplitPercent(clampFormSplitPercent(rawPercent));
    };

    updateFromClientX(e.clientX);

    const onMove = (ev: PointerEvent) => {
      updateFromClientX(ev.clientX);
    };
    const onDone = () => {
      try {
        el.releasePointerCapture(pid);
      } catch {
        /* ignore */
      }
      setSplitResizing(false);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onDone);
      window.removeEventListener('pointercancel', onDone);
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onDone);
    window.addEventListener('pointercancel', onDone);
  }, []);

  const onSplitResizeKeyDown = useCallback((e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'ArrowLeft') {
      e.preventDefault();
      setSplitPercent((value) => clampFormSplitPercent(value - 4));
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      setSplitPercent((value) => clampFormSplitPercent(value + 4));
    } else if (e.key === 'Home') {
      e.preventDefault();
      setSplitPercent(FORM_SPLIT_MIN_PERCENT);
    } else if (e.key === 'End') {
      e.preventDefault();
      setSplitPercent(FORM_SPLIT_MAX_PERCENT);
    }
  }, []);

  const agentProfileField = (
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
            {`${ag.id} - ${agentListDisplayName(ag, agentsMessages)}`}
          </option>
        ))}
      </select>
      <p className="text-xs text-fg-muted">{c.agentProfileHint}</p>
    </label>
  );

  const deliveryFields = showChannelPicker ? (
    <>
      <label className="flex flex-col gap-1">
        <span className="text-xs font-medium text-fg-muted">{c.channel}</span>
        <select
          className={selectClassName()}
          value={formChannel}
          onChange={(e) => onFormChannelChange(e.target.value)}
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
            {formTaskKind === 'workflowRun'
              ? c.workflowDeliveryHint
              : sessionChatIds.length > 0
                ? c.enterManuallyOrSelect
                : c.noRecentChats}
          </p>
        </div>
      ) : null}
    </>
  ) : null;

  const scheduleFields = (
    <>
      <label className="flex flex-col gap-1">
        <span className="text-xs font-medium text-fg-muted">{c.schedule}</span>
        <select
          className={selectClassName()}
          value={formSchedule.kind}
          disabled={formSubmitting}
          onChange={(e) => {
            const kind = e.target.value as CronSchedule['kind'];
            if (kind === 'cron') onFormScheduleChange({ kind: 'cron', expr: '*/5 * * * *' });
            else if (kind === 'at') {
              onFormScheduleChange({ kind: 'at', at: new Date(Date.now() + 3600000).toISOString() });
            } else {
              onFormScheduleChange({ kind: 'every', everyMs: 60 * 60000 });
            }
          }}
        >
          <option value="cron">Cron</option>
          <option value="at">One-time</option>
          <option value="every">Interval</option>
        </select>
      </label>
      {formSchedule.kind === 'cron' ? (
        <CronSchedulePicker
          value={formSchedule.expr}
          onChange={(expr) => onFormScheduleChange({ ...formSchedule, expr })}
          disabled={formSubmitting}
          labels={c.schedulePicker}
        />
      ) : formSchedule.kind === 'at' ? (
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-fg-muted">{c.nextRun}</span>
          <input
            type="datetime-local"
            className={inputClassName(formSubmitting)}
            value={atLocalValue}
            disabled={formSubmitting}
            onChange={(e) => {
              const ms = new Date(e.target.value).getTime();
              onFormScheduleChange({
                kind: 'at',
                at: Number.isFinite(ms) ? new Date(ms).toISOString() : '',
              });
            }}
          />
        </label>
      ) : (
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-fg-muted">
            {c.scheduleBadge.everyNMinutes.replace('{{n}}', '')}
          </span>
          <input
            type="number"
            min={1}
            step={1}
            className={inputClassName(formSubmitting)}
            value={intervalMinutes}
            disabled={formSubmitting}
            onChange={(e) => {
              const minutes = Number.parseInt(e.target.value, 10);
              onFormScheduleChange({
                kind: 'every',
                everyMs: Math.max(1, Number.isFinite(minutes) ? minutes : 1) * 60000,
              });
            }}
          />
        </label>
      )}
    </>
  );

  const messageEditor = (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs font-medium text-fg-muted">{c.message}</span>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <AiTextAssistButton
            value={formMessage}
            onApply={(next) => {
              onFormMessageChange(next);
              setAiMessageEditorNonce((value) => value + 1);
              onSetMessageMdMode('edit');
            }}
            fieldId="cron.message"
            fieldLabel={c.message}
            scenario="cron.message"
            format="markdown"
            locale={language}
            context={{
              page: 'cron',
              taskKind: formTaskKind,
              cronName: formName,
              scheduleSummary: scheduleTechnicalText(formSchedule),
              sessionTarget: formSessionTarget,
              deliveryChannel: formChannel,
            }}
            disabled={formSubmitting}
          />
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
      </div>
      <div
        className={cn(
          'overflow-hidden rounded-md border border-edge bg-surface-base dark:border-edge',
          formSubmitting && 'pointer-events-none opacity-60',
        )}
      >
        {formMessageMdMode === 'edit' ? (
          <MarkdownEditor
            key={`cron-msg-${formJobId ?? 'new'}-${messageEditorNonce}-${aiMessageEditorNonce}`}
            initialContent={formMessage}
            onChange={onFormMessageChange}
            isDark={isDark}
            className="h-[min(22rem,44vh)] min-h-[16rem]"
          />
        ) : (
          <div className="h-[min(22rem,44vh)] min-h-[16rem] max-h-[min(26rem,52vh)] overflow-y-auto px-3 py-2">
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
  );

  return (
    <Dialog.Root open={open} onOpenChange={(o) => !o && onRequestClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="xopc-dialog-overlay fixed inset-0 z-[60] bg-scrim" />
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 pointer-events-none">
          <Dialog.Content
            className="xopc-dialog-content-pane pointer-events-auto relative flex h-[min(86vh,46rem)] w-full max-w-6xl flex-col overflow-hidden rounded-2xl border border-edge bg-surface-panel shadow-popover outline-none dark:border-edge"
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

            <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 lg:overflow-hidden">
              <div
                ref={splitContainerRef}
                className={cn(
                  'grid min-h-full grid-cols-1 gap-4 lg:h-full lg:min-h-0 lg:[grid-template-columns:minmax(0,var(--cron-form-primary-pane))_0.75rem_minmax(22rem,1fr)] lg:gap-0',
                  !splitResizing && 'lg:transition-[grid-template-columns] lg:duration-200 lg:ease-out',
                )}
                style={
                  {
                    '--cron-form-primary-pane': `${splitPercent}%`,
                  } as CSSProperties
                }
              >
                <div className="lg:min-h-0 lg:overflow-y-auto">
                  <div className="flex flex-col gap-4">
                    <FormPanel>
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
                      {scheduleFields}
                      <label className="flex flex-col gap-1">
                        <span className="text-xs font-medium text-fg-muted">{c.taskKind}</span>
                        <select
                          className={selectClassName()}
                          value={formTaskKind}
                          disabled={formSubmitting}
                          onChange={(e) => onFormTaskKindChange(e.target.value as 'message' | 'workflowRun')}
                        >
                          <option value="message">{c.taskKindMessage}</option>
                          <option value="workflowRun">{c.taskKindWorkflowRun}</option>
                        </select>
                      </label>
                    </FormPanel>

                    {formTaskKind === 'workflowRun' ? (
                      <FormPanel title={c.workflowDefinition}>
                        <label className="flex flex-col gap-1">
                          <span className="text-xs font-medium text-fg-muted">{c.workflowDefinition}</span>
                          <select
                            className={selectClassName()}
                            value={formWorkflowDefinitionId}
                            disabled={formSubmitting || workflowDefinitionsLoading}
                            onChange={(e) => onFormWorkflowDefinitionIdChange(e.target.value)}
                          >
                            <option value="">
                              {workflowDefinitionsLoading
                                ? c.workflowDefinitionsLoading
                                : c.workflowDefinitionPlaceholder}
                            </option>
                            {formWorkflowDefinitionId.trim() &&
                            !workflowDefinitions.some((d) => d.id === formWorkflowDefinitionId.trim()) ? (
                              <option value={formWorkflowDefinitionId}>{formWorkflowDefinitionId}</option>
                            ) : null}
                            {workflowDefinitions.map((definition) => (
                              <option key={definition.id} value={definition.id}>
                                {definition.title}
                                {definition.metadata.source === 'user' ? ` (${c.workflowDefinitionCustom})` : ''}
                              </option>
                            ))}
                          </select>
                          {!workflowDefinitionsLoading && workflowDefinitions.length === 0 ? (
                            <p className="text-xs text-fg-muted">{c.workflowDefinitionsEmpty}</p>
                          ) : null}
                          {selectedWorkflowCopy ? (
                            <p className="text-xs leading-5 text-fg-muted">{selectedWorkflowCopy.description}</p>
                          ) : formWorkflowDefinitionId.trim() && !selectedWorkflow ? (
                            <p className="text-xs text-amber-700 dark:text-amber-300">
                              {c.workflowDefinitionMissing}
                            </p>
                          ) : null}
                        </label>
                        {formWorkflowDefinitionId.trim() ? (
                          <WorkflowArgFieldsForm
                            workflowName={formWorkflowDefinitionId.trim()}
                            language={language}
                            argValues={formWorkflowArgValues}
                            onArgValuesChange={onFormWorkflowArgValuesChange}
                            goal={formWorkflowGoal}
                            onGoalChange={onFormWorkflowGoalChange}
                            examplePrompts={selectedWorkflowCopy?.examplePrompts ?? []}
                            inputClassName={inputClassName()}
                            aiAssist={{
                              disabled: formSubmitting,
                              context: {
                                page: 'cron',
                                taskKind: formTaskKind,
                                cronName: formName,
                                scheduleSummary: scheduleTechnicalText(formSchedule),
                                workflowDefinitionId: formWorkflowDefinitionId.trim(),
                                workflowDescription: selectedWorkflowCopy?.description ?? '',
                              },
                            }}
                          />
                        ) : null}
                      </FormPanel>
                    ) : (
                      <FormPanel title={c.message}>{messageEditor}</FormPanel>
                    )}
                  </div>
                </div>

                <div
                  role="separator"
                  aria-orientation="vertical"
                  aria-label={c.detailResizeColumns}
                  aria-valuemin={FORM_SPLIT_MIN_PERCENT}
                  aria-valuemax={FORM_SPLIT_MAX_PERCENT}
                  aria-valuenow={Math.round(splitPercent)}
                  tabIndex={0}
                  onPointerDown={onSplitResizePointerDown}
                  onKeyDown={onSplitResizeKeyDown}
                  className={cn(
                    'group hidden h-full cursor-col-resize touch-none select-none items-stretch justify-center rounded-lg outline-none lg:flex',
                    'focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface-panel',
                  )}
                >
                  <span
                    className={cn(
                      'h-full w-px bg-edge-subtle transition-colors duration-150',
                      'group-hover:bg-edge',
                      splitResizing && 'bg-edge',
                    )}
                  />
                </div>

                <aside className="lg:min-h-0 lg:overflow-y-auto">
                  <div className="flex flex-col gap-4">
                    {formTaskKind === 'message' ? (
                      <FormPanel title={c.detailRunSettings}>
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
                            {agentProfileField}
                            <div className="flex flex-col gap-1">
                              <span className="text-xs font-medium text-fg-muted">
                                {c.workingDirectoryLabel}
                              </span>
                              <DirectoryPickerField
                                value={formWorkingDirectory}
                                onChange={onFormWorkingDirectoryChange}
                                disabled={formSubmitting}
                                wd={chatM.workingDirectory}
                                placeholder={chatM.workingDirectory.notSet}
                                maxWidthClass="max-w-[min(18rem,52vw)]"
                                clearLabel={c.workingDirectoryReset}
                                onClear={() => onFormWorkingDirectoryChange('')}
                              />
                              <p className="text-xs text-fg-muted">{c.workingDirectoryHint}</p>
                            </div>
                            <label className="flex cursor-pointer items-start gap-2 rounded-md bg-surface-hover/45 px-3 py-2 dark:bg-surface-hover/30">
                              <input
                                type="checkbox"
                                className={cn('ui-checkbox', 'mt-0.5')}
                                checked={formAgentLocalOnly}
                                onChange={(e) => onFormAgentLocalOnlyChange(e.target.checked)}
                                aria-label={c.agentLocalOnly}
                              />
                              <span>
                                <span className="text-sm font-medium text-fg">{c.agentLocalOnly}</span>
                                <p className="mt-1 text-xs text-fg-muted">{c.agentLocalOnlyHint}</p>
                              </span>
                            </label>
                          </>
                        ) : null}
                      </FormPanel>
                    ) : (
                      <FormPanel title={c.detailRunSettings}>
                        {agentProfileField}
                        <label className="flex cursor-pointer items-start gap-2 rounded-md bg-surface-hover/45 px-3 py-2 dark:bg-surface-hover/30">
                          <input
                            type="checkbox"
                            className={cn('ui-checkbox', 'mt-0.5')}
                            checked={formAgentLocalOnly}
                            onChange={(e) => onFormAgentLocalOnlyChange(e.target.checked)}
                            aria-label={c.workflowLocalOnly}
                          />
                          <span>
                            <span className="text-sm font-medium text-fg">{c.workflowLocalOnly}</span>
                            <p className="mt-1 text-xs text-fg-muted">{c.workflowLocalOnlyHint}</p>
                          </span>
                        </label>
                      </FormPanel>
                    )}

                    {deliveryFields ? <FormPanel title={c.deliveryTarget}>{deliveryFields}</FormPanel> : null}
                  </div>
                </aside>
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
  );
}
