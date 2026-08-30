import * as Dialog from '@radix-ui/react-dialog';
import {
  ArrowLeft,
  AlertTriangle,
  Check,
  CircleCheck,
  ExternalLink,
  FileDiff,
  FolderKanban,
  History,
  Loader2,
  MessageSquareCode,
  PanelLeft,
  Power,
  PowerOff,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';
import { type FormEvent, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import useSWR, { useSWRConfig } from 'swr';

import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { TabCompletionInput, TabCompletionTextarea } from '@/components/ui/tab-completion-input';
import { suggestionFromExample } from '@/components/ui/tab-completion-input.utils';
import {
  createLocalApp,
  getLocalApp,
  installLocalApp,
  recordLocalAppAcceptance,
  rollbackLocalApp,
  setLocalAppEnabled,
  uninstallLocalApp,
  validateLocalApp,
  type LocalAppDetail,
  type LocalAppAcceptanceRun,
  type LocalAppValidationResult,
} from '@/features/local-apps/api';
import {
  localAppConversationUrl,
  selectLocalAppCoderSession,
} from '@/features/local-apps/conversation';
import {
  formatLocalAppRuntimeIssue,
  getLocalAppAcceptanceFailures,
  parseLocalAppRuntimeMessage,
  type LocalAppAcceptanceResult,
  type LocalAppCriteriaScenarioResult,
  type LocalAppRuntimeIssue,
} from '@/features/local-apps/runtime-health';
import { attachLocalAppPreviewChannel } from '@/features/local-apps/preview-channel';
import {
  AcceptanceScenarioList,
  type LocalAppAcceptanceScenarioSummary,
} from '@/features/local-apps/acceptance-scenario-list';
import { createProjectSession, fetchProjectSessions } from '@/features/projects/api';
import { apiUrl } from '@/lib/url';
import { useLocaleStore } from '@/stores/locale-store';
import { useNavOrderStore } from '@/stores/nav-order-store';
import { usePageHeaderStore } from '@/stores/page-header-store';
import { formatShortMonthDateTime } from '@/lib/date-formatters';

const LOCAL_APP_PREVIEW_SANDBOX = 'allow-scripts allow-forms';

function formatReleaseDate(timestamp: number, language: string): string {
  return formatShortMonthDateTime(timestamp, language);
}

function acceptanceRunMatches(
  run: LocalAppAcceptanceRun,
  sourceHash: string | null,
  result: LocalAppAcceptanceResult | null,
): boolean {
  return Boolean(sourceHash
    && result
    && run.sourceHash === sourceHash
    && run.status === result.status
    && run.interactiveCount === result.interactiveCount
    && JSON.stringify(run.checks) === JSON.stringify(result.checks));
}

export function LocalAppWorkbenchPage() {
  const { appId } = useParams<{ appId: string }>();
  const isNew = appId === 'new';
  const zh = useLocaleStore((state) => state.language) === 'zh';
  const language = useLocaleStore((state) => state.language);
  const navigate = useNavigate();
  const { mutate } = useSWRConfig();
  const moveToFront = useNavOrderStore((state) => state.moveToFront);
  const setPageHeader = usePageHeaderStore((state) => state.setPageHeader);
  const clearPageHeader = usePageHeaderStore((state) => state.clearPageHeader);
  const { data: app, isLoading, error, mutate: mutateApp } = useSWR(!isNew && appId ? ['local-app', appId] : null, () => getLocalApp(appId!));
  const {
    data: validation,
    isLoading: validationLoading,
    mutate: mutateValidation,
  } = useSWR(!isNew && appId ? ['local-app-validation', appId] : null, () => validateLocalApp(appId!));
  const [name, setName] = useState('');
  const [idea, setIdea] = useState('');
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [uninstallOpen, setUninstallOpen] = useState(false);
  const [previewKey, setPreviewKey] = useState(0);
  const [changeRequest, setChangeRequest] = useState('');
  const [chatBusy, setChatBusy] = useState(false);
  const [checkingDraft, setCheckingDraft] = useState(false);
  const [runtimeHealth, setRuntimeHealth] = useState<'booting' | 'healthy' | 'failed' | 'timeout'>('booting');
  const [runtimeIssue, setRuntimeIssue] = useState<LocalAppRuntimeIssue | null>(null);
  const [baseAcceptanceResult, setBaseAcceptanceResult] = useState<LocalAppAcceptanceResult | null>(null);
  const [criteriaResults, setCriteriaResults] = useState<Record<string, LocalAppCriteriaScenarioResult>>({});
  const [criteriaRunTarget, setCriteriaRunTarget] = useState<'all' | string>('all');
  const [criteriaScenarioIndex, setCriteriaScenarioIndex] = useState(0);
  const [criteriaRunKey, setCriteriaRunKey] = useState(0);
  const [criteriaRunningTarget, setCriteriaRunningTarget] = useState<'all' | string | null>(null);
  const [acceptanceSourceHash, setAcceptanceSourceHash] = useState<string | null>(null);
  const [acceptanceHistory, setAcceptanceHistory] = useState<LocalAppAcceptanceRun[]>([]);
  const [savingAcceptance, setSavingAcceptance] = useState(false);
  const coderSessionKeysRef = useRef(new Set<string>());
  const validationTimerRef = useRef<number | null>(null);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const criteriaIframeRef = useRef<HTMLIFrameElement | null>(null);
  const previewSourceHashRef = useRef<string | null>(null);
  const acceptancePersistKeyRef = useRef('');
  const acceptanceScenarios = validation?.acceptanceScenarios ?? [];
  const criteriaResult = useMemo(() => {
    if (!acceptanceScenarios.length) return null;
    const scenarios = acceptanceScenarios
      .map((scenario) => criteriaResults[scenario.id])
      .filter((result): result is LocalAppCriteriaScenarioResult => Boolean(result));
    if (scenarios.length !== acceptanceScenarios.length) return null;
    return {
      status: scenarios.some((scenario) => scenario.status === 'failed') ? 'failed' as const : 'passed' as const,
      scenarioCount: acceptanceScenarios.length,
      scenarios,
    };
  }, [acceptanceScenarios, criteriaResults]);
  const acceptanceResult = useMemo<LocalAppAcceptanceResult | null>(() => {
    if (!baseAcceptanceResult) return null;
    if (!validation?.acceptanceScenarioCount) return baseAcceptanceResult;
    if (!criteriaResult) return null;
    const failedScenario = criteriaResult.scenarios.find((scenario) => scenario.status === 'failed');
    const criteriaCheck = {
      id: 'criteria' as const,
      status: criteriaResult.status,
      message: failedScenario
        ? `${failedScenario.name}: ${failedScenario.message}`
        : `${criteriaResult.scenarioCount} product scenario(s) passed`,
    };
    const checks = [...baseAcceptanceResult.checks, criteriaCheck];
    return {
      status: checks.some((check) => check.status === 'failed') ? 'failed' : 'passed',
      checks,
      interactiveCount: baseAcceptanceResult.interactiveCount,
    };
  }, [baseAcceptanceResult, criteriaResult, validation?.acceptanceScenarioCount]);

  const openCoderConversation = useCallback(async (targetApp: LocalAppDetail, draft?: string) => {
    const sessions = await fetchProjectSessions(targetApp.projectId);
    const session = selectLocalAppCoderSession(sessions)
      ?? await createProjectSession(targetApp.projectId, 'coder');
    coderSessionKeysRef.current.add(session.key);
    navigate(localAppConversationUrl(session.key, draft));
  }, [navigate]);

  const runDraftChecks = useCallback(async (refreshPreview = true): Promise<LocalAppValidationResult | null> => {
    if (!app) return null;
    setCheckingDraft(true);
    try {
      const next = await validateLocalApp(app.id);
      await mutateValidation(next, { revalidate: false });
      if (refreshPreview) {
        previewSourceHashRef.current = next.sourceHash ?? null;
        setCriteriaRunTarget('all');
        setCriteriaScenarioIndex(0);
        setPreviewKey((value) => value + 1);
      }
      return next;
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : String(cause));
      return null;
    } finally {
      setCheckingDraft(false);
    }
  }, [app, mutateValidation]);

  useEffect(() => {
    if (!app) return;
    let cancelled = false;
    void fetchProjectSessions(app.projectId).then((sessions) => {
      if (cancelled) return;
      coderSessionKeysRef.current = new Set(
        sessions
          .filter((session) => (session.routing?.agentId ?? session.agentId)?.toLowerCase() === 'coder')
          .map((session) => session.key),
      );
    }).catch(() => {});
    const onTranscriptUpdate = (event: Event) => {
      const key = (event as CustomEvent<{ key?: string }>).detail?.key;
      if (!key || !coderSessionKeysRef.current.has(key)) return;
      if (validationTimerRef.current !== null) window.clearTimeout(validationTimerRef.current);
      validationTimerRef.current = window.setTimeout(() => {
        validationTimerRef.current = null;
        void runDraftChecks(true);
      }, 750);
    };
    window.addEventListener('session-transcript-updated', onTranscriptUpdate);
    return () => {
      cancelled = true;
      window.removeEventListener('session-transcript-updated', onTranscriptUpdate);
      if (validationTimerRef.current !== null) window.clearTimeout(validationTimerRef.current);
    };
  }, [app, runDraftChecks]);

  useEffect(() => {
    setAcceptanceHistory(app?.acceptanceRuns ?? []);
  }, [app?.acceptanceRuns]);

  useEffect(() => {
    previewSourceHashRef.current = null;
  }, [app?.id]);

  useEffect(() => {
    if (!validation?.sourceHash || previewSourceHashRef.current) return;
    previewSourceHashRef.current = validation.sourceHash;
    setCriteriaRunTarget('all');
    setCriteriaScenarioIndex(0);
    setPreviewKey((value) => value + 1);
  }, [validation?.sourceHash]);

  useLayoutEffect(() => {
    if (!app) return;
    setRuntimeHealth('booting');
    setRuntimeIssue(null);
    setBaseAcceptanceResult(null);
    setAcceptanceSourceHash(null);
    setSavingAcceptance(false);
    acceptancePersistKeyRef.current = '';
    const timeout = window.setTimeout(() => setRuntimeHealth((current) => (
      current === 'failed' ? current : 'timeout'
    )), 7_000);
    const onPreviewMessage = (value: unknown) => {
      const message = parseLocalAppRuntimeMessage(value);
      if (!message) return;
      if (message.type === 'ready') {
        setRuntimeHealth((current) => current === 'failed' ? current : 'healthy');
        return;
      }
      if (message.type === 'acceptance') {
        window.clearTimeout(timeout);
        setBaseAcceptanceResult(message.detail);
        setAcceptanceSourceHash(previewSourceHashRef.current);
        return;
      }
      if (message.type === 'criteria') return;
      window.clearTimeout(timeout);
      setRuntimeIssue(message.detail);
      setRuntimeHealth('failed');
    };
    const detachChannel = iframeRef.current
      ? attachLocalAppPreviewChannel(iframeRef.current, onPreviewMessage)
      : () => {};
    return () => {
      window.clearTimeout(timeout);
      detachChannel();
    };
  }, [app, previewKey]);

  useLayoutEffect(() => {
    if (!app || validation?.status !== 'healthy' || !acceptanceScenarios.length) {
      setCriteriaRunningTarget(null);
      return;
    }
    const activeScenario = criteriaRunTarget === 'all'
      ? acceptanceScenarios[criteriaScenarioIndex]
      : acceptanceScenarios.find((scenario) => scenario.id === criteriaRunTarget);
    const targetScenarios = activeScenario ? [activeScenario] : [];
    if (!targetScenarios.length) return;
    setCriteriaRunningTarget(criteriaRunTarget);
    setCriteriaResults((current) => {
      if (criteriaRunTarget === 'all' && criteriaScenarioIndex === 0) return {};
      const next = { ...current };
      delete next[criteriaRunTarget];
      return next;
    });
    let runnerReady = false;
    const failTargetScenarios = (message: string) => {
      setCriteriaResults((current) => {
        const next = { ...current };
        for (const scenario of targetScenarios) {
          next[scenario.id] = {
            id: scenario.id,
            name: scenario.name,
            status: 'failed',
            message,
            failureKind: 'runner',
          };
        }
        return next;
      });
      setCriteriaRunningTarget(null);
    };
    const timeout = window.setTimeout(() => failTargetScenarios(runnerReady
      ? (zh ? '场景在 10 秒内未完成。' : 'Scenario did not finish within 10 seconds.')
      : (zh ? '验收执行器未能连接，请重新验收。' : 'The acceptance runner did not connect. Run acceptance again.')),
    10_000);
    const onCriteriaMessage = (value: unknown) => {
      const message = parseLocalAppRuntimeMessage(value);
      if (!message) return;
      if (message.type === 'ready') {
        runnerReady = true;
      } else if (message.type === 'criteria') {
        window.clearTimeout(timeout);
        setCriteriaResults((current) => {
          const next = { ...current };
          for (const result of message.detail.scenarios) {
            if (next[result.id]?.status !== 'failed' || result.status === 'failed') next[result.id] = result;
          }
          return next;
        });
        if (criteriaRunTarget === 'all' && criteriaScenarioIndex + 1 < acceptanceScenarios.length) {
          setCriteriaScenarioIndex((value) => value + 1);
          setCriteriaRunKey((value) => value + 1);
        } else {
          setCriteriaRunningTarget(null);
        }
      } else if (message.type === 'error') {
        window.clearTimeout(timeout);
        failTargetScenarios(formatLocalAppRuntimeIssue(message.detail));
      }
    };
    const detachChannel = criteriaIframeRef.current
      ? attachLocalAppPreviewChannel(criteriaIframeRef.current, onCriteriaMessage)
      : () => {};
    return () => {
      window.clearTimeout(timeout);
      detachChannel();
    };
  }, [acceptanceScenarios, app, criteriaRunKey, criteriaRunTarget, criteriaScenarioIndex, previewKey, validation?.status, zh]);

  useEffect(() => {
    if (!app || !acceptanceResult || !acceptanceSourceHash) return;
    if (acceptanceSourceHash !== validation?.sourceHash) return;
    const key = `${app.id}:${acceptanceSourceHash}:${JSON.stringify(acceptanceResult)}`;
    if (acceptancePersistKeyRef.current === key) return;
    acceptancePersistKeyRef.current = key;
    setSavingAcceptance(true);
    void recordLocalAppAcceptance(app.id, acceptanceSourceHash, acceptanceResult).then((run) => {
      if (acceptancePersistKeyRef.current !== key) return;
      setAcceptanceHistory((current) => [run, ...current.filter((item) => item.id !== run.id)]
        .toSorted((a, b) => b.createdAt - a.createdAt)
        .slice(0, 20));
    }).catch((cause) => {
      if (acceptancePersistKeyRef.current !== key) return;
      acceptancePersistKeyRef.current = '';
      setActionError(cause instanceof Error ? cause.message : String(cause));
    }).finally(() => {
      if (acceptancePersistKeyRef.current === key) setSavingAcceptance(false);
    });
  }, [acceptanceResult, acceptanceSourceHash, app, validation?.sourceHash]);

  const onContinueDevelopment = useCallback(async (draft?: string) => {
    if (!app) return;
    setChatBusy(true);
    setActionError(null);
    try {
      await openCoderConversation(app, draft);
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : String(cause));
      setChatBusy(false);
    }
  }, [app, openCoderConversation]);

  useLayoutEffect(() => {
    setPageHeader({
      startExtra: <Link to="/local-apps" className="rounded-lg p-1.5 text-fg-muted hover:bg-surface-hover hover:text-fg" aria-label={zh ? '返回本地应用' : 'Back to local apps'}><ArrowLeft className="size-4" /></Link>,
      main: <h1 className="truncate text-base font-semibold tracking-tight text-fg">{app?.name || (zh ? '创建本地应用' : 'Create local app')}</h1>,
      end: app ? <div className="flex items-center gap-2"><Button asChild variant="ghost" className="h-9"><Link to={`/projects/${encodeURIComponent(app.projectId)}`}><FolderKanban className="size-4" />{zh ? 'Project' : 'Project'}</Link></Button><Button className="h-9" onClick={() => void onContinueDevelopment()} disabled={chatBusy}>{chatBusy ? <Loader2 className="size-4 animate-spin" /> : <MessageSquareCode className="size-4" />}{zh ? '继续开发' : 'Continue building'}</Button></div> : null,
    });
    return () => clearPageHeader();
  }, [app, chatBusy, clearPageHeader, onContinueDevelopment, setPageHeader, zh]);

  async function onCreate(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setActionError(null);
    try {
      const created = await createLocalApp({ name, idea });
      await mutate('local-apps-list');
      const initialRequest = zh
        ? '请基于 APP_BRIEF.md 完成这个本地应用的首版。先检查现有草稿，再实现最小可用版本并运行校验；完成后告诉我可以如何预览。'
        : 'Build the first usable version of this local app from APP_BRIEF.md. Inspect the existing draft, implement the smallest useful version, run validation, and tell me how to preview it.';
      try {
        await openCoderConversation(created, initialRequest);
      } catch {
        navigate(`/local-apps/${encodeURIComponent(created.id)}`, { replace: true });
      }
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  async function onInstall() {
    if (!app) return;
    setBusy(true);
    setActionError(null);
    try {
      const installed = await installLocalApp(app.id);
      await mutateApp(installed, { revalidate: false });
      await mutateValidation();
      await Promise.all([mutate('local-apps-list'), mutate('gateway-extensions-list')]);
      moveToFront(`ext:${installed.extensionId}:app`);
      setReviewOpen(false);
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  async function applyLifecycleAction(action: () => Promise<LocalAppDetail>, pin = false) {
    setBusy(true);
    setActionError(null);
    try {
      const next = await action();
      await mutateApp(next, { revalidate: false });
      await mutateValidation();
      await Promise.all([mutate('local-apps-list'), mutate('gateway-extensions-list')]);
      if (pin) moveToFront(`ext:${next.extensionId}:app`);
      return true;
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : String(cause));
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function onSetEnabled(enabled: boolean) {
    if (!app) return;
    await applyLifecycleAction(() => setLocalAppEnabled(app.id, enabled), enabled);
  }

  async function onRollback(releaseId: string) {
    if (!app) return;
    await applyLifecycleAction(() => rollbackLocalApp(app.id, releaseId), true);
  }

  async function onUninstall() {
    if (!app) return;
    const ok = await applyLifecycleAction(() => uninstallLocalApp(app.id));
    if (ok) setUninstallOpen(false);
  }

  function onAskCoderToFix() {
    const diagnostics = Array.from(new Set([
      ...(validation?.issues.map((issue) => issue.message) ?? []),
      ...(runtimeIssue ? [formatLocalAppRuntimeIssue(runtimeIssue)] : []),
      ...(acceptanceResult?.checks
        .filter((check) => check.status === 'failed' && check.id !== 'criteria')
        .map((check) => check.message) ?? []),
      ...Object.values(criteriaResults)
        .filter((result) => result.status === 'failed')
        .map((result) => `${result.name}: ${result.failureKind === 'runner' ? '[验收执行器] ' : ''}${result.message}`),
      ...(runtimeHealth === 'timeout'
        ? [zh ? '预览在 7 秒内未完成启动，可能存在白屏或阻塞。' : 'The preview did not finish booting within 7 seconds and may be blank or blocked.']
        : []),
    ]));
    if (!diagnostics.length) return;
    const issueList = diagnostics.map((message) => `- ${message}`).join('\n');
    const prompt = zh
      ? `请修复当前本地应用草稿的校验问题，保持扩展 ID 和已安装版本不变。先复现并判断问题来自应用行为还是验收执行器，不要通过弱化断言绕过问题。修复后运行完整校验。\n\n${issueList}`
      : `Fix the current local-app draft validation issues without changing the extension id or installed release. Reproduce first and determine whether each issue comes from app behavior or the acceptance runner; do not weaken assertions to bypass it. Run the full validation afterward.\n\n${issueList}`;
    void onContinueDevelopment(prompt);
  }

  function onRunAllScenarios() {
    setCriteriaRunTarget('all');
    setCriteriaScenarioIndex(0);
    setCriteriaRunKey((value) => value + 1);
  }

  function onRunScenario(scenarioId: string) {
    setCriteriaRunTarget(scenarioId);
    setCriteriaScenarioIndex(0);
    setCriteriaRunKey((value) => value + 1);
  }

  function onAskCoderToFixScenario(
    scenario: LocalAppAcceptanceScenarioSummary,
    result: LocalAppCriteriaScenarioResult,
  ) {
    const source = result.failureKind === 'runner'
      ? (zh ? '验收执行器' : 'acceptance runner')
      : (zh ? '产品场景' : 'product scenario');
    const prompt = zh
      ? `请修复本地应用的${source}问题“${scenario.name}”。当前失败信息：${result.message}\n\n保持扩展 ID 和场景原意不变；先复现并判断问题来自应用行为还是验收执行器，不要通过弱化断言绕过问题。修复后运行完整校验。`
      : `Fix the local-app ${source} issue "${scenario.name}". Current failure: ${result.message}\n\nPreserve the extension id and scenario intent. Reproduce first and determine whether the issue comes from app behavior or the runner; do not weaken assertions to bypass it. Run the full validation afterward.`;
    void onContinueDevelopment(prompt);
  }

  const currentAcceptanceIndex = acceptanceHistory.findIndex((run) => (
    acceptanceRunMatches(run, acceptanceSourceHash, acceptanceResult)
  ));
  const currentAcceptanceRun = currentAcceptanceIndex >= 0
    ? acceptanceHistory[currentAcceptanceIndex]
    : null;
  const previousAcceptanceRun = currentAcceptanceIndex >= 0
    ? acceptanceHistory[currentAcceptanceIndex + 1] ?? null
    : acceptanceHistory[0] ?? null;
  const currentAcceptanceFailures = getLocalAppAcceptanceFailures(acceptanceResult);
  const previousAcceptanceFailures = previousAcceptanceRun
    ? previousAcceptanceRun.checks.filter((check) => check.status === 'failed').map((check) => check.message)
    : [];
  const hasCoderFixableIssue = validation?.status === 'failed'
    || runtimeHealth === 'failed'
    || runtimeHealth === 'timeout'
    || acceptanceResult?.status === 'failed'
    || Object.values(criteriaResults).some((result) => result.status === 'failed');
  const fixedAcceptanceCount = previousAcceptanceFailures.filter((message) => (
    !currentAcceptanceFailures.includes(message)
  )).length;

  async function onReviewInstall() {
    const result = await runDraftChecks(false);
    if (result?.status === 'healthy' && result.sourceHash !== acceptanceSourceHash) {
      previewSourceHashRef.current = result.sourceHash ?? null;
      setCriteriaScenarioIndex(0);
      setPreviewKey((value) => value + 1);
      return;
    }
    if (result?.status === 'healthy'
      && runtimeHealth === 'healthy'
      && acceptanceResult?.status === 'passed'
      && currentAcceptanceRun
      && currentAcceptanceRun.sourceHash === result.sourceHash) {
      setReviewOpen(true);
    }
  }

  if (isNew) {
    return (
      <div className="flex min-h-0 flex-1 bg-surface-panel p-3 sm:p-5 xl:p-6">
        <div className="mx-auto grid w-full max-w-6xl overflow-hidden rounded-2xl border border-edge-subtle bg-surface-base shadow-surface lg:grid-cols-[minmax(280px,0.8fr)_minmax(0,1.5fr)]">
          <form onSubmit={onCreate} className="flex flex-col border-b border-edge-subtle p-5 lg:border-b-0 lg:border-r">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-accent"><Sparkles className="size-4" />{zh ? '告诉 Coder 你的想法' : 'Tell Coder your idea'}</div>
            <h2 className="mt-4 text-xl font-semibold tracking-tight text-fg">{zh ? '你想创建什么？' : 'What do you want to create?'}</h2>
            <p className="mt-2 text-sm leading-6 text-fg-muted">{zh ? '我们会建立一个 Coder Project，并把应用上下文和开发 Skill 带入对话。' : 'We will create a Coder Project and carry the app context and development skill into chat.'}</p>
            <label className="mt-6 text-xs font-medium text-fg-muted">{zh ? '应用名称' : 'App name'}<TabCompletionInput value={name} onChange={(event) => setName(event.target.value)} suggestion={suggestionFromExample(zh ? '例如：阅读清单' : 'e.g. Reading list')} onAcceptSuggestion={setName} required className="mt-2 w-full rounded-xl border border-edge bg-surface-panel px-3 py-2.5 text-sm text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent" placeholder={zh ? '例如：阅读清单' : 'e.g. Reading list'} /></label>
            <label className="mt-4 text-xs font-medium text-fg-muted">{zh ? '描述你的想法' : 'Describe your idea'}<TabCompletionTextarea value={idea} onChange={(event) => setIdea(event.target.value)} suggestion={suggestionFromExample(zh ? '我想要一个可以记录待读文章、标记进度并按主题筛选的小工具…' : 'I want a small tool that tracks articles, reading progress, and topics…')} onAcceptSuggestion={setIdea} required rows={7} className="mt-2 w-full resize-none rounded-xl border border-edge bg-surface-panel px-3 py-2.5 text-sm leading-6 text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent" placeholder={zh ? '我想要一个可以记录待读文章、标记进度并按主题筛选的小工具…' : 'I want a small tool that tracks articles, reading progress, and topics…'} /></label>
            {actionError ? <p className="mt-3 text-sm text-danger" role="alert">{actionError}</p> : null}
            <Button type="submit" variant="primary" className="mt-5 h-10" disabled={busy || !name.trim() || !idea.trim()}>{busy ? <Loader2 className="size-4 animate-spin" /> : <MessageSquareCode className="size-4" />}{zh ? '进入 Coder 对话' : 'Continue with Coder'}</Button>
          </form>
          <div className="hidden min-h-[620px] place-items-center bg-surface-panel p-8 lg:grid">
            <div className="max-w-md text-center"><div className="mx-auto flex size-16 items-center justify-center rounded-2xl border border-edge bg-surface-base text-accent shadow-surface"><PanelLeft className="size-7" /></div><h3 className="mt-5 text-base font-semibold text-fg">{zh ? '创建后，这里就是实时预览' : 'Your live preview appears here'}</h3><p className="mt-2 text-sm leading-6 text-fg-muted">{zh ? '你可以先体验草稿，再决定是否把它添加到左侧导航。' : 'Try the draft first, then decide whether to add it to the sidebar.'}</p></div>
          </div>
        </div>
      </div>
    );
  }

  if (isLoading) return <div className="grid min-h-0 flex-1 gap-3 bg-surface-panel p-3 lg:grid-cols-[280px_minmax(0,1fr)_260px]"><Skeleton className="rounded-xl" /><Skeleton className="rounded-xl" /><Skeleton className="rounded-xl" /></div>;
  if (error || !app) return <div className="m-6 rounded-xl border border-danger/30 bg-danger-soft p-4 text-sm text-danger">{error instanceof Error ? error.message : (zh ? '找不到应用' : 'App not found')}</div>;

  return (
    <div className="grid min-h-0 flex-1 gap-3 overflow-hidden bg-surface-panel p-3 lg:grid-cols-[280px_minmax(0,1fr)_300px]">
      <aside className="min-h-0 overflow-y-auto rounded-xl border border-edge-subtle bg-surface-base p-4 shadow-surface">
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.12em] text-accent"><Sparkles className="size-4" />{zh ? '创作对话' : 'Build conversation'}</div>
        <div className="mt-4 rounded-xl bg-surface-panel p-3 text-sm leading-6 text-fg">{app.idea}</div>
        <div className="mt-4 rounded-xl bg-accent-soft p-3">
          <p className="flex items-center gap-2 text-sm font-medium text-accent-fg"><CircleCheck className="size-4" />{zh ? '草稿已准备好' : 'Draft is ready'}</p>
          <p className="mt-1 text-xs leading-5 text-fg-muted">{zh ? '继续迭代会进入对应 Project，由 Coder 读取应用上下文和专属 skill。' : 'Continue in the Project where Coder has the app context and dedicated skill.'}</p>
        </div>
        <form className="mt-5" onSubmit={(event) => { event.preventDefault(); void onContinueDevelopment(changeRequest); }}>
          <label className="text-xs font-medium text-fg-muted" htmlFor="local-app-change-request">{zh ? '下一步想改什么？' : 'What should change next?'}</label>
          <TabCompletionTextarea
            id="local-app-change-request"
            value={changeRequest}
            onChange={(event) => setChangeRequest(event.target.value)}
            suggestion={suggestionFromExample(zh ? '例如：增加月视图，并支持按标签筛选' : 'e.g. Add a monthly view and tag filters')}
            onAcceptSuggestion={setChangeRequest}
            rows={4}
            className="mt-2 w-full resize-none rounded-xl border border-edge bg-surface-panel px-3 py-2.5 text-sm leading-6 text-fg outline-none focus-visible:ring-2 focus-visible:ring-accent"
            placeholder={zh ? '例如：增加月视图，并支持按标签筛选' : 'e.g. Add a monthly view and tag filters'}
          />
          <Button type="submit" className="mt-2 w-full" disabled={chatBusy || !changeRequest.trim()}>{chatBusy ? <Loader2 className="size-4 animate-spin" /> : <MessageSquareCode className="size-4" />}{zh ? '让 Coder 修改' : 'Ask Coder to update'}</Button>
        </form>
        <Button variant="ghost" className="mt-2 w-full" onClick={() => void onContinueDevelopment()} disabled={chatBusy}><FolderKanban className="size-4" />{zh ? '打开已有开发对话' : 'Open development chat'}</Button>
      </aside>

      <section className="flex min-h-0 flex-col overflow-hidden rounded-xl border border-edge-subtle bg-surface-base shadow-surface">
        <div className="flex h-11 shrink-0 items-center justify-between border-b border-edge-subtle px-3"><div className="flex items-center gap-2 text-xs font-medium text-fg-muted"><span className={`size-2 rounded-full ${validation?.status === 'failed' || runtimeHealth === 'failed' || runtimeHealth === 'timeout' || acceptanceResult?.status === 'failed' ? 'bg-danger' : validation?.status === 'healthy' && runtimeHealth === 'healthy' && acceptanceResult?.status === 'passed' && currentAcceptanceRun?.sourceHash === validation.sourceHash && !savingAcceptance ? 'bg-success' : 'bg-fg-subtle'}`} />{runtimeHealth === 'failed' || runtimeHealth === 'timeout' ? (zh ? '预览运行异常' : 'Preview runtime issue') : validation?.status === 'failed' || acceptanceResult?.status === 'failed' ? (zh ? '自动验收未通过' : 'Acceptance needs attention') : runtimeHealth === 'booting' || !acceptanceResult ? (zh ? '自动验收中' : 'Running acceptance') : savingAcceptance || currentAcceptanceRun?.sourceHash !== validation?.sourceHash ? (zh ? '正在保存验收快照' : 'Saving acceptance snapshot') : (zh ? '草稿已通过验收' : 'Draft accepted')}</div><Button variant="ghost" className="h-8 px-2" onClick={() => void runDraftChecks(true)} disabled={checkingDraft}>{checkingDraft ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}{zh ? '重新验收' : 'Run again'}</Button></div>
        <iframe ref={iframeRef} key={previewKey} title={`${app.name} preview`} src={apiUrl(app.previewUrl)} sandbox={LOCAL_APP_PREVIEW_SANDBOX} className="min-h-0 w-full flex-1 bg-white" onError={() => { setRuntimeIssue({ kind: 'script_error', message: 'Preview document failed to load' }); setRuntimeHealth('failed'); }} />
        {validation?.status === 'healthy' && validation.acceptanceScenarioCount > 0 ? (
          <iframe
            ref={criteriaIframeRef}
            key={`criteria-${previewKey}-${criteriaRunKey}-${criteriaScenarioIndex}`}
            title={`${app.name} acceptance runner`}
            src={`${apiUrl(app.previewUrl)}?xopcAcceptance=1&xopcScenario=${encodeURIComponent(
              criteriaRunTarget === 'all'
                ? acceptanceScenarios[criteriaScenarioIndex]?.id ?? ''
                : criteriaRunTarget,
            )}`}
            sandbox={LOCAL_APP_PREVIEW_SANDBOX}
            aria-hidden="true"
            tabIndex={-1}
            className="pointer-events-none fixed left-[-200vw] top-0 h-[720px] w-[1024px] opacity-0"
          />
        ) : null}
      </section>

      <aside className="min-h-0 overflow-y-auto rounded-xl border border-edge-subtle bg-surface-base p-4 shadow-surface">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-fg">{zh ? '发布状态' : 'Release status'}</h2>
            <p className="mt-1 text-xs text-fg-muted">
              {app.installationState === 'not_installed'
                ? (zh ? '尚未安装' : 'Not installed')
                : app.enabled
                  ? (zh ? `版本 ${app.activeVersion} 正在使用` : `Version ${app.activeVersion} is active`)
                  : (zh ? '已禁用，版本仍保留' : 'Disabled, release retained')}
            </p>
          </div>
          <span className={`mt-1 size-2.5 rounded-full ${app.enabled ? 'bg-success' : 'bg-fg-subtle'}`} aria-hidden />
        </div>

        <dl className="mt-4 grid grid-cols-2 gap-3 text-xs">
          <div><dt className="text-fg-subtle">{zh ? '当前草稿' : 'Draft'}</dt><dd className="mt-1 font-medium text-fg">v{app.draftVersion}</dd></div>
          <div><dt className="text-fg-subtle">{zh ? '已安装' : 'Installed'}</dt><dd className="mt-1 font-medium text-fg">{app.activeVersion ? `v${app.activeVersion}` : '—'}</dd></div>
        </dl>

        <div className="mt-5 border-t border-edge-subtle pt-4">
          <div className="flex items-center justify-between gap-2">
            <h3 className="flex items-center gap-2 text-xs font-semibold text-fg"><FileDiff className="size-4 text-accent" />{zh ? '草稿检查' : 'Draft checks'}</h3>
            {validationLoading || checkingDraft ? <Loader2 className="size-3.5 animate-spin text-fg-muted" /> : validation?.status === 'healthy' ? <CircleCheck className="size-4 text-success" /> : <AlertTriangle className="size-4 text-danger" />}
          </div>
          {validation ? (
            <div className="mt-2">
              <p className={`text-xs leading-5 ${validation.status === 'healthy' ? 'text-fg-muted' : 'text-danger'}`}>
                {validation.status === 'healthy'
                  ? validation.hasDraftChanges
                    ? (zh ? `${validation.changedFileCount} 个文件有改动，可以安装新版本。` : `${validation.changedFileCount} changed files are ready for a new release.`)
                    : (zh ? '草稿与当前安装版本一致。' : 'Draft matches the installed release.')
                  : validation.issues[0]?.message}
              </p>
              {validation.changedFiles.length ? <ul className="mt-2 space-y-1">{validation.changedFiles.slice(0, 4).map((file) => <li key={file.path} className="flex min-w-0 items-center gap-2 text-[11px] text-fg-muted"><span className="w-4 shrink-0 font-medium text-fg-subtle">{file.status === 'added' ? '+' : file.status === 'deleted' ? '−' : '•'}</span><span className="truncate font-mono">{file.path}</span></li>)}</ul> : null}
              {validation.changedFileCount > 4 ? <p className="mt-1 text-[10px] text-fg-subtle">{zh ? `还有 ${validation.changedFileCount - 4} 个文件` : `${validation.changedFileCount - 4} more files`}</p> : null}
              <div className="mt-3 border-t border-edge-subtle pt-3">
                <p className="flex items-center gap-2 text-xs font-medium text-fg"><span className={`size-2 rounded-full ${runtimeHealth === 'healthy' ? 'bg-success' : runtimeHealth === 'booting' ? 'bg-fg-subtle' : 'bg-danger'}`} />{zh ? '预览运行' : 'Preview runtime'}</p>
                <p className={`mt-1 text-xs leading-5 ${runtimeHealth === 'failed' || runtimeHealth === 'timeout' ? 'text-danger' : 'text-fg-muted'}`}>{runtimeIssue ? formatLocalAppRuntimeIssue(runtimeIssue) : runtimeHealth === 'healthy' ? (zh ? '已成功启动，未发现未捕获异常。' : 'Started successfully with no uncaught errors.') : runtimeHealth === 'timeout' ? (zh ? '7 秒内未完成启动，可能出现白屏或阻塞。' : 'Did not finish booting within 7 seconds.') : (zh ? '正在等待应用启动。' : 'Waiting for the app to start.')}</p>
              </div>
              <div className="mt-3 border-t border-edge-subtle pt-3">
                <p className="flex items-center gap-2 text-xs font-medium text-fg"><span className={`size-2 rounded-full ${acceptanceResult?.status === 'passed' ? 'bg-success' : acceptanceResult?.status === 'failed' ? 'bg-danger' : 'bg-fg-subtle'}`} />{zh ? '自动验收' : 'Automatic acceptance'}</p>
                {acceptanceResult ? <ul className="mt-2 space-y-1.5">{acceptanceResult.checks.map((check) => <li key={check.id} className={`flex items-start gap-2 text-[11px] leading-4 ${check.status === 'failed' ? 'text-danger' : 'text-fg-muted'}`}><span className={`mt-1 size-1.5 shrink-0 rounded-full ${check.status === 'failed' ? 'bg-danger' : check.status === 'passed' ? 'bg-success' : 'bg-fg-subtle'}`} /><span>{check.message}</span></li>)}</ul> : <p className="mt-1 text-xs leading-5 text-fg-muted">{validation?.acceptanceScenarioCount ? (zh ? `正在检查页面基础质量和 ${validation.acceptanceScenarioCount} 个产品场景。` : `Checking page quality and ${validation.acceptanceScenarioCount} product scenario(s).`) : (zh ? '正在检查页面内容和基础交互。' : 'Checking rendered content and basic interaction.')}</p>}
                {savingAcceptance ? <p className="mt-2 flex items-center gap-2 text-[11px] text-fg-muted"><Loader2 className="size-3 animate-spin" />{zh ? '正在保存当前源码对应的验收快照…' : 'Saving the acceptance snapshot for this source…'}</p> : currentAcceptanceRun ? <p className="mt-2 text-[11px] leading-4 text-fg-muted">{previousAcceptanceRun ? (zh ? `相比上次：已修复 ${fixedAcceptanceCount} 项，仍有 ${currentAcceptanceFailures.length} 项。` : `Since the previous run: ${fixedAcceptanceCount} fixed, ${currentAcceptanceFailures.length} remaining.`) : (zh ? '首个验收快照已保存。' : 'First acceptance snapshot saved.')}</p> : null}
                <AcceptanceScenarioList
                  scenarios={acceptanceScenarios}
                  results={criteriaResults}
                  runningTarget={criteriaRunningTarget}
                  zh={zh}
                  onRunAll={onRunAllScenarios}
                  onRunScenario={onRunScenario}
                  onAskCoder={onAskCoderToFixScenario}
                />
              </div>
              {hasCoderFixableIssue ? <Button className="mt-3 w-full" onClick={onAskCoderToFix} disabled={chatBusy}><MessageSquareCode className="size-4" />{zh ? '让 Coder 修复' : 'Ask Coder to fix'}</Button> : null}
            </div>
          ) : <Skeleton className="mt-2 h-12 rounded-lg" />}
        </div>

        <div className="mt-5 border-t border-edge-subtle pt-4">
          <div className="flex items-center gap-2 text-xs font-semibold text-fg"><ShieldCheck className="size-4 text-accent" />{zh ? '权限' : 'Permissions'}</div>
          <div className="mt-2 flex flex-wrap gap-1.5">{(validation?.permissions ?? app.permissions).map((permission) => <span key={permission} className="rounded-md bg-surface-hover px-2 py-1 text-[11px] text-fg-muted">{permission}</span>)}</div>
        </div>

        <Button variant="primary" className="mt-5 w-full" onClick={() => void onReviewInstall()} disabled={busy || validationLoading || checkingDraft || savingAcceptance || validation?.status === 'failed' || runtimeHealth !== 'healthy' || acceptanceResult?.status !== 'passed' || !currentAcceptanceRun || currentAcceptanceRun.sourceHash !== validation?.sourceHash || (app.installationState === 'installed' && validation?.hasDraftChanges === false)}>
          {app.installationState === 'installed' ? (zh ? '安装当前更新' : 'Install current update') : (zh ? '添加到左侧导航' : 'Add to sidebar')}
        </Button>

        {app.installationState === 'installed' ? (
          <div className="mt-2 flex gap-2">
            <Button className="min-w-0 flex-1" onClick={() => void onSetEnabled(!app.enabled)} disabled={busy}>
              {app.enabled ? <PowerOff className="size-4" /> : <Power className="size-4" />}
              {app.enabled ? (zh ? '禁用' : 'Disable') : (zh ? '启用' : 'Enable')}
            </Button>
            <Button variant="ghost" className="text-danger hover:text-danger" onClick={() => setUninstallOpen(true)} disabled={busy} aria-label={zh ? '卸载应用' : 'Uninstall app'}><Trash2 className="size-4" /></Button>
          </div>
        ) : null}

        <div className="mt-6 border-t border-edge-subtle pt-4">
          <h3 className="flex items-center gap-2 text-xs font-semibold text-fg"><History className="size-4" />{zh ? '版本历史' : 'Release history'}</h3>
          {app.releases.length ? (
            <ul className="mt-2 divide-y divide-edge-subtle">
              {app.releases.map((release) => (
                <li key={release.id} className="flex items-center justify-between gap-3 py-2.5">
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5 text-xs font-medium text-fg">v{release.version}{release.isActive ? <span className="rounded-full bg-success-soft px-1.5 py-0.5 text-[10px] text-success">{zh ? '当前' : 'Active'}</span> : null}</div>
                    <p className="mt-0.5 truncate text-[10px] text-fg-subtle">{formatReleaseDate(release.createdAt, language)}</p>
                  </div>
                  {!release.isActive ? <Button variant="ghost" className="h-7 px-2 text-xs" onClick={() => void onRollback(release.id)} disabled={busy}><RotateCcw className="size-3.5" />{zh ? '恢复' : 'Restore'}</Button> : null}
                </li>
              ))}
            </ul>
          ) : <p className="mt-2 text-xs leading-5 text-fg-muted">{zh ? '安装首个版本后，可以从这里恢复。' : 'Install the first version to enable recovery.'}</p>}
        </div>
        {actionError ? <p className="mt-3 text-xs leading-5 text-danger" role="alert">{actionError}</p> : null}
      </aside>

      <Dialog.Root open={reviewOpen} onOpenChange={setReviewOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-50 bg-black/45" />
          <Dialog.Content className="fixed left-1/2 top-1/2 z-50 flex h-[min(560px,calc(100vh-32px))] w-[min(520px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-2xl border border-edge bg-surface-base shadow-2xl focus:outline-none">
            <div className="flex items-start justify-between border-b border-edge-subtle p-5">
              <div><Dialog.Title className="text-base font-semibold text-fg">{zh ? '确认安装到 XOPC' : 'Confirm installation'}</Dialog.Title><Dialog.Description className="mt-1 text-sm text-fg-muted">{zh ? '当前草稿会成为左侧导航中的可用版本。' : 'The current draft will become the version available in the sidebar.'}</Dialog.Description></div>
              <Dialog.Close className="rounded-lg p-1.5 text-fg-muted hover:bg-surface-hover"><X className="size-4" /></Dialog.Close>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-5">
              <div className="rounded-xl border border-edge-subtle bg-surface-panel p-4"><h3 className="text-sm font-semibold text-fg">{app.name}</h3><p className="mt-1 text-xs text-fg-muted">{app.extensionId}</p></div>
              <h4 className="mt-5 text-xs font-semibold text-fg">{zh ? '本次迭代' : 'This iteration'}</h4>
              <dl className="mt-2 grid grid-cols-2 gap-3 text-xs">
                <div><dt className="text-fg-subtle">{zh ? '文件变化' : 'Changed files'}</dt><dd className="mt-1 font-medium text-fg">{validation?.changedFileCount ?? 0}</dd></div>
                <div><dt className="text-fg-subtle">{zh ? '自动验收' : 'Acceptance'}</dt><dd className="mt-1 flex items-center gap-1.5 font-medium text-success"><CircleCheck className="size-3.5" />{zh ? '已通过并保存' : 'Passed and saved'}</dd></div>
              </dl>
              {validation?.changedFiles.length ? <ul className="mt-3 space-y-1">{validation.changedFiles.slice(0, 5).map((file) => <li key={file.path} className="flex min-w-0 items-center gap-2 text-[11px] text-fg-muted"><span className="w-4 shrink-0 font-medium text-fg-subtle">{file.status === 'added' ? '+' : file.status === 'deleted' ? '−' : '•'}</span><span className="truncate font-mono">{file.path}</span></li>)}</ul> : null}
              <h4 className="mt-5 text-xs font-semibold text-fg">{zh ? '请求权限' : 'Requested permissions'}</h4>
              <ul className="mt-2 space-y-2">{(validation?.permissions ?? app.permissions).map((permission) => <li key={permission} className="flex items-center gap-2 text-sm text-fg"><Check className="size-4 text-success" />{permission}{app.installationState === 'installed' && validation?.permissionDelta.added.includes(permission) ? <span className="rounded-full bg-warning-soft px-2 py-0.5 text-[10px] text-warning">{zh ? '新增' : 'New'}</span> : null}</li>)}</ul>
              {app.installationState === 'installed' && validation?.permissionDelta.added.length ? <p className="mt-4 rounded-xl bg-warning-soft p-3 text-xs leading-5 text-warning">{zh ? '此更新增加了权限，请确认这些能力符合你的修改意图。' : 'This update adds permissions. Confirm they match the change you requested.'}</p> : null}
              <p className="mt-5 rounded-xl bg-accent-soft p-3 text-xs leading-5 text-accent-fg">{zh ? 'Phase 1 应用只能使用界面主题和本地存储，不能访问网络或运行系统命令。' : 'Phase 1 apps can use theme and local storage only. They cannot access the network or run system commands.'}</p>
            </div>
            <div className="flex justify-end gap-2 border-t border-edge-subtle p-4"><Dialog.Close asChild><Button>{zh ? '取消' : 'Cancel'}</Button></Dialog.Close><Button variant="primary" onClick={() => void onInstall()} disabled={busy}>{busy ? <Loader2 className="size-4 animate-spin" /> : <ExternalLink className="size-4" />}{zh ? '确认安装' : 'Install'}</Button></div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      <Dialog.Root open={uninstallOpen} onOpenChange={setUninstallOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-50 bg-black/45" />
          <Dialog.Content className="fixed left-1/2 top-1/2 z-50 flex h-[min(420px,calc(100vh-32px))] w-[min(500px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-2xl border border-edge bg-surface-base shadow-2xl focus:outline-none">
            <div className="flex items-start justify-between border-b border-edge-subtle p-5">
              <div><Dialog.Title className="text-base font-semibold text-fg">{zh ? '卸载当前应用？' : 'Uninstall this app?'}</Dialog.Title><Dialog.Description className="mt-1 text-sm leading-6 text-fg-muted">{zh ? '应用会从侧栏移除，但 Project、源码、版本历史和本地数据都会保留。' : 'The app leaves the sidebar, while its Project, source, release history, and local data remain.'}</Dialog.Description></div>
              <Dialog.Close className="rounded-lg p-1.5 text-fg-muted hover:bg-surface-hover"><X className="size-4" /></Dialog.Close>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-5"><div className="rounded-xl bg-surface-panel p-4"><p className="text-sm font-medium text-fg">{app.name}</p><p className="mt-1 text-xs text-fg-muted">{zh ? '之后可从任意保留版本重新安装。' : 'You can reinstall any retained release later.'}</p></div></div>
            <div className="flex justify-end gap-2 border-t border-edge-subtle p-4"><Dialog.Close asChild><Button>{zh ? '取消' : 'Cancel'}</Button></Dialog.Close><Button variant="ghost" className="text-danger hover:bg-danger-soft hover:text-danger" onClick={() => void onUninstall()} disabled={busy}>{busy ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}{zh ? '卸载但保留 Project' : 'Uninstall and keep Project'}</Button></div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}
