import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';

import { fetchChatAgents, type ChatAgentOption } from '@/features/chat/chat-agents-api';
import type { CronDelivery, CronJob, CronJobExecution, CronPayload, CronRunHistoryRow } from '@/features/cron/cron-api';
import {
  addJob,
  cronJobBodyText,
  getAllRunsHistory,
  getChannels,
  getConfig,
  getHistory,
  getJob,
  getModels,
  getSessionChatIds,
  listJobs,
  removeJob,
  runJob,
  toggleJob,
  updateJob,
  type ChannelStatus,
  type SessionChatId,
} from '@/features/cron/cron-api';
import { CronConfirmActionDialog } from '@/features/cron/cron-confirm-action-dialog';
import { CronJobDetailDrawer } from '@/features/cron/cron-job-detail-drawer';
import { CronJobFormDialog } from '@/features/cron/cron-job-form-dialog';
import { CronMainToolbar } from '@/features/cron/cron-main-toolbar';
import {
  DEFAULT_SCHEDULE,
  RUN_HISTORY_FETCH_LIMIT,
  pushRecentWorkspaceDirForCron,
  startOfLocalDay,
  startOfLocalMonth,
  startOfLocalWeekMonday,
} from '@/features/cron/cron-page-lib';
import { CronPageHeaderActions } from '@/features/cron/cron-page-header-actions';
import { isDreamingManagedCronJob } from '@/features/cron/cron-dreaming-jobs';
import { CronRunHistorySection } from '@/features/cron/cron-run-history-section';
import { CronSystemTasksPanel } from '@/features/cron/cron-system-tasks-panel';
import { CronTasksPanel } from '@/features/cron/cron-tasks-panel';
import { getCronTemplateCopy } from '@/features/cron/cron-template-i18n';
import type { CronTemplateFilter } from '@/features/cron/cron-template-library';
import { CronTemplatePickerDialog } from '@/features/cron/cron-template-picker-dialog';
import { cronTemplateById } from '@/features/cron/cron-templates';
import { fetchGatewayConfigSwrResponse } from '@/features/gateway/gateway-config-swr';
import { normalizeHeartbeatFromConfig } from '@/features/settings/heartbeat-config-api';
import { messages } from '@/i18n/messages';
import { useGatewayStore } from '@/stores/gateway-store';
import { useLocaleStore } from '@/stores/locale-store';
import { usePageHeaderStore } from '@/stores/page-header-store';
import { useThemeStore } from '@/stores/theme-store';
import { isElectronCronDisplayWakeAvailable } from '@/lib/electron-env';

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

  const [jobs, setJobs] = useState<CronJob[]>([]);
  const [mainTab, setMainTab] = useState<'myTasks' | 'systemTasks' | 'history'>('myTasks');
  const [jobSort, setJobSort] = useState<'created_desc' | 'created_asc'>('created_desc');
  const [historyRange, setHistoryRange] = useState<'day' | 'week' | 'month'>('day');
  const [historyJobFilter, setHistoryJobFilter] = useState('');
  const [historyStatusFilter, setHistoryStatusFilter] = useState('');
  const [keepAwake, setKeepAwake] = useState(false);
  const wakeLockRef = useRef<WakeLockSentinel | null>(null);
  const wakeModeRef = useRef<'none' | 'electron' | 'navigator'>('none');
  const keepAwakeRef = useRef(keepAwake);
  const wakeSupported = typeof navigator !== 'undefined' && 'wakeLock' in navigator;
  const keepAwakeFeatureAvailable = wakeSupported || isElectronCronDisplayWakeAvailable();

  const [channels, setChannels] = useState<ChannelStatus[]>([]);
  const [availableModels, setAvailableModels] = useState<{ id: string; name: string; provider: string }[]>([]);
  const [defaultModel, setDefaultModel] = useState('');
  const [sessionChatIds, setSessionChatIds] = useState<SessionChatId[]>([]);
  const [chatAgents, setChatAgents] = useState<ChatAgentOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [gatewayConfigRaw, setGatewayConfigRaw] = useState<unknown>(null);
  const [error, setError] = useState<string | null>(null);
  const [runHistory, setRunHistory] = useState<CronRunHistoryRow[]>([]);
  const [runHistoryLoading, setRunHistoryLoading] = useState(false);

  const [formOpen, setFormOpen] = useState(false);
  const [formMode, setFormMode] = useState<'add' | 'edit'>('add');
  const [formJobId, setFormJobId] = useState<string | null>(null);
  const [formName, setFormName] = useState('');
  const [formSchedule, setFormSchedule] = useState(DEFAULT_SCHEDULE);
  const [formChannel, setFormChannel] = useState('local');
  const [formChatId, setFormChatId] = useState('');
  const [formMessage, setFormMessage] = useState('');
  const [formMessageMdMode, setFormMessageMdMode] = useState<'edit' | 'preview'>('edit');
  const [messageEditorNonce, setMessageEditorNonce] = useState(0);
  const [formSessionTarget, setFormSessionTarget] = useState<'main' | 'isolated'>('main');
  const [formAgentId, setFormAgentId] = useState('');
  const [formAgentLocalOnly, setFormAgentLocalOnly] = useState(false);
  const [formWorkingDirectory, setFormWorkingDirectory] = useState('');
  const [formWdModalOpen, setFormWdModalOpen] = useState(false);
  const [formModel, setFormModel] = useState('');
  const [formSubmitting, setFormSubmitting] = useState(false);
  const formModelUserTouched = useRef(false);

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

  const defaultModelForForm = useCallback(() => {
    return defaultModel || (availableModels.length > 0 ? availableModels[0].id : '');
  }, [defaultModel, availableModels]);

  const hasElectronFolderPicker =
    typeof window !== 'undefined' && Boolean(window.electronAPI?.file?.openDirectory);

  const openNativeFolderPickerCron = useCallback(async (): Promise<string | null> => {
    const api = typeof window !== 'undefined' ? window.electronAPI?.file?.openDirectory : undefined;
    if (api) return api();
    return null;
  }, []);

  const applyCronWorkingDirectory = useCallback(async (path: string) => {
    const t = path.trim();
    if (!t) return;
    pushRecentWorkspaceDirForCron(t);
    setFormWorkingDirectory(t);
  }, []);

  const cronAgentSelectOptions = useMemo(() => {
    const ids = new Set(chatAgents.map((a) => a.id));
    const out: ChatAgentOption[] = [...chatAgents];
    const extra = formAgentId.trim().toLowerCase();
    if (extra && !ids.has(extra)) {
      out.push({ id: extra });
    }
    return out;
  }, [chatAgents, formAgentId]);

  const needsDeliveryChat =
    formChannel !== 'local' && (formSessionTarget === 'main' || (formSessionTarget === 'isolated' && !formAgentLocalOnly));

  const showChannelPicker =
    formSessionTarget === 'main' || (formSessionTarget === 'isolated' && !formAgentLocalOnly);

  const canSubmit =
    Boolean(formName.trim()) &&
    Boolean(formSchedule.trim()) &&
    Boolean(formMessage.trim()) &&
    (!needsDeliveryChat || Boolean(formChatId.trim()));

  const loadRunHistoryOnly = useCallback(async () => {
    setRunHistoryLoading(true);
    try {
      const rows = await getAllRunsHistory(RUN_HISTORY_FETCH_LIMIT);
      setRunHistory(rows);
    } catch {
      /* ignore */
    } finally {
      setRunHistoryLoading(false);
    }
  }, []);

  const loadJobs = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await listJobs();
      setJobs(list);
    } catch (e) {
      setError(e instanceof Error ? e.message : c.failedToLoadJobs);
    } finally {
      setLoading(false);
    }
  }, [c.failedToLoadJobs]);

  const loadAux = useCallback(async () => {
    try {
      const [ch, mods, cfg, cfgFull, agentsPayload] = await Promise.all([
        getChannels(),
        getModels(),
        getConfig(),
        fetchGatewayConfigSwrResponse(),
        fetchChatAgents().catch(() => null),
      ]);
      setChannels(ch);
      setAvailableModels(mods);
      setDefaultModel(cfg.model || '');
      setGatewayConfigRaw(cfgFull.payload?.config ?? null);
      if (agentsPayload) {
        setChatAgents(agentsPayload.items);
      }
    } catch {
      /* non-fatal */
    }
  }, []);

  useEffect(() => {
    if (!hasToken) return;
    void loadJobs();
    void loadAux();
  }, [hasToken, loadJobs, loadAux]);

  useEffect(() => {
    if (!hasToken) return;
    const onReload = () => {
      void fetchGatewayConfigSwrResponse().then((r) => {
        setGatewayConfigRaw(r.payload?.config ?? null);
      });
    };
    window.addEventListener('config-reload', onReload);
    return () => window.removeEventListener('config-reload', onReload);
  }, [hasToken]);

  useEffect(() => {
    if (!hasToken || mainTab !== 'history') return;
    void loadRunHistoryOnly();
  }, [hasToken, mainTab, loadRunHistoryOnly]);

  const releaseWakeLock = useCallback(async () => {
    if (wakeModeRef.current === 'electron') {
      try {
        await window.electronAPI?.cron?.setDisplaySleepPrevented?.(false);
      } catch {
        /* ignore */
      }
      wakeModeRef.current = 'none';
      return;
    }
    try {
      await wakeLockRef.current?.release();
    } catch {
      /* ignore */
    }
    wakeLockRef.current = null;
    wakeModeRef.current = 'none';
  }, []);

  const acquireWakeLock = useCallback(async () => {
    const electronWake =
      typeof window !== 'undefined' ? window.electronAPI?.cron?.setDisplaySleepPrevented : undefined;
    if (electronWake) {
      try {
        await electronWake(true);
        wakeModeRef.current = 'electron';
        return;
      } catch {
        setError(c.wakeLockUnavailable);
        setKeepAwake(false);
        return;
      }
    }
    if (!wakeSupported) return;
    try {
      const sentinel = await navigator.wakeLock.request('screen');
      wakeLockRef.current = sentinel;
      wakeModeRef.current = 'navigator';
      sentinel.addEventListener('release', () => {
        wakeLockRef.current = null;
        wakeModeRef.current = 'none';
      });
    } catch {
      setError(c.wakeLockUnavailable);
      setKeepAwake(false);
    }
  }, [c.wakeLockUnavailable, wakeSupported]);

  keepAwakeRef.current = keepAwake;

  useEffect(() => {
    if (!keepAwake) {
      void releaseWakeLock();
      return;
    }
    void acquireWakeLock();
    const onVis = () => {
      if (document.visibilityState === 'visible' && keepAwakeRef.current) void acquireWakeLock();
    };
    document.addEventListener('visibilitychange', onVis);
    return () => {
      document.removeEventListener('visibilitychange', onVis);
      void releaseWakeLock();
    };
  }, [keepAwake, acquireWakeLock, releaseWakeLock]);

  useEffect(() => {
    if (!formOpen || formMode !== 'add' || formModelUserTouched.current) return;
    const next = defaultModelForForm();
    if (next) setFormModel(next);
  }, [formOpen, formMode, defaultModelForForm]);

  useEffect(() => {
    if (!formOpen || formMode !== 'add') return;
    const valid = new Set(['local', ...channels.map((x) => x.name)]);
    if (!valid.has(formChannel)) setFormChannel('local');
  }, [channels, formChannel, formMode, formOpen]);

  useEffect(() => {
    if (formChannel === 'local') {
      setSessionChatIds([]);
      return;
    }
    let cancelled = false;
    void getSessionChatIds(formChannel).then((ids) => {
      if (!cancelled) setSessionChatIds(ids);
    });
    return () => {
      cancelled = true;
    };
  }, [formChannel, formOpen]);

  const openForm = useCallback(
    (job?: CronJob) => {
      formModelUserTouched.current = false;
      setFormOpen(true);
      setFormMode(job ? 'edit' : 'add');
      setFormJobId(job?.id ?? null);

      if (job) {
        setFormName(job.name || '');
        setFormSchedule((job.schedule && String(job.schedule).trim()) || DEFAULT_SCHEDULE);
        const bodyText = cronJobBodyText(job);
        setFormMessage(bodyText ?? '');
        setFormSessionTarget(job.sessionTarget || 'main');
        setFormAgentId(
          (job.sessionTarget || 'main') === 'isolated' && job.agentId?.trim()
            ? job.agentId.trim().toLowerCase()
            : '',
        );
        setFormWorkingDirectory(
          (job.sessionTarget || 'main') === 'isolated' && job.workingDirectory?.trim()
            ? job.workingDirectory.trim()
            : '',
        );
        const fromPayload =
          job.payload?.kind === 'agentTurn' && job.payload.model?.trim() ? job.payload.model.trim() : '';
        const stored = job.model?.trim() || fromPayload;
        setFormModel(stored || defaultModelForForm());
        const hasLocalChannel = job.delivery?.channel === 'local';
        const agentLocalOnly =
          (job.sessionTarget || 'main') === 'isolated' &&
          !hasLocalChannel &&
          (!job.delivery?.to || job.delivery.mode === 'none');
        setFormAgentLocalOnly(agentLocalOnly);

        if (hasLocalChannel) {
          setFormChannel('local');
          setFormChatId('');
        } else if (job.delivery && job.delivery.mode !== 'none' && job.delivery.to) {
          setFormChannel(job.delivery.channel || 'telegram');
          setFormChatId(job.delivery.to || '');
        } else if (!agentLocalOnly) {
          const parts = bodyText.split(':');
          const knownChannels = ['telegram', 'cli', 'gateway', 'local'];
          if (parts.length >= 3 && knownChannels.includes(parts[0])) {
            setFormChannel(parts[0]);
            setFormChatId(parts[1]);
            setFormMessage(parts.slice(2).join(':'));
          } else {
            setFormChannel('telegram');
            setFormChatId('');
          }
        } else {
          setFormChannel('telegram');
          setFormChatId('');
        }
      } else {
        setFormName('');
        setFormSchedule(DEFAULT_SCHEDULE);
        setFormChannel('local');
        setFormChatId('');
        setFormMessage('');
        setFormSessionTarget('main');
        setFormAgentId('');
        setFormWorkingDirectory('');
        setFormAgentLocalOnly(false);
        setFormModel(defaultModelForForm());
      }
      setFormMessageMdMode('edit');
      setMessageEditorNonce((n) => n + 1);
    },
    [defaultModelForForm],
  );

  const setMessageMdMode = useCallback((mode: 'edit' | 'preview') => {
    setFormMessageMdMode(mode);
    if (mode === 'edit') {
      setMessageEditorNonce((n) => n + 1);
    }
  }, []);

  const applyCronTemplate = useCallback(
    (templateId: string) => {
      const def = cronTemplateById(templateId);
      const copy = def ? getCronTemplateCopy(m.cron, templateId) : undefined;
      if (!def || !copy) return;
      formModelUserTouched.current = false;
      setFormMode('add');
      setFormJobId(null);
      setFormName(copy.title);
      setFormSchedule(def.defaultSchedule);
      setFormMessage(copy.prompt);
      setFormSessionTarget(def.defaultSessionTarget);
      setFormChannel('local');
      setFormChatId('');
      setFormAgentLocalOnly(false);
      setFormAgentId('');
      setFormWorkingDirectory('');
      setFormModel(defaultModelForForm());
      setFormMessageMdMode('edit');
      setMessageEditorNonce((n) => n + 1);
      setTemplatePickerOpen(false);
      setFormOpen(true);
    },
    [defaultModelForForm, m.cron],
  );

  const closeForm = useCallback(() => {
    setFormOpen(false);
    setFormMode('add');
    setFormJobId(null);
    setFormName('');
    setFormSchedule(DEFAULT_SCHEDULE);
    setFormChannel('local');
    setFormChatId('');
    setFormMessage('');
    setFormSessionTarget('main');
    setFormAgentId('');
    setFormWorkingDirectory('');
    setFormWdModalOpen(false);
    setFormAgentLocalOnly(false);
    setFormModel('');
    setFormMessageMdMode('edit');
    formModelUserTouched.current = false;
  }, []);

  const submitForm = async () => {
    if (!formName.trim()) {
      setError(c.nameRequired);
      return;
    }
    if (!formSchedule.trim() || !formMessage.trim()) {
      setError(c.scheduleRequired);
      return;
    }
    if (needsDeliveryChat && !formChatId.trim()) {
      setError(c.chatIdRequired);
      return;
    }

    setFormSubmitting(true);
    setError(null);
    try {
      const message = formMessage.trim();
      let delivery: CronDelivery;
      if (formSessionTarget === 'isolated' && formAgentLocalOnly) {
        delivery = { mode: 'none' };
      } else if (formChannel === 'local') {
        delivery = { mode: 'direct', channel: 'local' };
      } else {
        delivery = { mode: 'direct', channel: formChannel, to: formChatId.trim() };
      }

      const payload: CronPayload =
        formSessionTarget === 'isolated'
          ? {
              kind: 'agentTurn',
              message,
              ...(formModel.trim() ? { model: formModel.trim() } : {}),
            }
          : { kind: 'systemEvent', text: message };

      const modelTrimmed = formModel.trim();
      const agentIdTrim = formAgentId.trim().toLowerCase();
      const agentIdForEdit = formSessionTarget === 'main' ? null : agentIdTrim || null;
      const wdTrim = formWorkingDirectory.trim();
      const jobData = {
        name: formName.trim(),
        schedule: formSchedule.trim(),
        sessionTarget: formSessionTarget,
        model: formSessionTarget === 'isolated' && modelTrimmed ? modelTrimmed : undefined,
        delivery,
        payload,
        ...(formMode === 'edit'
          ? {
              agentId: agentIdForEdit,
              workingDirectory: formSessionTarget === 'isolated' ? wdTrim || null : null,
            }
          : {
              ...(formSessionTarget === 'isolated' && agentIdTrim ? { agentId: agentIdTrim } : {}),
              ...(formSessionTarget === 'isolated' && wdTrim ? { workingDirectory: wdTrim } : {}),
            }),
      };

      if (formMode === 'edit' && formJobId) {
        await updateJob(formJobId, jobData);
      } else {
        const { schedule: sched, agentId, workingDirectory, ...rest } = jobData;
        await addJob(sched, {
          ...rest,
          ...(agentId != null ? { agentId } : {}),
          ...(workingDirectory ? { workingDirectory } : {}),
        });
      }
      closeForm();
      await loadJobs();
      await loadAux();
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : formMode === 'edit'
            ? c.failedToUpdateJob
            : c.failedToCreateJob,
      );
    } finally {
      setFormSubmitting(false);
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
      await loadJobs();
      await loadAux();
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
      await loadJobs();
      await loadAux();
      await loadRunHistoryOnly();
    } catch (e) {
      setError(e instanceof Error ? e.message : c.actionFailed);
    }
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (formOpen) closeForm();
      else if (detailOpen) {
        setDetailOpen(false);
        setDetailJob(null);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [formOpen, detailOpen, closeForm]);

  const statusLabels = useMemo(
    () => ({
      running: c.execStatusRunning,
      success: c.execStatusSuccess,
      failed: c.execStatusFailed,
      cancelled: c.execStatusCancelled,
    }),
    [c.execStatusCancelled, c.execStatusFailed, c.execStatusRunning, c.execStatusSuccess],
  );

  const userCronJobs = useMemo(() => jobs.filter((j) => !isDreamingManagedCronJob(j)), [jobs]);
  const systemCronJobs = useMemo(() => jobs.filter((j) => isDreamingManagedCronJob(j)), [jobs]);

  const sortJobsByCreated = useCallback(
    (arr: CronJob[]) => {
      const next = [...arr];
      next.sort((a, b) => {
        const ta = new Date(a.created_at).getTime();
        const tb = new Date(b.created_at).getTime();
        return jobSort === 'created_desc' ? tb - ta : ta - tb;
      });
      return next;
    },
    [jobSort],
  );

  const sortedUserJobs = useMemo(() => sortJobsByCreated(userCronJobs), [sortJobsByCreated, userCronJobs]);
  const sortedSystemJobs = useMemo(() => sortJobsByCreated(systemCronJobs), [sortJobsByCreated, systemCronJobs]);

  const heartbeatFromConfig = useMemo(
    () => normalizeHeartbeatFromConfig(gatewayConfigRaw),
    [gatewayConfigRaw],
  );

  const filteredRunHistory = useMemo(() => {
    const now = new Date();
    const from =
      historyRange === 'day'
        ? startOfLocalDay(now)
        : historyRange === 'week'
          ? startOfLocalWeekMonday(now)
          : startOfLocalMonth(now);
    return runHistory.filter((row) => {
      if (new Date(row.startedAt) < from) return false;
      if (historyJobFilter && row.jobId !== historyJobFilter) return false;
      if (historyStatusFilter && row.status !== historyStatusFilter) return false;
      return true;
    });
  }, [runHistory, historyRange, historyJobFilter, historyStatusFilter]);

  const scheduleBadgeLabels = c.scheduleBadge;

  const refreshAll = useCallback(() => {
    void loadJobs();
    void loadAux();
    void loadRunHistoryOnly();
  }, [loadJobs, loadAux, loadRunHistoryOnly]);

  const setPageHeader = usePageHeaderStore((s) => s.setPageHeader);
  const clearPageHeader = usePageHeaderStore((s) => s.clearPageHeader);
  const { pathname } = useLocation();
  const inSettingsShell = pathname.startsWith('/settings/');

  const handleFormSessionTargetChange = useCallback(
    (target: 'main' | 'isolated', defaultModelFallback: () => string, currentModel: string) => {
      setFormSessionTarget(target);
      if (target === 'main') {
        setFormAgentLocalOnly(false);
        setFormAgentId('');
        setFormWorkingDirectory('');
      } else if (target === 'isolated' && !currentModel) setFormModel(defaultModelFallback());
    },
    [],
  );

  const refreshRecipientsList = useCallback(() => {
    void getSessionChatIds(formChannel).then(setSessionChatIds);
  }, [formChannel]);

  const cronHeaderEnd = useMemo(
    () => (
      <CronPageHeaderActions
        c={c}
        loading={loading}
        runHistoryLoading={runHistoryLoading}
        onRefresh={refreshAll}
        onOpenTemplatePicker={() => {
          setTemplateCategoryFilter('all');
          setTemplatePickerOpen(true);
        }}
        onAddJob={() => openForm()}
      />
    ),
    [c, loading, openForm, refreshAll, runHistoryLoading],
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
        {error ? (
          <div
            className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-200"
            role="alert"
          >
            {error}
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
          jobs={jobs}
        />

        {mainTab === 'myTasks' ? (
          <CronTasksPanel
            c={c}
            localeTag={localeTag}
            scheduleBadgeLabels={scheduleBadgeLabels}
            loading={loading}
            jobsCount={userCronJobs.length}
            sortedJobs={sortedUserJobs}
            templateCategoryFilter={templateCategoryFilter}
            onTemplateCategoryFilterChange={setTemplateCategoryFilter}
            onSelectTemplate={applyCronTemplate}
            keepAwake={keepAwake}
            wakeSupported={keepAwakeFeatureAvailable}
            onWakeUnsupportedClick={() => setError(c.wakeLockUnavailable)}
            onKeepAwakeToggle={() => setKeepAwake((v) => !v)}
            absorbCardClickJobIdRef={absorbCardClickJobIdRef}
            scheduleAbsorbNextMenuCardClick={scheduleAbsorbNextMenuCardClick}
            onOpenDetail={(j) => void openDetail(j)}
            onToggle={(j, en) => void onToggle(j, en)}
            onEdit={(j) => openForm(j)}
            onAddJob={() => openForm()}
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
            loading={loading}
            sortedSystemJobs={sortedSystemJobs}
            heartbeat={heartbeatFromConfig}
            keepAwake={keepAwake}
            wakeSupported={keepAwakeFeatureAvailable}
            onWakeUnsupportedClick={() => setError(c.wakeLockUnavailable)}
            onKeepAwakeToggle={() => setKeepAwake((v) => !v)}
            absorbCardClickJobIdRef={absorbCardClickJobIdRef}
            scheduleAbsorbNextMenuCardClick={scheduleAbsorbNextMenuCardClick}
            onOpenDetail={(j) => void openDetail(j)}
            onToggle={(j, en) => void onToggle(j, en)}
            onEdit={(j) => openForm(j)}
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
            runHistoryLoading={runHistoryLoading}
            runHistory={runHistory}
            filteredRunHistory={filteredRunHistory}
            jobs={jobs}
            onRefreshHistory={() => void loadRunHistoryOnly()}
            onOpenJobDetail={(j) => void openDetail(j)}
            statusLabels={statusLabels}
          />
        )}
      </div>

      <CronJobFormDialog
        open={formOpen}
        onRequestClose={closeForm}
        c={c}
        chatM={chatM}
        agentsMessages={m.agentsSettings}
        isDark={isDark}
        channels={channels}
        sessionChatIds={sessionChatIds}
        cronAgentSelectOptions={cronAgentSelectOptions}
        hasElectronFolderPicker={hasElectronFolderPicker}
        openNativeFolderPicker={openNativeFolderPickerCron}
        applyWorkingDirectory={applyCronWorkingDirectory}
        wdModalOpen={formWdModalOpen}
        onWdModalOpenChange={setFormWdModalOpen}
        defaultModelResolver={defaultModelForForm}
        formMode={formMode}
        formJobId={formJobId}
        formName={formName}
        onFormNameChange={setFormName}
        formSchedule={formSchedule}
        onFormScheduleChange={setFormSchedule}
        formSubmitting={formSubmitting}
        formSessionTarget={formSessionTarget}
        onFormSessionTargetChange={handleFormSessionTargetChange}
        formAgentLocalOnly={formAgentLocalOnly}
        onFormAgentLocalOnlyChange={setFormAgentLocalOnly}
        formModel={formModel}
        onFormModelUserChange={(id) => {
          formModelUserTouched.current = true;
          setFormModel(id);
        }}
        formAgentId={formAgentId}
        onFormAgentIdChange={setFormAgentId}
        formWorkingDirectory={formWorkingDirectory}
        onFormWorkingDirectoryChange={setFormWorkingDirectory}
        formChannel={formChannel}
        onFormChannelChange={(v) => {
          setFormChannel(v);
          if (v === 'local') setFormAgentLocalOnly(false);
          setFormChatId('');
        }}
        formChatId={formChatId}
        onFormChatIdChange={setFormChatId}
        formMessage={formMessage}
        onFormMessageChange={setFormMessage}
        formMessageMdMode={formMessageMdMode}
        onSetMessageMdMode={setMessageMdMode}
        messageEditorNonce={messageEditorNonce}
        needsDeliveryChat={needsDeliveryChat}
        showChannelPicker={showChannelPicker}
        canSubmit={canSubmit}
        onSubmit={() => void submitForm()}
        onRefreshRecipients={refreshRecipientsList}
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
        onSelectTemplate={applyCronTemplate}
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
