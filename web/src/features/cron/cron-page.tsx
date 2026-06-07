import { useCallback, useEffect, useLayoutEffect, useMemo, useReducer, useRef } from 'react';

import { uiPatchReducer } from '@/lib/settings-form-draft';
import { useLocation } from 'react-router-dom';

import {
  addJob,
  getHistory,
  getJob,
  removeJob,
  runJob,
  toggleJob,
  updateJob,
  type CronDelivery,
  type CronJob,
  type CronJobExecution,
  type CronPayload,
} from '@/features/cron/cron-api';
import { CronConfirmActionDialog } from '@/features/cron/cron-confirm-action-dialog';
import { CronJobDetailDrawer } from '@/features/cron/cron-job-detail-drawer';
import { CronJobFormDialog } from '@/features/cron/cron-job-form-dialog';
import { CronMainToolbar } from '@/features/cron/cron-main-toolbar';
import { CronPageHeaderActions } from '@/features/cron/cron-page-header-actions';
import { CronRunHistorySection } from '@/features/cron/cron-run-history-section';
import { CronSystemTasksPanel } from '@/features/cron/cron-system-tasks-panel';
import { CronTasksPanel } from '@/features/cron/cron-tasks-panel';
import type { CronTemplateFilter } from '@/features/cron/cron-template-library';
import { CronTemplatePickerDialog } from '@/features/cron/cron-template-picker-dialog';
import { useCronJobForm } from '@/features/cron/use-cron-job-form';
import { useCronKeepAwake } from '@/features/cron/use-cron-keep-awake';
import {
  filterRunHistory,
  sortJobsByCreated,
  useCronPageData,
  type HistoryRange,
  type JobSort,
} from '@/features/cron/use-cron-page-data';
import { messages, type MessageBundle } from '@/i18n/messages';
import { useGatewayStore } from '@/stores/gateway-store';
import { useLocaleStore } from '@/stores/locale-store';
import { usePageHeaderStore } from '@/stores/page-header-store';
import { useThemeStore } from '@/stores/theme-store';

type CronPageUi = {
  mainTab: 'myTasks' | 'systemTasks' | 'history';
  jobSort: JobSort;
  historyRange: HistoryRange;
  historyJobFilter: string;
  historyStatusFilter: string;
  detailOpen: boolean;
  detailJob: CronJob | null;
  detailHistory: CronJobExecution[];
  detailLoading: boolean;
  confirmOpen: boolean;
  templatePickerOpen: boolean;
  templateCategoryFilter: CronTemplateFilter;
};

const initialCronPageUi: CronPageUi = {
  mainTab: 'myTasks',
  jobSort: 'created_desc',
  historyRange: 'day',
  historyJobFilter: '',
  historyStatusFilter: '',
  detailOpen: false,
  detailJob: null,
  detailHistory: [],
  detailLoading: false,
  confirmOpen: false,
  templatePickerOpen: false,
  templateCategoryFilter: 'all',
};

export function CronPage() {
  const language = useLocaleStore((s) => s.language);
  const m = messages(language);
  const c = m.cron;
  const chatM = m.chat;
  const token = useGatewayStore((st) => st.token);
  const hasToken = Boolean(token);
  const resolvedTheme = useThemeStore((s) => s.resolved);
  const isDark = resolvedTheme === 'dark';
  const localeTag = language === 'zh' ? 'zh-CN' : 'en-US';

  const [ui, dispatch] = useReducer(uiPatchReducer<CronPageUi>, initialCronPageUi);
  const {
    mainTab,
    jobSort,
    historyRange,
    historyJobFilter,
    historyStatusFilter,
    detailOpen,
    detailJob,
    detailHistory,
    detailLoading,
    confirmOpen,
    templatePickerOpen,
    templateCategoryFilter,
  } = ui;

  const data = useCronPageData({
    hasToken,
    failMessages: { failedToLoadJobs: c.failedToLoadJobs },
    isHistoryTab: mainTab === 'history',
  });
  const { setError } = data;

  const keepAwakeHook = useCronKeepAwake({ onUnavailable: () => setError(c.wakeLockUnavailable) });

  const defaultModelForForm = useCallback(
    () => data.defaultModel || (data.availableModels.length > 0 ? data.availableModels[0].id : ''),
    [data.defaultModel, data.availableModels],
  );

  const form = useCronJobForm({
    m,
    defaultModelForForm,
    channels: data.channels,
    chatAgents: data.chatAgents,
  });

  const confirmActionRef = useRef<'delete' | 'run' | null>(null);
  const confirmJobIdRef = useRef<string | null>(null);

  const openConfirm = useCallback((action: 'delete' | 'run', jobId: string) => {
    confirmActionRef.current = action;
    confirmJobIdRef.current = jobId;
    dispatch({ type: 'patch', patch: { confirmOpen: true } });
  }, []);

  const dismissConfirm = useCallback(() => {
    dispatch({ type: 'patch', patch: { confirmOpen: false } });
    confirmJobIdRef.current = null;
    confirmActionRef.current = null;
  }, []);

  const absorbCardClickJobIdRef = useRef<string | null>(null);

  const scheduleAbsorbNextMenuCardClick = useCallback((jobId: string) => {
    absorbCardClickJobIdRef.current = jobId;
    window.setTimeout(() => {
      if (absorbCardClickJobIdRef.current === jobId) {
        absorbCardClickJobIdRef.current = null;
      }
    }, 400);
  }, []);

  const onSelectTemplate = useCallback(
    (templateId: string) => {
      const ok = form.applyCronTemplate(templateId);
      if (ok) dispatch({ type: 'patch', patch: { templatePickerOpen: false } });
    },
    [form],
  );

  const submitForm = async () => {
    if (!form.formName.trim()) {
      setError(c.nameRequired);
      return;
    }
    if (!form.formSchedule.trim()) {
      setError(c.scheduleRequired);
      return;
    }
    if (form.formTaskKind === 'message' && !form.formMessage.trim()) {
      setError(c.scheduleRequired);
      return;
    }
    if (form.formTaskKind === 'workflowRun' && !form.formWorkflowDefinitionId.trim()) {
      setError(c.workflowDefinitionRequired);
      return;
    }
    if (form.needsDeliveryChat && !form.formChatId.trim()) {
      setError(c.chatIdRequired);
      return;
    }

    form.setFormSubmitting(true);
    setError(null);
    try {
      const message = form.formMessage.trim();
      const modelTrimmed = form.formModel.trim();
      const agentIdTrim = form.formAgentId.trim().toLowerCase();
      const workingDirectoryTrimmed = form.formWorkingDirectory.trim();
      const isWorkflowRun = form.formTaskKind === 'workflowRun';
      const isIsolatedMessage = form.formTaskKind === 'message' && form.formSessionTarget === 'isolated';
      const effectiveSessionTarget = isWorkflowRun ? 'isolated' : form.formSessionTarget;

      let delivery: CronDelivery;
      if (isWorkflowRun) {
        delivery = { mode: 'none' };
      } else if (form.formSessionTarget === 'isolated' && form.formAgentLocalOnly) {
        delivery = { mode: 'none' };
      } else if (form.formChannel === 'local') {
        delivery = { mode: 'direct', channel: 'local' };
      } else {
        delivery = { mode: 'direct', channel: form.formChannel, to: form.formChatId.trim() };
      }

      let payload: CronPayload;
      if (isWorkflowRun) {
        let workflowInputPayload: unknown = {};
        const rawInput = form.formWorkflowInputJson.trim();
        if (rawInput) {
          try {
            workflowInputPayload = JSON.parse(rawInput);
          } catch {
            setError(c.workflowInputInvalid);
            return;
          }
        }
        payload = {
          kind: 'workflowRun',
          definitionId: form.formWorkflowDefinitionId.trim(),
          inputEnvelope: { payload: workflowInputPayload },
          ...(form.formWorkflowGoal.trim() ? { goal: form.formWorkflowGoal.trim() } : {}),
          ...(agentIdTrim ? { agentId: agentIdTrim } : {}),
        };
      } else {
        payload = isIsolatedMessage
          ? {
              kind: 'agentTurn',
              message,
              ...(modelTrimmed ? { model: modelTrimmed } : {}),
            }
          : { kind: 'systemEvent', text: message };
      }

      const agentIdForEdit = effectiveSessionTarget === 'main' ? null : agentIdTrim || null;
      const jobData = {
        name: form.formName.trim(),
        schedule: form.formSchedule.trim(),
        sessionTarget: effectiveSessionTarget,
        model: isIsolatedMessage && modelTrimmed ? modelTrimmed : undefined,
        delivery,
        payload,
        ...(form.formMode === 'edit'
          ? {
              agentId: agentIdForEdit,
              workingDirectory: isIsolatedMessage ? workingDirectoryTrimmed || null : null,
            }
          : {
              ...(effectiveSessionTarget === 'isolated' && agentIdTrim ? { agentId: agentIdTrim } : {}),
              ...(isIsolatedMessage && workingDirectoryTrimmed
                ? { workingDirectory: workingDirectoryTrimmed }
                : {}),
            }),
      };

      if (form.formMode === 'edit' && form.formJobId) {
        await updateJob(form.formJobId, jobData);
      } else {
        const { schedule: cronSchedule, agentId, workingDirectory, ...rest } = jobData;
        await addJob(cronSchedule, {
          ...rest,
          ...(agentId != null ? { agentId } : {}),
          ...(workingDirectory ? { workingDirectory } : {}),
        });
      }
      form.closeForm();
      await data.loadJobs();
    } catch (e) {
      setError(e instanceof Error ? e.message : form.formMode === 'edit' ? c.failedToUpdateJob : c.failedToCreateJob);
    } finally {
      form.setFormSubmitting(false);
    }
  };

  const openDetail = async (job: CronJob) => {
    dispatch({
      type: 'patch',
      patch: { detailOpen: true, detailJob: job, detailLoading: true, detailHistory: [] },
    });
    try {
      const full = await getJob(job.id);
      if (full) {
        dispatch({
          type: 'patch',
          patch: { detailJob: full, detailHistory: await getHistory(job.id, 20) },
        });
      }
    } catch {
      /* keep partial */
    } finally {
      dispatch({ type: 'patch', patch: { detailLoading: false } });
    }
  };

  const closeDetail = useCallback(() => {
    dispatch({ type: 'patch', patch: { detailOpen: false, detailJob: null } });
  }, []);

  const openTemplatePicker = useCallback(() => {
    dispatch({ type: 'patch', patch: { templateCategoryFilter: 'all', templatePickerOpen: true } });
  }, []);

  const onToggle = async (job: CronJob, enabled: boolean) => {
    try {
      await toggleJob(job.id, enabled);
      await Promise.all([data.loadJobs(), data.loadAux()]);
    } catch (e) {
      setError(e instanceof Error ? e.message : c.failedToToggleJob);
    }
  };

  const runConfirm = async () => {
    const id = confirmJobIdRef.current;
    const action = confirmActionRef.current;
    if (!id || !action) return;
    dismissConfirm();
    try {
      if (action === 'run') {
        await runJob(id);
      } else {
        await removeJob(id);
        if (detailJob?.id === id) {
          dispatch({ type: 'patch', patch: { detailOpen: false, detailJob: null } });
        }
      }
      await Promise.all([data.loadJobs(), data.loadAux(), data.loadRunHistoryOnly()]);
    } catch (e) {
      setError(e instanceof Error ? e.message : c.actionFailed);
    }
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (form.formOpen) form.closeForm();
      else if (detailOpen) {
        dispatch({ type: 'patch', patch: { detailOpen: false, detailJob: null } });
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [form, detailOpen]);

  const statusLabels = useMemo(
    () => ({
      running: c.execStatusRunning,
      success: c.execStatusSuccess,
      failed: c.execStatusFailed,
      cancelled: c.execStatusCancelled,
    }),
    [c.execStatusCancelled, c.execStatusFailed, c.execStatusRunning, c.execStatusSuccess],
  );

  const sortedUserJobs = useMemo(() => sortJobsByCreated(data.userCronJobs, jobSort), [data.userCronJobs, jobSort]);
  const sortedSystemJobs = useMemo(() => sortJobsByCreated(data.systemCronJobs, jobSort), [data.systemCronJobs, jobSort]);

  const filteredRunHistory = useMemo(
    () => filterRunHistory(data.runHistory, historyRange, historyJobFilter, historyStatusFilter),
    [data.runHistory, historyRange, historyJobFilter, historyStatusFilter],
  );

  const scheduleBadgeLabels = c.scheduleBadge;
  const { pathname } = useLocation();
  const inSettingsShell = pathname.startsWith('/settings/');

  if (!hasToken) {
    return (
      <>
        <CronPageHeaderRegistration
          hasToken={hasToken}
          c={c}
          loading={data.loading}
          runHistoryLoading={data.runHistoryLoading}
          onRefresh={data.refreshAll}
          onOpenTemplatePicker={openTemplatePicker}
          onAddJob={() => form.openForm()}
        />
        <div className="mx-auto w-full max-w-app-main px-4 py-16 text-center text-sm text-fg-muted sm:px-8">
          {c.needToken}
        </div>
      </>
    );
  }

  return (
    <>
      <CronPageHeaderRegistration
        hasToken={hasToken}
        c={c}
        loading={data.loading}
        runHistoryLoading={data.runHistoryLoading}
        onRefresh={data.refreshAll}
        onOpenTemplatePicker={openTemplatePicker}
        onAddJob={() => form.openForm()}
      />
      <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-surface-panel">
      <div className="mx-auto flex w-full max-w-app-main flex-col gap-6 px-4 py-6 sm:px-8">
        {data.error ? (
          <div
            className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-200"
            role="alert"
          >
            {data.error}
          </div>
        ) : null}

        <header className="flex flex-col gap-4">
          <div className="min-w-0">
            <h1 className="text-xl font-semibold tracking-tight text-fg">{c.title}</h1>
            <p className="mt-1 max-w-2xl text-sm text-fg-muted">{c.subtitle}</p>
          </div>
        </header>

        {inSettingsShell ? (
          <div className="flex flex-wrap items-center justify-end gap-2 border-b border-edge-subtle pb-3 dark:border-edge-subtle">
            <CronPageHeaderActions
              c={c}
              loading={data.loading}
              runHistoryLoading={data.runHistoryLoading}
              onRefresh={data.refreshAll}
              onOpenTemplatePicker={openTemplatePicker}
              onAddJob={() => form.openForm()}
            />
          </div>
        ) : null}

        <CronMainToolbar
          c={c}
          mainTab={mainTab}
          onMainTabChange={(tab) => dispatch({ type: 'patch', patch: { mainTab: tab } })}
          jobSort={jobSort}
          onJobSortChange={(sort) => dispatch({ type: 'patch', patch: { jobSort: sort } })}
          historyRange={historyRange}
          onHistoryRangeChange={(range) => dispatch({ type: 'patch', patch: { historyRange: range } })}
          historyJobFilter={historyJobFilter}
          onHistoryJobFilterChange={(filter) =>
            dispatch({ type: 'patch', patch: { historyJobFilter: filter } })
          }
          historyStatusFilter={historyStatusFilter}
          onHistoryStatusFilterChange={(filter) =>
            dispatch({ type: 'patch', patch: { historyStatusFilter: filter } })
          }
          jobs={data.jobs}
        />

        {mainTab === 'myTasks' ? (
          <CronTasksPanel
            c={c}
            localeTag={localeTag}
            scheduleBadgeLabels={scheduleBadgeLabels}
            loading={data.loading}
            jobsCount={data.userCronJobs.length}
            sortedJobs={sortedUserJobs}
            templateCategoryFilter={templateCategoryFilter}
            onTemplateCategoryFilterChange={(filter) =>
              dispatch({ type: 'patch', patch: { templateCategoryFilter: filter } })
            }
            onSelectTemplate={onSelectTemplate}
            keepAwake={keepAwakeHook.keepAwake}
            wakeSupported={keepAwakeHook.featureAvailable}
            onWakeUnsupportedClick={() => setError(c.wakeLockUnavailable)}
            onKeepAwakeToggle={() => keepAwakeHook.setKeepAwake((v) => !v)}
            absorbCardClickJobIdRef={absorbCardClickJobIdRef}
            scheduleAbsorbNextMenuCardClick={scheduleAbsorbNextMenuCardClick}
            onOpenDetail={(j) => void openDetail(j)}
            onToggle={(j, en) => void onToggle(j, en)}
            onEdit={(j) => form.openForm(j)}
            onAddJob={() => form.openForm()}
            onRunNow={(j) => openConfirm('run', j.id)}
            onDelete={(j) => openConfirm('delete', j.id)}
          />
        ) : mainTab === 'systemTasks' ? (
          <CronSystemTasksPanel
            c={c}
            language={language}
            localeTag={localeTag}
            scheduleBadgeLabels={scheduleBadgeLabels}
            loading={data.loading}
            sortedSystemJobs={sortedSystemJobs}
            heartbeat={data.heartbeatFromConfig}
            keepAwake={keepAwakeHook.keepAwake}
            wakeSupported={keepAwakeHook.featureAvailable}
            onWakeUnsupportedClick={() => setError(c.wakeLockUnavailable)}
            onKeepAwakeToggle={() => keepAwakeHook.setKeepAwake((v) => !v)}
            absorbCardClickJobIdRef={absorbCardClickJobIdRef}
            scheduleAbsorbNextMenuCardClick={scheduleAbsorbNextMenuCardClick}
            onOpenDetail={(j) => void openDetail(j)}
            onToggle={(j, en) => void onToggle(j, en)}
            onEdit={(j) => form.openForm(j)}
            onRunNow={(j) => openConfirm('run', j.id)}
            onDelete={(j) => openConfirm('delete', j.id)}
          />
        ) : (
          <CronRunHistorySection
            c={c}
            runHistoryLoading={data.runHistoryLoading}
            runHistory={data.runHistory}
            filteredRunHistory={filteredRunHistory}
            jobs={data.jobs}
            onRefreshHistory={() => void data.loadRunHistoryOnly()}
            onOpenJobDetail={(j) => void openDetail(j)}
            statusLabels={statusLabels}
          />
        )}
      </div>

      <CronJobFormDialog
        open={form.formOpen}
        onRequestClose={form.closeForm}
        c={c}
        chatM={chatM}
        agentsMessages={m.agentsSettings}
        isDark={isDark}
        channels={data.channels}
        sessionChatIds={form.sessionChatIds}
        cronAgentSelectOptions={form.cronAgentSelectOptions}
        defaultModelResolver={defaultModelForForm}
        formMode={form.formMode}
        formJobId={form.formJobId}
        formName={form.formName}
        onFormNameChange={form.setFormName}
        formSchedule={form.formSchedule}
        onFormScheduleChange={form.setFormSchedule}
        formSubmitting={form.formSubmitting}
        formTaskKind={form.formTaskKind}
        onFormTaskKindChange={form.setFormTaskKind}
        formWorkflowDefinitionId={form.formWorkflowDefinitionId}
        onFormWorkflowDefinitionIdChange={form.setFormWorkflowDefinitionId}
        formWorkflowGoal={form.formWorkflowGoal}
        onFormWorkflowGoalChange={form.setFormWorkflowGoal}
        formWorkflowInputJson={form.formWorkflowInputJson}
        onFormWorkflowInputJsonChange={form.setFormWorkflowInputJson}
        formSessionTarget={form.formSessionTarget}
        onFormSessionTargetChange={form.handleFormSessionTargetChange}
        formAgentLocalOnly={form.formAgentLocalOnly}
        onFormAgentLocalOnlyChange={form.setFormAgentLocalOnly}
        formModel={form.formModel}
        onFormModelUserChange={form.handleFormModelUserChange}
        formAgentId={form.formAgentId}
        onFormAgentIdChange={form.setFormAgentId}
        formWorkingDirectory={form.formWorkingDirectory}
        onFormWorkingDirectoryChange={form.setFormWorkingDirectory}
        formChannel={form.formChannel}
        onFormChannelChange={form.handleFormChannelChange}
        formChatId={form.formChatId}
        onFormChatIdChange={form.setFormChatId}
        formMessage={form.formMessage}
        onFormMessageChange={form.setFormMessage}
        formMessageMdMode={form.formMessageMdMode}
        onSetMessageMdMode={form.setMessageMdMode}
        messageEditorNonce={form.messageEditorNonce}
        needsDeliveryChat={form.needsDeliveryChat}
        showChannelPicker={form.showChannelPicker}
        canSubmit={form.canSubmit}
        onSubmit={() => void submitForm()}
        onRefreshRecipients={form.refreshRecipientsList}
      />

      <CronTemplatePickerDialog
        open={templatePickerOpen}
        onOpenChange={(openNext) => {
          dispatch({
            type: 'patch',
            patch: {
              templatePickerOpen: openNext,
              ...(openNext ? { templateCategoryFilter: 'all' as const } : {}),
            },
          });
        }}
        c={c}
        localeTag={localeTag}
        scheduleBadgeLabels={scheduleBadgeLabels}
        categoryFilter={templateCategoryFilter}
        onCategoryFilterChange={(filter) =>
          dispatch({ type: 'patch', patch: { templateCategoryFilter: filter } })
        }
        onSelectTemplate={onSelectTemplate}
      />

      <CronJobDetailDrawer
        open={detailOpen}
        onDismiss={closeDetail}
        detailJob={detailJob}
        detailLoading={detailLoading}
        detailHistory={detailHistory}
        c={c}
        chatWorkingDirNotSet={chatM.workingDirectory.notSet}
        statusLabels={statusLabels}
      />

      <CronConfirmActionDialog
        open={confirmOpen}
        onOpenChange={(open) => dispatch({ type: 'patch', patch: { confirmOpen: open } })}
        action={confirmActionRef.current}
        c={c}
        onDismiss={dismissConfirm}
        onConfirm={runConfirm}
      />
    </div>
    </>
  );
}

function CronPageHeaderRegistration({
  hasToken,
  c,
  loading,
  runHistoryLoading,
  onRefresh,
  onOpenTemplatePicker,
  onAddJob,
}: {
  hasToken: boolean;
  c: MessageBundle['cron'];
  loading: boolean;
  runHistoryLoading: boolean;
  onRefresh: () => void;
  onOpenTemplatePicker: () => void;
  onAddJob: () => void;
}) {
  const { pathname } = useLocation();
  const inSettingsShell = pathname.startsWith('/settings/');
  const setPageHeader = usePageHeaderStore((s) => s.setPageHeader);
  const clearPageHeader = usePageHeaderStore((s) => s.clearPageHeader);

  const cronHeaderEnd = useMemo(
    () => (
      <CronPageHeaderActions
        c={c}
        loading={loading}
        runHistoryLoading={runHistoryLoading}
        onRefresh={onRefresh}
        onOpenTemplatePicker={onOpenTemplatePicker}
        onAddJob={onAddJob}
      />
    ),
    [c, loading, runHistoryLoading, onRefresh, onOpenTemplatePicker, onAddJob],
  );

  useLayoutEffect(() => {
    if (!hasToken || inSettingsShell) {
      clearPageHeader();
      return () => clearPageHeader();
    }
    setPageHeader({
      startExtra: null,
      main: null,
      end: cronHeaderEnd,
    });
    return () => clearPageHeader();
  }, [clearPageHeader, cronHeaderEnd, hasToken, inSettingsShell, setPageHeader]);

  return null;
}
