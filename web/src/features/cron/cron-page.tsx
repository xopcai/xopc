import * as Dialog from '@radix-ui/react-dialog';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import {
  Clock,
  Eye,
  FolderInput,
  Info,
  LayoutTemplate,
  Loader2,
  MoreVertical,
  Plus,
  RefreshCw,
  SquarePen,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';

import { MarkdownEditor } from '@/components/markdown/markdown-editor';
import { MarkdownView } from '@/components/markdown/markdown-view';
import { Button } from '@/components/ui/button';
import {
  segmentedThumbActiveClassName,
  segmentedThumbBaseClassName,
  segmentedTrackClassName,
} from '@/components/ui/segmented-styles';
import { fetchChatAgents, type ChatAgentOption } from '@/features/chat/chat-agents-api';
import { ModelSelector } from '@/features/chat/model-selector';
import { folderDisplayName } from '@/features/chat/session-working-directory-control';
import { WorkingDirectoryPickerModal } from '@/features/chat/working-directory-picker-modal';
import type { CronDelivery, CronJob, CronJobExecution, CronRunHistoryRow } from '@/features/cron/cron-api';
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
  type CronPayload,
  type SessionChatId,
} from '@/features/cron/cron-api';
import { getCronTemplateCopy } from '@/features/cron/cron-template-i18n';
import { CronTemplateLibrary, type CronTemplateFilter } from '@/features/cron/cron-template-library';
import { cronTemplateById } from '@/features/cron/cron-templates';
import { CronSchedulePicker } from '@/features/cron/cron-schedule-form';
import {
  execStatusLabel,
  formatDeliveryToSummary,
  formatDuration,
  formatNextRun,
  formatRecipientOptionLabel,
  formatScheduleBadge,
  formatTime,
  truncate,
} from '@/features/cron/cron-utils';
import {
  formControlBorderFocusClass,
  nativeSelectMaxWidthClass,
  selectControlBaseClass,
} from '@/lib/form-field-width';
import { cn } from '@/lib/cn';
import { interaction } from '@/lib/interaction';
import { messages } from '@/i18n/messages';
import { useGatewayStore } from '@/stores/gateway-store';
import { useLocaleStore } from '@/stores/locale-store';
import { usePageHeaderStore } from '@/stores/page-header-store';
import { useThemeStore } from '@/stores/theme-store';

const RUN_HISTORY_FETCH_LIMIT = 400;

function startOfLocalDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

/** Week starts on Monday (local). */
function startOfLocalWeekMonday(d: Date): Date {
  const x = startOfLocalDay(d);
  const day = x.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  x.setDate(x.getDate() + diff);
  return x;
}

function startOfLocalMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1, 0, 0, 0, 0);
}

const DEFAULT_SCHEDULE = '*/5 * * * *';

/** Same storage key as chat composer so recent folders stay in sync. */
const RECENT_WD_STORAGE_KEY = 'xopc.recentWorkspaceDirs.v1';
const RECENT_WD_MAX = 10;

function navigateToSessionChat(sessionKey: string | undefined | null): void {
  const sk = sessionKey?.trim();
  if (!sk) return;
  window.dispatchEvent(
    new CustomEvent('navigate-to-chat', { detail: { sessionKey: sk }, bubbles: true }),
  );
}

function pushRecentWorkspaceDirForCron(path: string): void {
  const t = path.trim();
  if (!t) return;
  try {
    const raw = localStorage.getItem(RECENT_WD_STORAGE_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    const prev = Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string' && x.trim()) : [];
    const next = [t, ...prev.filter((p) => p !== t)].slice(0, RECENT_WD_MAX);
    localStorage.setItem(RECENT_WD_STORAGE_KEY, JSON.stringify(next));
  } catch {
    /* ignore */
  }
}

function inputClassName(disabled?: boolean): string {
  return cn(
    'w-full rounded-md border border-edge bg-surface-base px-3 py-2 text-sm text-fg placeholder:text-fg-disabled',
    formControlBorderFocusClass,
    disabled && 'cursor-not-allowed opacity-60',
  );
}

function selectClassName(): string {
  return cn(selectControlBaseClass, nativeSelectMaxWidthClass);
}

const cronRecipientSelectClass = cn(
  selectControlBaseClass,
  'w-full text-xs sm:w-auto sm:min-w-[11rem] sm:max-w-[17rem] sm:shrink-0',
);

/** Toolbar filters: avoid `w-full` from {@link nativeSelectMaxWidthClass} so Day/Week/Month + selects stay one row. */
const cronToolbarSelectClass = cn(
  selectControlBaseClass,
  'w-auto min-w-[9rem] max-w-[14rem] shrink-0 text-xs',
);

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
  const [mainTab, setMainTab] = useState<'tasks' | 'history'>('tasks');
  const [jobSort, setJobSort] = useState<'created_desc' | 'created_asc'>('created_desc');
  const [historyRange, setHistoryRange] = useState<'day' | 'week' | 'month'>('day');
  const [historyJobFilter, setHistoryJobFilter] = useState('');
  const [historyStatusFilter, setHistoryStatusFilter] = useState('');
  const [keepAwake, setKeepAwake] = useState(false);
  const wakeLockRef = useRef<WakeLockSentinel | null>(null);
  const keepAwakeRef = useRef(keepAwake);
  const wakeSupported = typeof navigator !== 'undefined' && 'wakeLock' in navigator;

  const [channels, setChannels] = useState<ChannelStatus[]>([]);
  const [availableModels, setAvailableModels] = useState<{ id: string; name: string; provider: string }[]>([]);
  const [defaultModel, setDefaultModel] = useState('');
  const [sessionChatIds, setSessionChatIds] = useState<SessionChatId[]>([]);
  const [chatAgents, setChatAgents] = useState<ChatAgentOption[]>([]);
  const [loading, setLoading] = useState(false);
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

  /** Radix menu is portaled; after selecting an item the same pointer `click` can hit the card underneath. */
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

  const applyCronWorkingDirectory = useCallback(
    async (path: string) => {
      const t = path.trim();
      if (!t) return;
      pushRecentWorkspaceDirForCron(t);
      setFormWorkingDirectory(t);
    },
    [],
  );

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
      const [ch, mods, cfg, agentsPayload] = await Promise.all([
        getChannels(),
        getModels(),
        getConfig(),
        fetchChatAgents().catch(() => null),
      ]);
      setChannels(ch);
      setAvailableModels(mods);
      setDefaultModel(cfg.model || '');
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
    if (!hasToken || mainTab !== 'history') return;
    void loadRunHistoryOnly();
  }, [hasToken, mainTab, loadRunHistoryOnly]);

  const releaseWakeLock = useCallback(async () => {
    try {
      await wakeLockRef.current?.release();
    } catch {
      /* ignore */
    }
    wakeLockRef.current = null;
  }, []);

  const acquireWakeLock = useCallback(async () => {
    if (!wakeSupported) return;
    try {
      const sentinel = await navigator.wakeLock.request('screen');
      wakeLockRef.current = sentinel;
      sentinel.addEventListener('release', () => {
        wakeLockRef.current = null;
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
      const agentIdForEdit =
        formSessionTarget === 'main' ? null : agentIdTrim || null;
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

  const statusLabels = {
    running: c.execStatusRunning,
    success: c.execStatusSuccess,
    failed: c.execStatusFailed,
    cancelled: c.execStatusCancelled,
  };

  const sortedJobs = useMemo(() => {
    const arr = [...jobs];
    arr.sort((a, b) => {
      const ta = new Date(a.created_at).getTime();
      const tb = new Date(b.created_at).getTime();
      return jobSort === 'created_desc' ? tb - ta : ta - tb;
    });
    return arr;
  }, [jobs, jobSort]);

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

  const cronHeaderEnd = useMemo(
    () => (
      <div className="flex min-w-0 flex-1 flex-wrap items-center justify-end gap-2">
        <Button
          type="button"
          variant="ghost"
          className="h-9 w-9 shrink-0 p-0"
          disabled={loading || runHistoryLoading}
          title={c.refresh}
          aria-label={c.refresh}
          onClick={() => void refreshAll()}
        >
          <RefreshCw
            className={cn('size-4', (loading || runHistoryLoading) && 'animate-spin')}
            strokeWidth={1.75}
          />
        </Button>
        <Button
          type="button"
          variant="secondary"
          className="gap-2"
          onClick={() => {
            setTemplateCategoryFilter('all');
            setTemplatePickerOpen(true);
          }}
        >
          <LayoutTemplate className="size-4" strokeWidth={1.75} />
          {c.fromTemplate}
        </Button>
        <Button type="button" variant="primary" className="gap-2" onClick={() => openForm()}>
          <Plus className="size-4" strokeWidth={1.75} />
          {c.addJob}
        </Button>
      </div>
    ),
    [c.addJob, c.fromTemplate, c.refresh, loading, openForm, refreshAll, runHistoryLoading],
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
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto bg-surface-panel">
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

        <div className="flex flex-col gap-3 border-b border-edge-subtle pb-3 sm:flex-row sm:items-center sm:justify-between dark:border-edge-subtle">
          <div className="flex gap-1" role="tablist" aria-label={c.title}>
            <button
              type="button"
              role="tab"
              aria-selected={mainTab === 'tasks'}
              className={cn(
                'rounded-md px-3 py-2 text-sm font-medium transition-colors',
                mainTab === 'tasks' ? 'text-fg' : 'text-fg-muted hover:text-fg',
              )}
              onClick={() => setMainTab('tasks')}
            >
              {c.tabMyTasks}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mainTab === 'history'}
              className={cn(
                'rounded-md px-3 py-2 text-sm font-medium transition-colors',
                mainTab === 'history' ? 'text-fg' : 'text-fg-muted hover:text-fg',
              )}
              onClick={() => setMainTab('history')}
            >
              {c.tabRunHistory}
            </button>
          </div>
          <div
            className={cn(
              'flex min-w-0 items-center gap-2',
              mainTab === 'history'
                ? 'flex-nowrap overflow-x-auto pb-0.5 sm:justify-end'
                : 'flex-wrap sm:justify-end',
            )}
          >
            {mainTab === 'tasks' ? (
              <select
                className={cronToolbarSelectClass}
                value={jobSort}
                onChange={(e) => setJobSort(e.target.value as 'created_desc' | 'created_asc')}
                aria-label={c.sortCreatedDesc}
              >
                <option value="created_desc">{c.sortCreatedDesc}</option>
                <option value="created_asc">{c.sortCreatedAsc}</option>
              </select>
            ) : (
              <>
                <div className={cn(segmentedTrackClassName, 'shrink-0')} role="group" aria-label={c.runHistoryTitle}>
                  {(['day', 'week', 'month'] as const).map((r) => (
                    <button
                      key={r}
                      type="button"
                      className={cn(
                        segmentedThumbBaseClassName,
                        'px-2.5 py-1',
                        historyRange === r && segmentedThumbActiveClassName,
                        historyRange === r && 'text-fg',
                      )}
                      onClick={() => setHistoryRange(r)}
                    >
                      {r === 'day' ? c.historyRangeDay : r === 'week' ? c.historyRangeWeek : c.historyRangeMonth}
                    </button>
                  ))}
                </div>
                <select
                  className={cronToolbarSelectClass}
                  value={historyJobFilter}
                  onChange={(e) => setHistoryJobFilter(e.target.value)}
                  aria-label={c.filterAllTasks}
                >
                  <option value="">{c.filterAllTasks}</option>
                  {jobs.map((j) => (
                    <option key={j.id} value={j.id}>
                      {j.name || j.id}
                    </option>
                  ))}
                </select>
                <select
                  className={cronToolbarSelectClass}
                  value={historyStatusFilter}
                  onChange={(e) => setHistoryStatusFilter(e.target.value)}
                  aria-label={c.filterAllStatuses}
                >
                  <option value="">{c.filterAllStatuses}</option>
                  <option value="success">{c.execStatusSuccess}</option>
                  <option value="failed">{c.execStatusFailed}</option>
                  <option value="cancelled">{c.execStatusCancelled}</option>
                  <option value="running">{c.execStatusRunning}</option>
                </select>
              </>
            )}
          </div>
        </div>

        {mainTab === 'tasks' ? (
          <section aria-labelledby="cron-tasks-panel" className="flex flex-col gap-4">
            <h2 id="cron-tasks-panel" className="sr-only">
              {c.tabMyTasks}
            </h2>
            <div className="flex flex-col gap-3 rounded-xl border border-accent/25 bg-accent/5 px-4 py-3 dark:border-accent/30 dark:bg-accent/10 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex gap-3 text-sm text-fg">
                <Info className="mt-0.5 size-4 shrink-0 text-accent" strokeWidth={1.75} aria-hidden />
                <p className="text-pretty text-fg-muted">{c.wakeBanner}</p>
              </div>
              <div className="flex shrink-0 items-center gap-2 sm:pl-4">
                <span className="text-sm text-fg">{c.keepAwake}</span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={keepAwake}
                  disabled={!wakeSupported}
                  title={!wakeSupported ? c.wakeLockUnavailable : undefined}
                  className={cn(
                    'inline-flex h-6 w-10 shrink-0 items-center rounded-full border border-edge p-0.5 transition-colors',
                    keepAwake ? 'justify-end bg-accent' : 'justify-start bg-surface-hover',
                    !wakeSupported && 'cursor-not-allowed opacity-50',
                  )}
                  onClick={() => {
                    if (!wakeSupported) setError(c.wakeLockUnavailable);
                    else setKeepAwake((v) => !v);
                  }}
                >
                  <span className="size-4 rounded-full bg-surface-panel shadow-surface ring-1 ring-edge/40 dark:ring-edge/55" />
                </button>
              </div>
            </div>

            {loading && jobs.length === 0 ? (
              <div className="flex justify-center py-16" aria-busy="true">
                <Loader2 className="size-8 animate-spin text-accent" strokeWidth={1.75} />
              </div>
            ) : jobs.length === 0 ? (
              <div className="flex flex-col gap-6 rounded-2xl bg-surface-base px-4 py-8 dark:bg-surface-hover/25 sm:px-6 sm:py-10">
                <div className="w-full max-w-3xl">
                  <CronTemplateLibrary
                    cron={c}
                    localeTag={localeTag}
                    scheduleBadgeLabels={scheduleBadgeLabels}
                    categoryFilter={templateCategoryFilter}
                    onCategoryFilterChange={setTemplateCategoryFilter}
                    onSelectTemplate={applyCronTemplate}
                  />
                </div>
                <div className="flex justify-center">
                  <Button type="button" variant="primary" onClick={() => openForm()}>
                    {c.emptyStateCta}
                  </Button>
                </div>
              </div>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2">
                {sortedJobs.map((job) => (
                  <article
                    key={job.id}
                    role="button"
                    tabIndex={0}
                    className={cn(
                      'flex cursor-pointer flex-col rounded-xl border border-edge-subtle bg-surface-base text-left transition-colors duration-150 ease-out dark:border-edge-subtle',
                      'hover:bg-surface-hover',
                      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface-panel',
                    )}
                    onClick={() => {
                      if (absorbCardClickJobIdRef.current === job.id) {
                        absorbCardClickJobIdRef.current = null;
                        return;
                      }
                      void openDetail(job);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        if (absorbCardClickJobIdRef.current === job.id) {
                          absorbCardClickJobIdRef.current = null;
                          return;
                        }
                        void openDetail(job);
                      }
                    }}
                  >
                    <div className="flex items-start justify-between gap-2 px-4 pt-3">
                      <button
                        type="button"
                        role="switch"
                        aria-checked={job.enabled}
                        className={cn(
                          'inline-flex h-6 w-10 shrink-0 items-center rounded-full border border-edge p-0.5 transition-colors',
                          job.enabled ? 'justify-end bg-accent' : 'justify-start bg-surface-hover',
                        )}
                        onClick={(e) => {
                          e.stopPropagation();
                          void onToggle(job, !job.enabled);
                        }}
                      >
                        <span className="size-4 rounded-full bg-surface-panel shadow-surface ring-1 ring-edge/40 dark:ring-edge/55" />
                      </button>
                      <DropdownMenu.Root>
                        <DropdownMenu.Trigger asChild>
                          <Button
                            type="button"
                            variant="ghost"
                            className="h-8 w-8 shrink-0 p-0"
                            aria-label={c.jobCardMenuAria}
                            onClick={(e) => e.stopPropagation()}
                          >
                            <MoreVertical className="size-4" strokeWidth={1.75} />
                          </Button>
                        </DropdownMenu.Trigger>
                        <DropdownMenu.Portal>
                          <DropdownMenu.Content
                            className="z-50 min-w-[10rem] rounded-xl border border-edge-subtle bg-surface-panel p-1 shadow-elevated dark:border-edge-subtle"
                            sideOffset={4}
                            align="end"
                            onCloseAutoFocus={(e) => e.preventDefault()}
                          >
                            <DropdownMenu.Item
                              className="cursor-pointer select-none rounded-lg px-2 py-1.5 text-sm text-fg outline-none data-highlighted:bg-surface-hover"
                              onSelect={() => {
                                scheduleAbsorbNextMenuCardClick(job.id);
                                openForm(job);
                              }}
                            >
                              {c.edit}
                            </DropdownMenu.Item>
                            <DropdownMenu.Item
                              className="cursor-pointer select-none rounded-lg px-2 py-1.5 text-sm text-fg outline-none data-highlighted:bg-surface-hover"
                              onSelect={() => {
                                scheduleAbsorbNextMenuCardClick(job.id);
                                setConfirmAction('run');
                                setConfirmJobId(job.id);
                                setConfirmOpen(true);
                              }}
                            >
                              {c.runNow}
                            </DropdownMenu.Item>
                            <DropdownMenu.Item
                              className="cursor-pointer select-none rounded-lg px-2 py-1.5 text-sm text-red-600 outline-none data-highlighted:bg-red-500/10 dark:text-red-400"
                              onSelect={() => {
                                scheduleAbsorbNextMenuCardClick(job.id);
                                setConfirmAction('delete');
                                setConfirmJobId(job.id);
                                setConfirmOpen(true);
                              }}
                            >
                              {c.delete}
                            </DropdownMenu.Item>
                          </DropdownMenu.Content>
                        </DropdownMenu.Portal>
                      </DropdownMenu.Root>
                    </div>
                    <div className="flex flex-1 flex-col gap-2 px-4 pb-3 pt-2">
                      <h3 className="line-clamp-2 font-semibold text-fg">{job.name || job.id}</h3>
                      <div
                        className="max-h-[4.5rem] overflow-hidden text-sm text-fg-muted [&_.markdown-body]:text-sm [&_.markdown-body]:leading-snug"
                        title={cronJobBodyText(job)}
                      >
                        <MarkdownView content={cronJobBodyText(job)} compact />
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5 border-t border-edge-subtle/90 px-4 py-2.5 text-xs text-fg-muted dark:border-edge-subtle">
                      <Clock className="size-3.5 shrink-0" strokeWidth={1.75} aria-hidden />
                      <span className="min-w-0 truncate">{formatScheduleBadge(job, localeTag, scheduleBadgeLabels)}</span>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>
        ) : (
          <section aria-labelledby="cron-history-panel" className="flex flex-col gap-3">
            <div className="flex items-start justify-between gap-2">
              <div>
                <h2 id="cron-history-panel" className="sr-only">
                  {c.tabRunHistory}
                </h2>
                <p className="text-xs text-fg-muted">{c.runHistoryHint}</p>
              </div>
              <Button
                type="button"
                variant="ghost"
                className="h-9 w-9 shrink-0 p-0"
                disabled={runHistoryLoading}
                title={c.refresh}
                aria-label={c.refresh}
                onClick={() => void loadRunHistoryOnly()}
              >
                <RefreshCw className={cn('size-4', runHistoryLoading && 'animate-spin')} strokeWidth={1.75} />
              </Button>
            </div>
            {runHistoryLoading && runHistory.length === 0 ? (
              <div className="flex justify-center py-16">
                <Loader2 className="size-8 animate-spin text-accent" strokeWidth={1.75} />
              </div>
            ) : filteredRunHistory.length === 0 ? (
              <div className="flex flex-col items-center rounded-2xl border border-dashed border-edge-subtle px-6 py-16 text-center dark:border-edge-subtle">
                <Clock className="mb-4 size-14 text-fg-disabled" strokeWidth={1.1} aria-hidden />
                <h3 className="text-base font-semibold text-fg">
                  {runHistory.length === 0 ? c.emptyHistoryTitle : c.noRunsYet}
                </h3>
                <p className="mt-2 max-w-sm text-sm text-fg-muted">
                  {runHistory.length === 0 ? c.emptyHistoryHint : c.runHistoryHint}
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto rounded-xl border border-edge-subtle bg-surface-base dark:border-edge-subtle">
                <table className="w-full min-w-[700px] border-collapse text-left text-sm">
                  <thead>
                    <tr className="border-b border-edge text-xs font-medium text-fg-muted">
                      <th className="px-3 py-2.5 font-medium">{c.colStarted}</th>
                      <th className="px-3 py-2.5 font-medium">{c.colJob}</th>
                      <th className="px-3 py-2.5 font-medium">{c.status}</th>
                      <th className="px-3 py-2.5 font-medium">{c.colDuration}</th>
                      <th className="px-3 py-2.5 font-medium">{c.colDetail}</th>
                      <th className="px-3 py-2.5 font-medium">{c.colChat}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredRunHistory.map((row) => (
                      <tr key={row.id} className="border-b border-edge/60 last:border-0">
                        <td className="whitespace-nowrap px-3 py-2.5 text-fg">
                          <time dateTime={row.startedAt}>{formatTime(row.startedAt)}</time>
                        </td>
                        <td className="max-w-[10rem] truncate px-3 py-2.5">
                          {jobs.some((j) => j.id === row.jobId) ? (
                            <button
                              type="button"
                              className="text-left text-accent hover:underline"
                              onClick={() => {
                                const j = jobs.find((x) => x.id === row.jobId);
                                if (j) void openDetail(j);
                              }}
                            >
                              {row.jobName || row.jobId}
                            </button>
                          ) : (
                            <span className="text-fg-muted">{row.jobName || row.jobId}</span>
                          )}
                        </td>
                        <td className="px-3 py-2.5">
                          <span
                            className={cn(
                              'inline-flex rounded-md px-2 py-0.5 text-xs font-medium',
                              row.status === 'success' && 'bg-emerald-500/15 text-emerald-800 dark:text-emerald-300',
                              row.status === 'failed' && 'bg-red-500/15 text-red-800 dark:text-red-300',
                              row.status === 'running' && 'bg-accent/15 text-accent',
                              row.status === 'cancelled' && 'bg-surface-hover text-fg-muted',
                            )}
                          >
                            {execStatusLabel(row.status, statusLabels)}
                          </span>
                        </td>
                        <td className="whitespace-nowrap px-3 py-2.5 text-fg-muted">
                          {formatDuration(row.duration)}
                        </td>
                        <td
                          className="max-w-xs truncate px-3 py-2.5 text-fg-muted"
                          title={row.summary || row.error || ''}
                        >
                          {truncate(row.summary || row.error, 96)}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2.5">
                          {row.sessionKey?.trim() ? (
                            <button
                              type="button"
                              className="text-xs font-medium text-accent hover:underline"
                              title={c.openChatTitle}
                              aria-label={c.openChatTitle}
                              onClick={() => navigateToSessionChat(row.sessionKey)}
                            >
                              {c.openChat}
                            </button>
                          ) : (
                            <span className="text-fg-disabled">—</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        )}
      </div>

      {/* Form dialog */}
      <Dialog.Root open={formOpen} onOpenChange={(o) => !o && closeForm()}>
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
                <Button type="button" variant="ghost" className="h-9 w-9 shrink-0 p-0" aria-label={c.close}>
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
                    onChange={(e) => setFormName(e.target.value)}
                    placeholder={c.namePlaceholder}
                  />
                </label>
                <CronSchedulePicker
                  value={formSchedule}
                  onChange={setFormSchedule}
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
                      setFormSessionTarget(v);
                      if (v === 'main') {
                        setFormAgentLocalOnly(false);
                        setFormAgentId('');
                        setFormWorkingDirectory('');
                      } else if (v === 'isolated' && !formModel.trim()) setFormModel(defaultModelForForm());
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
                        onChange={(id) => {
                          formModelUserTouched.current = true;
                          setFormModel(id);
                        }}
                      />
                    </div>
                    <label className="flex flex-col gap-1">
                      <span className="text-xs font-medium text-fg-muted">{c.agentProfile}</span>
                      <select
                        className={selectClassName()}
                        value={formAgentId}
                        disabled={formSubmitting}
                        onChange={(e) => setFormAgentId(e.target.value)}
                      >
                        <option value="">{c.agentProfileDefault}</option>
                        {cronAgentSelectOptions.map((ag) => (
                          <option key={ag.id} value={ag.id}>
                            {ag.name ? `${ag.id} — ${ag.name}` : ag.id}
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
                                const picked = await openNativeFolderPickerCron();
                                if (picked) void applyCronWorkingDirectory(picked);
                              })();
                            } else {
                              setFormWdModalOpen(true);
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
                            onClick={() => setFormWorkingDirectory('')}
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
                        onChange={(e) => setFormAgentLocalOnly(e.target.checked)}
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
                          setFormChannel(v);
                          if (v === 'local') setFormAgentLocalOnly(false);
                          setFormChatId('');
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
                            onClick={() => void getSessionChatIds(formChannel).then(setSessionChatIds)}
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
                            onChange={(e) => setFormChatId(e.target.value)}
                            placeholder={c.recipientPlaceholder}
                          />
                          <select
                            className={cronRecipientSelectClass}
                            value={formChatId}
                            onChange={(e) => {
                              const v = e.target.value;
                              if (v) setFormChatId(v);
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
                        onClick={() => setMessageMdMode('edit')}
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
                        onClick={() => setMessageMdMode('preview')}
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
                        onChange={setFormMessage}
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
              <Button type="button" variant="secondary" onClick={closeForm}>
                {c.cancel}
              </Button>
              <Button
                type="button"
                variant="primary"
                disabled={formSubmitting || !canSubmit}
                onClick={() => void submitForm()}
              >
                {formSubmitting ? c.loading : formMode === 'edit' ? c.save : c.create}
              </Button>
            </div>
            </Dialog.Content>
          </div>
        </Dialog.Portal>
      </Dialog.Root>

      {!hasElectronFolderPicker ? (
        <WorkingDirectoryPickerModal
          open={formWdModalOpen}
          onOpenChange={setFormWdModalOpen}
          initialAbsolutePath={formWorkingDirectory.trim() || undefined}
          onConfirm={async (p) => {
            await applyCronWorkingDirectory(p);
            setFormWdModalOpen(false);
          }}
          wd={chatM.workingDirectory}
        />
      ) : null}

      {/* Template picker (when jobs already exist) */}
      <Dialog.Root
        open={templatePickerOpen}
        onOpenChange={(o) => {
          setTemplatePickerOpen(o);
          if (o) setTemplateCategoryFilter('all');
        }}
      >
        <Dialog.Portal>
          <Dialog.Overlay className="xopc-dialog-overlay fixed inset-0 z-[62] bg-scrim" />
          <div className="fixed inset-0 z-[62] flex items-center justify-center p-4 pointer-events-none">
            <Dialog.Content
              className="xopc-dialog-content-pane pointer-events-auto relative flex max-h-[min(90vh,840px)] w-full max-w-lg flex-col rounded-xl border border-edge bg-surface-panel shadow-popover outline-none sm:max-w-2xl dark:border-edge"
              onOpenAutoFocus={(e) => e.preventDefault()}
            >
              <div className="flex shrink-0 items-center justify-end border-b border-edge px-4 py-3">
                <Dialog.Title className="sr-only">{c.fromTemplate}</Dialog.Title>
                <Dialog.Close asChild>
                  <Button type="button" variant="ghost" className="h-9 w-9 shrink-0 p-0" aria-label={c.close}>
                    <X className="size-5" strokeWidth={1.75} />
                  </Button>
                </Dialog.Close>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
                <CronTemplateLibrary
                  cron={c}
                  localeTag={localeTag}
                  scheduleBadgeLabels={scheduleBadgeLabels}
                  categoryFilter={templateCategoryFilter}
                  onCategoryFilterChange={setTemplateCategoryFilter}
                  onSelectTemplate={applyCronTemplate}
                />
              </div>
            </Dialog.Content>
          </div>
        </Dialog.Portal>
      </Dialog.Root>

      {/* Detail drawer */}
      <Dialog.Root
        open={detailOpen}
        onOpenChange={(o) => {
          if (!o) {
            setDetailOpen(false);
            setDetailJob(null);
          }
        }}
      >
        <Dialog.Portal>
          <Dialog.Overlay className="xopc-dialog-overlay fixed inset-0 z-[60] bg-scrim" />
          <Dialog.Content
            className={cn(
              'xopc-drawer-right fixed right-0 top-0 z-[60] flex h-full w-full max-w-lg flex-col border-l border-edge bg-surface-panel shadow-popover outline-none',
              'dark:border-edge',
            )}
            aria-describedby={undefined}
          >
            <div className="flex shrink-0 items-center justify-between gap-2 border-b border-edge px-4 py-3">
              <Dialog.Title className="min-w-0 truncate text-base font-semibold text-fg">
                {detailJob?.name?.trim() || detailJob?.id || '—'}
              </Dialog.Title>
              <Dialog.Close asChild>
                <Button type="button" variant="ghost" className="h-9 w-9 shrink-0 p-0" aria-label={c.close}>
                  <X className="size-5" strokeWidth={1.75} />
                </Button>
              </Dialog.Close>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
              {detailLoading ? (
                <div className="flex justify-center py-16">
                  <Loader2 className="size-8 animate-spin text-accent" strokeWidth={1.75} />
                </div>
              ) : detailJob ? (
                <>
                  <dl className="space-y-3 text-sm">
                    <div>
                      <dt className="text-xs font-medium text-fg-muted">{c.scheduleLabel}</dt>
                      <dd className="mt-1 font-mono text-fg">
                        <code>{detailJob.schedule}</code>
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs font-medium text-fg-muted">{c.messageLabel}</dt>
                      <dd className="mt-1 min-w-0 break-words text-fg">
                        <MarkdownView content={cronJobBodyText(detailJob)} compact className="text-sm" />
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs font-medium text-fg-muted">{c.mode}</dt>
                      <dd className="mt-1 text-fg">
                        {detailJob.sessionTarget === 'isolated' ? c.modeAgentOption : c.modeDirectOption}
                      </dd>
                    </div>
                    {detailJob.sessionTarget === 'isolated' ? (
                      <div>
                        <dt className="text-xs font-medium text-fg-muted">{c.agentProfile}</dt>
                        <dd className="mt-1 font-mono text-sm text-fg">
                          {detailJob.agentId?.trim() ? detailJob.agentId.trim() : c.agentProfileDefault}
                        </dd>
                      </div>
                    ) : null}
                    {detailJob.sessionTarget === 'isolated' ? (
                      <div>
                        <dt className="text-xs font-medium text-fg-muted">{c.workingDirectoryLabel}</dt>
                        <dd className="mt-1 break-all font-mono text-xs text-fg">
                          {detailJob.workingDirectory?.trim()
                            ? detailJob.workingDirectory.trim()
                            : chatM.workingDirectory.notSet}
                        </dd>
                      </div>
                    ) : null}
                    {detailJob.delivery?.channel === 'local' ||
                    (detailJob.sessionTarget === 'isolated' && !detailJob.delivery?.to) ? (
                      <div>
                        <dt className="text-xs font-medium text-fg-muted">{c.deliveryTarget}</dt>
                        <dd className="mt-1 text-fg">
                          {detailJob.delivery?.channel === 'local'
                            ? c.deliveryTargetLocalChannel
                            : c.deliveryLocalOnly}
                        </dd>
                      </div>
                    ) : detailJob.delivery?.to ? (
                      <div>
                        <dt className="text-xs font-medium text-fg-muted">{c.deliveryTarget}</dt>
                        <dd className="mt-1 break-words text-fg">
                          <code className="text-xs">{detailJob.delivery?.channel ?? ''}</code>
                          {' → '}
                          {formatDeliveryToSummary(detailJob, c.channelLocal)}
                        </dd>
                      </div>
                    ) : null}
                    <div>
                      <dt className="text-xs font-medium text-fg-muted">{c.status}</dt>
                      <dd className="mt-1 text-fg">{detailJob.enabled ? c.enabled : c.disabled}</dd>
                    </div>
                    <div>
                      <dt className="text-xs font-medium text-fg-muted">{c.nextRun}</dt>
                      <dd className="mt-1 text-fg">
                        {detailJob.next_run ? formatNextRun(detailJob.next_run, c.timeLabels) : '—'}
                      </dd>
                    </div>
                  </dl>
                  <h3 className="mt-6 text-sm font-semibold text-fg">{c.detailRunHistory}</h3>
                  {detailHistory.length === 0 ? (
                    <p className="mt-2 text-sm text-fg-muted">{c.noRunsYet}</p>
                  ) : (
                    <div className="mt-2 overflow-x-auto">
                      <table className="w-full border-collapse text-left text-xs">
                        <thead>
                          <tr className="border-b border-edge text-fg-muted">
                            <th className="py-1.5 pr-2 font-medium">{c.colStarted}</th>
                            <th className="py-1.5 pr-2 font-medium">{c.status}</th>
                            <th className="py-1.5 pr-2 font-medium">{c.colDuration}</th>
                            <th className="py-1.5 pr-2 font-medium">{c.colDetail}</th>
                            <th className="py-1.5 font-medium">{c.colChat}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {detailHistory.map((row) => (
                            <tr key={row.id} className="border-b border-edge/60">
                              <td className="whitespace-nowrap py-1.5 pr-2 text-fg">
                                <time dateTime={row.startedAt}>{formatTime(row.startedAt)}</time>
                              </td>
                              <td className="py-1.5 pr-2">
                                <span
                                  className={cn(
                                    'inline-flex rounded px-1.5 py-0.5 font-medium',
                                    row.status === 'success' &&
                                      'bg-emerald-500/15 text-emerald-800 dark:text-emerald-300',
                                    row.status === 'failed' && 'bg-red-500/15 text-red-800 dark:text-red-300',
                                  )}
                                >
                                  {execStatusLabel(row.status, statusLabels)}
                                </span>
                              </td>
                              <td className="py-1.5 pr-2 text-fg-muted">{formatDuration(row.duration)}</td>
                              <td
                                className="max-w-[8rem] truncate py-1.5 pr-2 text-fg-muted"
                                title={row.summary || row.error || ''}
                              >
                                {truncate(row.summary || row.error, 120)}
                              </td>
                              <td className="whitespace-nowrap py-1.5">
                                {row.sessionKey?.trim() ? (
                                  <button
                                    type="button"
                                    className="text-xs font-medium text-accent hover:underline"
                                    title={c.openChatTitle}
                                    aria-label={c.openChatTitle}
                                    onClick={() => navigateToSessionChat(row.sessionKey)}
                                  >
                                    {c.openChat}
                                  </button>
                                ) : (
                                  <span className="text-fg-disabled">—</span>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </>
              ) : null}
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      {/* Confirm run/delete */}
      <Dialog.Root open={confirmOpen} onOpenChange={setConfirmOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="xopc-dialog-overlay fixed inset-0 z-[70] bg-scrim" />
          <div className="fixed inset-0 z-[70] flex items-center justify-center p-4 pointer-events-none">
            <Dialog.Content className="xopc-dialog-content-pane pointer-events-auto relative w-full max-w-md rounded-xl border border-edge bg-surface-panel p-4 shadow-popover dark:border-edge">
            <Dialog.Title className="text-base font-semibold text-fg">
              {confirmAction === 'delete' ? c.delete : c.runNow}
            </Dialog.Title>
            <p className="mt-2 text-sm text-fg-muted">
              {confirmAction === 'delete' ? c.confirmDelete : c.confirmRun}
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <Button
                type="button"
                variant="secondary"
                onClick={() => {
                  setConfirmOpen(false);
                  setConfirmJobId(null);
                  setConfirmAction(null);
                }}
              >
                {c.cancel}
              </Button>
              <Button
                type="button"
                variant="primary"
                className={confirmAction === 'delete' ? 'bg-red-600 hover:bg-red-700' : undefined}
                onClick={() => void runConfirm()}
              >
                {confirmAction === 'delete' ? c.delete : c.runNow}
              </Button>
            </div>
            </Dialog.Content>
          </div>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}
