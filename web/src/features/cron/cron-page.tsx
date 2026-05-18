import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
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
import { messages } from '@/i18n/messages';
import { useGatewayStore } from '@/stores/gateway-store';
import { useLocaleStore } from '@/stores/locale-store';
import { usePageHeaderStore } from '@/stores/page-header-store';
import { useThemeStore } from '@/stores/theme-store';

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

  const [mainTab, setMainTab] = useState<'myTasks' | 'systemTasks' | 'history'>('myTasks');
  const [jobSort, setJobSort] = useState<JobSort>('created_desc');
  const [historyRange, setHistoryRange] = useState<HistoryRange>('day');
  const [historyJobFilter, setHistoryJobFilter] = useState('');
  const [historyStatusFilter, setHistoryStatusFilter] = useState('');

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

  const [detailOpen, setDetailOpen] = useState(false);
  const [detailJob, setDetailJob] = useState<CronJob | null>(null);
  const [detailHistory, setDetailHistory] = useState<CronJobExecution[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmAction, setConfirmAction] = useState<'delete' | 'run' | null>(null);
  const [confirmJobId, setConfirmJobId] = useState<string | null>(null);

  const [templatePickerOpen, setTemplatePickerOpen] = useState(false);
  const [templateCategoryFilter, setTemplateCategoryFilter] = useState<CronTemplateFilter>('all');

  const absorbCardClickJobIdRef = useRef<string | null>(null);

  const scheduleAbsorbNextMenuCardClick = useCallback((jobId: string) => {
    absorbCardClickJobIdRef.current = jobId;
    window.setTimeout(() => {
      if (absorbCardClickJobIdRef.current === jobId) {
        absorbCardClickJobIdRef.current = null;
      }
    }, 400);
  }, []);

  const hasElectronFolderPicker =
    typeof window !== 'undefined' && Boolean(window.electronAPI?.file?.openDirectory);

  const openNativeFolderPickerCron = useCallback(async (): Promise<string | null> => {
    const api = typeof window !== 'undefined' ? window.electronAPI?.file?.openDirectory : undefined;
    if (api) return api();
    return null;
  }, []);

  const onSelectTemplate = useCallback(
    (templateId: string) => {
      const ok = form.applyCronTemplate(templateId);
      if (ok) setTemplatePickerOpen(false);
    },
    [form],
  );

  const submitForm = async () => {
    if (!form.formName.trim()) {
      setError(c.nameRequired);
      return;
    }
    if (!form.formSchedule.trim() || !form.formMessage.trim()) {
      setError(c.scheduleRequired);
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
      let delivery: CronDelivery;
      if (form.formSessionTarget === 'isolated' && form.formAgentLocalOnly) {
        delivery = { mode: 'none' };
      } else if (form.formChannel === 'local') {
        delivery = { mode: 'direct', channel: 'local' };
      } else {
        delivery = { mode: 'direct', channel: form.formChannel, to: form.formChatId.trim() };
      }

      const payload: CronPayload =
        form.formSessionTarget === 'isolated'
          ? {
              kind: 'agentTurn',
              message,
              ...(form.formModel.trim() ? { model: form.formModel.trim() } : {}),
            }
          : { kind: 'systemEvent', text: message };

      const modelTrimmed = form.formModel.trim();
      const agentIdTrim = form.formAgentId.trim().toLowerCase();
      const agentIdForEdit = form.formSessionTarget === 'main' ? null : agentIdTrim || null;
      const wdTrim = form.formWorkingDirectory.trim();
      const jobData = {
        name: form.formName.trim(),
        schedule: form.formSchedule.trim(),
        sessionTarget: form.formSessionTarget,
        model: form.formSessionTarget === 'isolated' && modelTrimmed ? modelTrimmed : undefined,
        delivery,
        payload,
        ...(form.formMode === 'edit'
          ? {
              agentId: agentIdForEdit,
              workingDirectory: form.formSessionTarget === 'isolated' ? wdTrim || null : null,
            }
          : {
              ...(form.formSessionTarget === 'isolated' && agentIdTrim ? { agentId: agentIdTrim } : {}),
              ...(form.formSessionTarget === 'isolated' && wdTrim ? { workingDirectory: wdTrim } : {}),
            }),
      };

      if (form.formMode === 'edit' && form.formJobId) {
        await updateJob(form.formJobId, jobData);
      } else {
        const { schedule: sched, agentId, workingDirectory, ...rest } = jobData;
        await addJob(sched, {
          ...rest,
          ...(agentId != null ? { agentId } : {}),
          ...(workingDirectory ? { workingDirectory } : {}),
        });
      }
      form.closeForm();
      await data.loadJobs();
      await data.loadAux();
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : form.formMode === 'edit'
            ? c.failedToUpdateJob
            : c.failedToCreateJob,
      );
    } finally {
      form.setFormSubmitting(false);
    }
  };

  const openDetail = async (job: CronJob) => {
    setDetailOpen(true);
    setDetailJob(job);
    setDetailLoading(true);
    setDetailHistory([]);
    try {
      const full = await getJob(job.id);
      if (full) {
        setDetailJob(full);
        setDetailHistory(await getHistory(job.id, 20));
      }
    } catch {
      /* keep partial */
    } finally {
      setDetailLoading(false);
    }
  };

  const onToggle = async (job: CronJob, enabled: boolean) => {
    try {
      await toggleJob(job.id, enabled);
      await data.loadJobs();
      await data.loadAux();
    } catch (e) {
      setError(e instanceof Error ? e.message : c.failedToToggleJob);
    }
  };

  const runConfirm = async () => {
    if (!confirmJobId || !confirmAction) return;
    const id = confirmJobId;
    const action = confirmAction;
    setConfirmOpen(false);
    setConfirmJobId(null);
    setConfirmAction(null);
    try {
      if (action === 'run') {
        await runJob(id);
      } else {
        await removeJob(id);
        if (detailJob?.id === id) {
          setDetailOpen(false);
          setDetailJob(null);
        }
      }
      await data.loadJobs();
      await data.loadAux();
      await data.loadRunHistoryOnly();
    } catch (e) {
      setError(e instanceof Error ? e.message : c.actionFailed);
    }
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (form.formOpen) form.closeForm();
      else if (detailOpen) {
        setDetailOpen(false);
        setDetailJob(null);
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

  const setPageHeader = usePageHeaderStore((s) => s.setPageHeader);
  const clearPageHeader = usePageHeaderStore((s) => s.clearPageHeader);
  const { pathname } = useLocation();
  const inSettingsShell = pathname.startsWith('/settings/');

  const cronHeaderEnd = useMemo(
    () => (
      <CronPageHeaderActions
        c={c}
        loading={data.loading}
        runHistoryLoading={data.runHistoryLoading}
        onRefresh={data.refreshAll}
        onOpenTemplatePicker={() => {
          setTemplateCategoryFilter('all');
          setTemplatePickerOpen(true);
        }}
        onAddJob={() => form.openForm()}
      />
    ),
    [c, data.loading, data.runHistoryLoading, data.refreshAll, form],
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

  if (!hasToken) {
    return (
      <div className="mx-auto w-full max-w-app-main px-4 py-16 text-center text-sm text-fg-muted sm:px-8">{c.needToken}</div>
    );
  }

  return (
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
            {cronHeaderEnd}
          </div>
        ) : null}

        <CronMainToolbar
          c={c}
          mainTab={mainTab}
          onMainTabChange={setMainTab}
          jobSort={jobSort}
          onJobSortChange={setJobSort}
          historyRange={historyRange}
          onHistoryRangeChange={setHistoryRange}
          historyJobFilter={historyJobFilter}
          onHistoryJobFilterChange={setHistoryJobFilter}
          historyStatusFilter={historyStatusFilter}
          onHistoryStatusFilterChange={setHistoryStatusFilter}
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
            onTemplateCategoryFilterChange={setTemplateCategoryFilter}
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
            onRunNow={(j) => {
              setConfirmAction('run');
              setConfirmJobId(j.id);
              setConfirmOpen(true);
            }}
            onDelete={(j) => {
              setConfirmAction('delete');
              setConfirmJobId(j.id);
              setConfirmOpen(true);
            }}
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
            onRunNow={(j) => {
              setConfirmAction('run');
              setConfirmJobId(j.id);
              setConfirmOpen(true);
            }}
            onDelete={(j) => {
              setConfirmAction('delete');
              setConfirmJobId(j.id);
              setConfirmOpen(true);
            }}
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
        hasElectronFolderPicker={hasElectronFolderPicker}
        openNativeFolderPicker={openNativeFolderPickerCron}
        applyWorkingDirectory={form.applyWorkingDirectory}
        wdModalOpen={form.formWdModalOpen}
        onWdModalOpenChange={form.setFormWdModalOpen}
        defaultModelResolver={defaultModelForForm}
        formMode={form.formMode}
        formJobId={form.formJobId}
        formName={form.formName}
        onFormNameChange={form.setFormName}
        formSchedule={form.formSchedule}
        onFormScheduleChange={form.setFormSchedule}
        formSubmitting={form.formSubmitting}
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
          setTemplatePickerOpen(openNext);
          if (openNext) setTemplateCategoryFilter('all');
        }}
        c={c}
        localeTag={localeTag}
        scheduleBadgeLabels={scheduleBadgeLabels}
        categoryFilter={templateCategoryFilter}
        onCategoryFilterChange={setTemplateCategoryFilter}
        onSelectTemplate={onSelectTemplate}
      />

      <CronJobDetailDrawer
        open={detailOpen}
        onDismiss={() => {
          setDetailOpen(false);
          setDetailJob(null);
        }}
        detailJob={detailJob}
        detailLoading={detailLoading}
        detailHistory={detailHistory}
        c={c}
        chatWorkingDirNotSet={chatM.workingDirectory.notSet}
        statusLabels={statusLabels}
      />

      <CronConfirmActionDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        action={confirmAction}
        c={c}
        onDismiss={() => {
          setConfirmOpen(false);
          setConfirmJobId(null);
          setConfirmAction(null);
        }}
        onConfirm={runConfirm}
      />
    </div>
  );
}
