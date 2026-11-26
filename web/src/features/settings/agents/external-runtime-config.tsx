import {
  Check,
  Copy,
  ExternalLink,
  KeyRound,
  Loader2,
  LogIn,
  LogOut,
  Plus,
  RefreshCw,
  Settings2,
  Smartphone,
  Terminal,
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { mutate as globalMutate } from 'swr';

import { ExternalRuntimeAvatar } from '@/components/brand/external-runtime-avatar';
import { Button } from '@/components/ui/button';
import { Select, SelectOption } from '@/components/ui/popover-select';
import { Skeleton } from '@/components/ui/skeleton';
import { invalidateAgentRuntimeModelsCache } from '@/features/chat/api/registry-api';
import { DirectoryPickerPathField } from '@/features/fs/directory-picker-path-field';
import {
  cancelExternalRuntimeAuthFlow,
  fetchExternalRuntimeAuthFlow,
  logoutExternalAgentRuntime,
  probeExternalAgentRuntime,
  respondExternalRuntimeAuthFlow,
  startExternalRuntimeAuth,
} from '@/features/settings/agents-admin-api';
import {
  closeOAuthAuthorizationWindow,
  openOAuthAuthorizationUrl,
  reserveOAuthAuthorizationWindow,
} from '@/features/settings/oauth-authorization-window';
import {
  AGY_AUTH_METHODS,
  EXTERNAL_PERMISSION_MODES,
  type AgyAuthMethod,
  type ExternalAgentExecution,
  type ExternalAgentKind,
  type ExternalPermissionMode,
  type ExternalRuntimeAuthFlowSnapshot,
  type ExternalRuntimeAuthMode,
  type ExternalRuntimeProbeResult,
  type ExternalRuntimeStatus,
  type GatewayAgentRow,
} from '@/features/settings/types/agent-gateway';
import type { MessageBundle } from '@/i18n/messages';
import { cn } from '@/lib/cn';

const inputClass =
  'w-full rounded-xl border border-edge bg-surface-base px-3 py-2.5 text-sm text-fg outline-none focus:border-accent focus:ring-2 focus:ring-accent/15';

const CUSTOM_MODEL_SENTINEL = '__custom__';
const AUTO_MODEL_SENTINEL = '__auto__';
const AUTH_POLL_INTERVAL_MS = 1_200;

export function externalRuntimeDisplayName(kind: ExternalAgentKind): string {
  if (kind === 'codex') return 'Codex';
  if (kind === 'claude') return 'Claude Code';
  return 'Antigravity (AGY)';
}

export function externalRuntimeShortDescription(kind: ExternalAgentKind, zh: boolean): string {
  if (kind === 'codex') {
    return zh
      ? '通过本机 codex app-server 运行，支持在界面中直接完成 ChatGPT / API Key 登录。'
      : 'Runs via local codex app-server with built-in ChatGPT or API key sign-in.';
  }
  if (kind === 'claude') {
    return zh
      ? '通过本机 Claude Code CLI (stream-json) 运行，支持多轮连接复用、审批卡片与思考级别。'
      : 'Runs via local Claude Code CLI (stream-json) with warm session reuse, approvals, and effort controls.';
  }
  return zh
    ? '通过本机 agy acp (ACP 协议) 运行，支持在界面中直接完成 Google OAuth 登录。'
    : 'Runs via local agy acp (ACP protocol) with built-in Google OAuth sign-in.';
}

const STATUS_DOT_CLASS: Record<ExternalRuntimeStatus, string> = {
  ready: 'bg-emerald-500',
  unauthenticated: 'bg-amber-500',
  warning: 'bg-amber-500',
  not_installed: 'bg-fg-subtle/60',
  error: 'bg-red-500',
};

export function externalRuntimeStatusLabel(status: ExternalRuntimeStatus | undefined, zh: boolean): string {
  switch (status) {
    case 'ready':
      return zh ? '已就绪' : 'Ready';
    case 'unauthenticated':
      return zh ? '需要登录' : 'Sign in required';
    case 'not_installed':
      return zh ? '未检测到 CLI' : 'CLI not found';
    case 'warning':
      return zh ? '需要关注' : 'Needs attention';
    case 'error':
      return zh ? '不可用' : 'Unavailable';
    default:
      return zh ? '检测中…' : 'Checking…';
  }
}

function permissionModeLabel(mode: ExternalPermissionMode, zh: boolean): string {
  switch (mode) {
    case 'full_access':
      return zh ? '完全放行（自动执行命令与改文件）' : 'Full access (auto-run commands & edits)';
    case 'auto_edit':
      return zh ? '自动改文件，执行命令前确认' : 'Auto-accept edits, ask before commands';
    case 'ask':
      return zh ? '逐项确认（改文件与命令均需审批）' : 'Ask before edits & commands';
  }
}

function agyAuthMethodLabel(method: AgyAuthMethod, zh: boolean): string {
  switch (method) {
    case 'oauth-personal':
      return zh ? 'Google 账号 (oauth-personal)' : 'Google account (oauth-personal)';
    case 'oauth-business':
      return zh ? 'Gemini Enterprise (oauth-business)' : 'Gemini Enterprise (oauth-business)';
    case 'gemini-api-key':
      return zh ? 'Gemini API Key (gemini-api-key)' : 'Gemini API key (gemini-api-key)';
    case 'agent-platform':
      return zh ? 'Agent Platform (agent-platform)' : 'Agent Platform (agent-platform)';
  }
}

function formatWindowLabel(mins: number | undefined, zh: boolean): string {
  if (!mins || mins <= 0) return zh ? '当前周期' : 'Window';
  if (mins >= 1440) {
    const days = Math.round(mins / 1440);
    return zh ? `${days} 天额度` : `${days}d limit`;
  }
  const hours = Math.round(mins / 60);
  return hours >= 1 ? (zh ? `${hours} 小时额度` : `${hours}h limit`) : `${mins}m`;
}

function formatResetCountdown(resetsAt: number | undefined, zh: boolean): string | null {
  if (!resetsAt) return null;
  const diffMs = resetsAt - Date.now();
  if (diffMs <= 0) return null;
  const mins = Math.round(diffMs / 60_000);
  if (mins < 60) return zh ? `${mins} 分钟后重置` : `resets in ${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 48) return zh ? `${hours} 小时后重置` : `resets in ${hours}h`;
  const days = Math.round(hours / 24);
  return zh ? `${days} 天后重置` : `resets in ${days}d`;
}

function ExternalRuntimeRateLimitsSummary({
  rateLimits,
  zh,
}: {
  rateLimits?: ExternalRuntimeProbeResult['rateLimits'];
  zh: boolean;
}) {
  if (!rateLimits || (!rateLimits.primary && !rateLimits.secondary)) return null;
  const windows = [rateLimits.primary, rateLimits.secondary].filter(
    (w): w is NonNullable<typeof w> => Boolean(w),
  );
  return (
    <div className="mt-2 space-y-1.5 rounded-lg border border-edge-subtle bg-surface-panel/60 px-2.5 py-2">
      {windows.map((win, idx) => {
        const pct = Math.max(0, Math.min(100, win.usedPercent));
        const resetLabel = formatResetCountdown(win.resetsAt, zh);
        return (
          <div key={idx} className="space-y-1">
            <div className="flex items-center justify-between gap-2 text-[11px]">
              <span className="text-fg-muted">{formatWindowLabel(win.windowDurationMins, zh)}</span>
              <span className="font-mono text-fg-subtle">
                {pct}%{resetLabel ? ` · ${resetLabel}` : ''}
              </span>
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-hover">
              <div
                className={cn(
                  'h-full rounded-full transition-all',
                  pct >= 90 ? 'bg-red-500' : pct >= 75 ? 'bg-amber-500' : 'bg-accent',
                )}
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function formatAccountBadge(probe?: ExternalRuntimeProbeResult): string | null {
  const label = probe?.account?.label?.trim();
  if (!label) return null;
  const mode = probe?.account?.authMode?.trim();
  return mode && mode !== label ? `${label} · ${mode}` : label;
}

export function ExternalRuntimeStatusDot({
  status,
  className,
}: {
  status?: ExternalRuntimeStatus;
  className?: string;
}) {
  return (
    <span
      className={cn(
        'inline-block size-2 shrink-0 rounded-full',
        status ? STATUS_DOT_CLASS[status] : 'animate-pulse bg-fg-subtle/50',
        className,
      )}
      aria-hidden
    />
  );
}

function CopyTextChip({
  text,
  icon = 'terminal',
  zh,
}: {
  text: string;
  icon?: 'terminal' | 'code';
  zh: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    void navigator.clipboard?.writeText(text).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    });
  };
  return (
    <div className="mt-2 flex items-center justify-between gap-2 rounded-lg border border-edge bg-surface-panel px-2.5 py-1.5">
      <div className="flex min-w-0 items-center gap-2 font-mono text-xs text-fg">
        {icon === 'terminal' ? <Terminal className="size-3.5 shrink-0 text-fg-muted" aria-hidden /> : null}
        <span className={cn('truncate', icon === 'code' && 'text-sm font-semibold tracking-wider')} title={text}>
          {text}
        </span>
      </div>
      <button
        type="button"
        onClick={copy}
        className="inline-flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        {copied ? <Check className="size-3 text-emerald-500" aria-hidden /> : <Copy className="size-3" aria-hidden />}
        {copied ? (zh ? '已复制' : 'Copied') : (zh ? '复制' : 'Copy')}
      </button>
    </div>
  );
}

export function ExternalRuntimeQuickCards({
  runtimes,
  loading,
  refreshing,
  agents,
  zh,
  onRefresh,
  onAddRuntime,
  onOpenAgent,
}: {
  runtimes?: ExternalRuntimeProbeResult[];
  loading: boolean;
  refreshing: boolean;
  agents: GatewayAgentRow[];
  zh: boolean;
  onRefresh: () => void;
  onAddRuntime: (kind: ExternalAgentKind) => void;
  onOpenAgent: (agentId: string) => void;
}) {
  const kinds: ExternalAgentKind[] = ['codex', 'agy', 'claude'];

  return (
    <section className="rounded-2xl border border-edge bg-surface-panel p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-fg">
            {zh ? '外部编程运行时' : 'External coding runtimes'}
          </h2>
          <p className="mt-0.5 text-xs leading-5 text-fg-muted">
            {zh
              ? '将宿主机上的 Codex、Antigravity (AGY) 或 Claude Code 接入为项目 Agent，会话、登录与模型配置统一在 xopc 中完成。'
              : 'Connect host-installed Codex, Antigravity (AGY), or Claude Code as Project agents with sign-in, models, and sessions managed in xopc.'}
          </p>
        </div>
        <Button variant="ghost" className="h-8 gap-1.5 px-2.5 text-xs" disabled={refreshing || loading} onClick={onRefresh}>
          <RefreshCw className={cn('size-3.5', refreshing && 'animate-spin')} aria-hidden />
          {zh ? '重新检测' : 'Refresh status'}
        </Button>
      </div>

      {loading && !runtimes ? (
        <div className="mt-3.5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Skeleton className="h-28 rounded-xl" />
          <Skeleton className="h-28 rounded-xl" />
          <Skeleton className="h-28 rounded-xl" />
        </div>
      ) : (
        <div className="mt-3.5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {kinds.map((kind) => {
            const probe = runtimes?.find((entry) => entry.kind === kind);
            const configured = agents.filter((agent) => agent.override.execution?.kind === kind);
            const firstConfigured = configured[0];
            const accountBadge = formatAccountBadge(probe);
            const needsSignIn = probe?.status === 'unauthenticated';
            return (
              <div
                key={kind}
                className="flex flex-col justify-between gap-3 rounded-xl border border-edge bg-surface-base p-3.5"
              >
                <div className="min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-2">
                      <ExternalRuntimeAvatar kind={kind} size={22} />
                      <h3 className="truncate text-sm font-semibold text-fg">
                        {externalRuntimeDisplayName(kind)}
                      </h3>
                      {probe?.version ? (
                        <span className="shrink-0 rounded-md bg-surface-hover px-1.5 py-0.5 font-mono text-[10px] text-fg-muted">
                          {probe.version}
                        </span>
                      ) : null}
                    </div>
                    <span className="inline-flex shrink-0 items-center gap-1.5 text-[11px] font-medium text-fg-muted">
                      <ExternalRuntimeStatusDot status={probe?.status} />
                      {externalRuntimeStatusLabel(probe?.status, zh)}
                    </span>
                  </div>
                  <p className="mt-1.5 truncate text-xs leading-5 text-fg-muted" title={accountBadge ?? probe?.message}>
                    {probe?.status === 'ready'
                      ? [
                          accountBadge,
                          probe.models.length > 0
                            ? (zh ? `${probe.models.length} 个可用模型` : `${probe.models.length} models`)
                            : null,
                        ].filter(Boolean).join(' · ') || externalRuntimeShortDescription(kind, zh)
                      : (probe?.message ?? externalRuntimeShortDescription(kind, zh))}
                  </p>
                  {probe?.status === 'ready' ? (
                    <ExternalRuntimeRateLimitsSummary rateLimits={probe.rateLimits} zh={zh} />
                  ) : null}
                </div>

                <div className="flex flex-wrap items-center justify-between gap-2 border-t border-edge-subtle pt-2.5">
                  <span className="text-[11px] text-fg-subtle">
                    {configured.length > 0
                      ? (zh ? `已配置 ${configured.length} 个 Agent` : `${configured.length} configured`)
                      : (zh ? '尚未添加 Agent' : 'Not configured yet')}
                  </span>
                  <div className="flex items-center gap-1.5">
                    {firstConfigured ? (
                      <Button
                        variant={needsSignIn ? 'primary' : 'ghost'}
                        className="h-7 gap-1 px-2 text-xs"
                        onClick={() => onOpenAgent(firstConfigured.id)}
                      >
                        {needsSignIn ? <LogIn className="size-3.5" aria-hidden /> : <Settings2 className="size-3.5" aria-hidden />}
                        {needsSignIn ? (zh ? '去登录' : 'Sign in') : (zh ? '配置' : 'Configure')}
                      </Button>
                    ) : null}
                    <Button
                      variant={firstConfigured ? 'secondary' : 'primary'}
                      className="h-7 gap-1 px-2.5 text-xs"
                      onClick={() => onAddRuntime(kind)}
                    >
                      <Plus className="size-3.5" aria-hidden />
                      {firstConfigured
                        ? (zh ? '新增' : 'Add')
                        : needsSignIn
                          ? (zh ? `登录并接入` : `Sign in & add`)
                          : (zh ? `接入 ${kind === 'codex' ? 'Codex' : 'AGY'}` : `Set up ${kind === 'codex' ? 'Codex' : 'AGY'}`)}
                    </Button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

export function ExternalRuntimeConfigForm({
  value,
  initialProbe,
  disabled,
  zh,
  workingDirectoryMessages,
  onChange,
}: {
  value: ExternalAgentExecution;
  initialProbe?: ExternalRuntimeProbeResult;
  disabled?: boolean;
  zh: boolean;
  workingDirectoryMessages: MessageBundle['chat']['workingDirectory'];
  onChange: (next: ExternalAgentExecution) => void;
}) {
  const [probe, setProbe] = useState<ExternalRuntimeProbeResult | undefined>(initialProbe);
  const [probing, setProbing] = useState(false);
  const [probeError, setProbeError] = useState<string | null>(null);
  const [customModelMode, setCustomModelMode] = useState(false);

  // In-UI OAuth / login state
  const [authFlow, setAuthFlow] = useState<ExternalRuntimeAuthFlowSnapshot | null>(null);
  const [authBusy, setAuthBusy] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [authSuccessNotice, setAuthSuccessNotice] = useState<string | null>(null);
  const [responseInput, setResponseInput] = useState('');
  const [submittingResponse, setSubmittingResponse] = useState(false);
  const [showApiKeyInput, setShowApiKeyInput] = useState(false);
  const [apiKeyInput, setApiKeyInput] = useState('');
  const [loggingOut, setLoggingOut] = useState(false);

  const requestSeq = useRef(0);
  const latestValueRef = useRef(value);
  latestValueRef.current = value;
  const popupRef = useRef<Window | null>(null);
  const openedUrlRef = useRef<string | null>(null);

  const syncGlobalRuntimeCache = useCallback(() => {
    void globalMutate('settings-external-agent-runtimes');
    void invalidateAgentRuntimeModelsCache();
  }, []);

  const runProbe = useCallback(async (target: ExternalAgentExecution) => {
    const seq = ++requestSeq.current;
    setProbing(true);
    setProbeError(null);
    try {
      const result = await probeExternalAgentRuntime(target);
      if (seq === requestSeq.current) setProbe(result);
    } catch (cause) {
      if (seq === requestSeq.current) {
        setProbeError(cause instanceof Error ? cause.message : String(cause));
      }
    } finally {
      if (seq === requestSeq.current) setProbing(false);
    }
  }, []);

  useEffect(() => {
    setAuthFlow(null);
    setAuthError(null);
    setAuthSuccessNotice(null);
    setResponseInput('');
    setShowApiKeyInput(false);
    setApiKeyInput('');
    openedUrlRef.current = null;
    closeOAuthAuthorizationWindow(popupRef.current);
    popupRef.current = null;
    if (initialProbe && initialProbe.kind === value.kind) {
      setProbe(initialProbe);
    }
    void runProbe(latestValueRef.current);
  }, [initialProbe, runProbe, value.kind]);

  // Clean up reserved popup on unmount
  useEffect(() => () => {
    closeOAuthAuthorizationWindow(popupRef.current);
    popupRef.current = null;
  }, []);

  // Automatically open OAuth authorization URL once received from backend
  useEffect(() => {
    const url = authFlow?.authorizationUrl;
    if (!url || openedUrlRef.current === url) return;
    openedUrlRef.current = url;
    void openOAuthAuthorizationUrl(url, popupRef.current);
  }, [authFlow?.authorizationUrl]);

  // Poll active auth flow until it reaches a terminal state
  const activeFlowId =
    authFlow && (authFlow.phase === 'starting' || authFlow.phase === 'waiting' || authFlow.phase === 'verifying')
      ? authFlow.flowId
      : null;

  useEffect(() => {
    if (!activeFlowId) return;
    let cancelled = false;
    const poll = async () => {
      try {
        const next = await fetchExternalRuntimeAuthFlow(activeFlowId);
        if (cancelled) return;
        setAuthFlow(next);
        if (next.phase === 'succeeded') {
          closeOAuthAuthorizationWindow(popupRef.current);
          popupRef.current = null;
          if (next.probe) setProbe(next.probe);
          setAuthSuccessNotice(next.message ?? (zh ? '登录成功，已同步可用模型。' : 'Signed in and loaded available models.'));
          setAuthFlow(null);
          setResponseInput('');
          syncGlobalRuntimeCache();
        } else if (next.phase === 'failed' || next.phase === 'cancelled') {
          closeOAuthAuthorizationWindow(popupRef.current);
          popupRef.current = null;
          if (next.probe) setProbe(next.probe);
        }
      } catch (cause) {
        if (!cancelled) {
          setAuthError(cause instanceof Error ? cause.message : String(cause));
          setAuthFlow(null);
          closeOAuthAuthorizationWindow(popupRef.current);
          popupRef.current = null;
        }
      }
    };
    const timer = window.setInterval(() => {
      void poll();
    }, AUTH_POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [activeFlowId, syncGlobalRuntimeCache, zh]);

  const handleStartAuth = async (mode: ExternalRuntimeAuthMode, apiKey?: string) => {
    if (disabled || authBusy) return;
    setAuthBusy(true);
    setAuthError(null);
    setAuthSuccessNotice(null);
    setResponseInput('');
    openedUrlRef.current = null;

    const usesBrowserWindow = mode === 'browser' || mode === 'device_code';
    const agyUsesCredentials =
      value.kind === 'agy' && (value.authMethod === 'gemini-api-key' || value.authMethod === 'agent-platform');
    if (usesBrowserWindow && !agyUsesCredentials) {
      closeOAuthAuthorizationWindow(popupRef.current);
      popupRef.current = reserveOAuthAuthorizationWindow();
    }

    try {
      const flow = await startExternalRuntimeAuth({
        execution: latestValueRef.current,
        mode,
        ...(apiKey ? { apiKey } : {}),
      });
      if (flow.phase === 'succeeded') {
        closeOAuthAuthorizationWindow(popupRef.current);
        popupRef.current = null;
        if (flow.probe) setProbe(flow.probe);
        setAuthSuccessNotice(flow.message ?? (zh ? '登录成功。' : 'Signed in successfully.'));
        setAuthFlow(null);
        setShowApiKeyInput(false);
        setApiKeyInput('');
        syncGlobalRuntimeCache();
      } else if (flow.phase === 'failed') {
        closeOAuthAuthorizationWindow(popupRef.current);
        popupRef.current = null;
        if (flow.probe) setProbe(flow.probe);
        setAuthFlow(flow);
      } else {
        setAuthFlow(flow);
        if (flow.authorizationUrl) {
          openedUrlRef.current = flow.authorizationUrl;
          void openOAuthAuthorizationUrl(flow.authorizationUrl, popupRef.current);
        }
      }
    } catch (cause) {
      closeOAuthAuthorizationWindow(popupRef.current);
      popupRef.current = null;
      setAuthError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setAuthBusy(false);
    }
  };

  const handleSubmitAuthResponse = async () => {
    if (!authFlow || !responseInput.trim() || submittingResponse) return;
    setSubmittingResponse(true);
    setAuthError(null);
    try {
      const next = await respondExternalRuntimeAuthFlow(authFlow.flowId, responseInput.trim());
      setAuthFlow(next);
      setResponseInput('');
    } catch (cause) {
      setAuthError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSubmittingResponse(false);
    }
  };

  const handleCancelAuth = async () => {
    const id = authFlow?.flowId;
    setAuthFlow(null);
    setAuthError(null);
    setResponseInput('');
    closeOAuthAuthorizationWindow(popupRef.current);
    popupRef.current = null;
    if (id) {
      await cancelExternalRuntimeAuthFlow(id).catch(() => {});
    }
  };

  const handleLogout = async () => {
    if (disabled || loggingOut) return;
    setLoggingOut(true);
    setAuthError(null);
    setAuthSuccessNotice(null);
    try {
      const nextProbe = await logoutExternalAgentRuntime(latestValueRef.current);
      setProbe(nextProbe);
      syncGlobalRuntimeCache();
    } catch (cause) {
      setAuthError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoggingOut(false);
    }
  };

  const discoveredModels = probe?.kind === value.kind ? probe.models : [];
  const savedModel = value.model ?? '';
  const modelInList = savedModel !== '' && discoveredModels.some((m) => m.id === savedModel);
  const selectModelValue = customModelMode || (savedModel !== '' && !modelInList && discoveredModels.length > 0)
    ? CUSTOM_MODEL_SENTINEL
    : savedModel || AUTO_MODEL_SENTINEL;

  const updateFields = (patch: Record<string, string | undefined>) => {
    const cleaned: Record<string, unknown> = { ...value };
    for (const [key, raw] of Object.entries(patch)) {
      const trimmed = raw?.trim();
      if (trimmed) cleaned[key] = trimmed;
      else delete cleaned[key];
    }
    onChange(cleaned as ExternalAgentExecution);
  };

  const accountBadge = formatAccountBadge(probe);
  const isAuthInProgress =
    authFlow !== null
    && (authFlow.phase === 'starting' || authFlow.phase === 'waiting' || authFlow.phase === 'verifying');
  const canSignIn = Boolean(probe?.installed) && probe?.status !== 'ready' && !isAuthInProgress;
  const agyUsesCredentials =
    value.kind === 'agy' && (value.authMethod === 'gemini-api-key' || value.authMethod === 'agent-platform');

  return (
    <div className="space-y-4">
      {/* Live status, in-UI OAuth sign-in & diagnostics card */}
      <section className="rounded-xl border border-edge bg-surface-base p-3.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <ExternalRuntimeStatusDot status={probing && !probe ? undefined : probe?.status} />
            <span className="text-sm font-medium text-fg">
              {externalRuntimeDisplayName(value.kind)}
            </span>
            <span className="rounded-full bg-surface-hover px-2 py-0.5 text-[11px] font-medium text-fg-muted">
              {probing && !probe
                ? (zh ? '检测中…' : 'Checking…')
                : externalRuntimeStatusLabel(probe?.status, zh)}
            </span>
            {probe?.version ? (
              <span className="rounded-md bg-surface-hover px-1.5 py-0.5 font-mono text-[10px] text-fg-muted">
                {probe.version}
              </span>
            ) : null}
          </div>
          <div className="flex items-center gap-1.5">
            {probe?.status === 'ready' && !isAuthInProgress ? (
              <Button
                type="button"
                variant="ghost"
                className="h-7 gap-1 px-2 text-xs text-fg-muted"
                disabled={disabled || loggingOut || probing}
                onClick={() => void handleLogout()}
              >
                {loggingOut ? <Loader2 className="size-3 animate-spin" aria-hidden /> : <LogOut className="size-3" aria-hidden />}
                {zh ? '退出登录' : 'Sign out'}
              </Button>
            ) : null}
            <Button
              type="button"
              variant="secondary"
              className="h-7 gap-1.5 px-2.5 text-xs"
              disabled={disabled || probing || isAuthInProgress}
              onClick={() => void runProbe(value)}
            >
              <RefreshCw className={cn('size-3', probing && 'animate-spin')} aria-hidden />
              {probing ? (zh ? '检测中…' : 'Testing…') : (zh ? '检测连接与模型' : 'Test & refresh')}
            </Button>
          </div>
        </div>

        {probing && !probe ? (
          <div className="mt-3 space-y-2">
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-3.5 w-1/2" />
          </div>
        ) : (
          <div className="mt-2 space-y-1.5 text-xs leading-5 text-fg-muted">
            {accountBadge && probe?.status === 'ready' ? (
              <p className="font-medium text-fg">
                {zh ? `当前账号：${accountBadge}` : `Signed in as ${accountBadge}`}
              </p>
            ) : null}
            {authSuccessNotice ? (
              <p className="text-emerald-600 dark:text-emerald-400">{authSuccessNotice}</p>
            ) : null}
            {probeError ? (
              <p className="text-red-600">{probeError}</p>
            ) : probe?.message && probe.status !== 'ready' ? (
              <p>{probe.message}</p>
            ) : probe?.status === 'ready' ? (
              <p>
                {probe.models.length > 0
                  ? (zh
                    ? `连接正常，共发现 ${probe.models.length} 个可用模型。`
                    : `Connected. Discovered ${probe.models.length} available models.`)
                  : (zh ? '宿主机 CLI 已就绪，可在项目会话中使用。' : 'Host CLI is ready for Project chats.')}
              </p>
            ) : null}
            {probe?.executablePath ? (
              <p className="truncate font-mono text-[11px] text-fg-subtle" title={probe.executablePath}>
                {probe.executablePath}
              </p>
            ) : null}

            {/* Primary in-UI Sign-in controls when CLI is installed but not signed in */}
            {canSignIn ? (
              <div className="pt-2">
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    type="button"
                    variant="primary"
                    className="h-8 gap-1.5 px-3 text-xs"
                    disabled={disabled || authBusy}
                    onClick={() => void handleStartAuth('browser')}
                  >
                    {authBusy ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <LogIn className="size-3.5" aria-hidden />}
                    {value.kind === 'codex'
                      ? (zh ? '使用 ChatGPT 登录' : 'Sign in with ChatGPT')
                      : value.kind === 'claude'
                        ? (zh ? '使用 Claude 登录' : 'Sign in with Claude')
                        : agyUsesCredentials
                          ? (zh ? '验证凭据并连接' : 'Verify & connect')
                          : (zh ? '使用 Google 账号登录' : 'Sign in with Google')}
                  </Button>
                  {value.kind === 'codex' ? (
                    <>
                      <Button
                        type="button"
                        variant="secondary"
                        className="h-8 gap-1.5 px-2.5 text-xs"
                        disabled={disabled || authBusy}
                        onClick={() => void handleStartAuth('device_code')}
                      >
                        <Smartphone className="size-3.5" aria-hidden />
                        {zh ? '设备码登录' : 'Device code'}
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        className="h-8 gap-1.5 px-2.5 text-xs"
                        disabled={disabled || authBusy}
                        onClick={() => setShowApiKeyInput((open) => !open)}
                      >
                        <KeyRound className="size-3.5" aria-hidden />
                        {zh ? '使用 API Key' : 'Use API key'}
                      </Button>
                    </>
                  ) : null}
                </div>

                {value.kind === 'codex' && showApiKeyInput ? (
                  <div className="mt-2.5 flex flex-wrap items-center gap-2">
                    <input
                      type="password"
                      className={`${inputClass} min-w-0 flex-1 py-1.5 font-mono text-xs`}
                      value={apiKeyInput}
                      disabled={disabled || authBusy}
                      onChange={(event) => setApiKeyInput(event.target.value)}
                      placeholder="sk-..."
                      aria-label="OpenAI API Key"
                    />
                    <Button
                      type="button"
                      variant="primary"
                      className="h-8 px-3 text-xs"
                      disabled={disabled || authBusy || !apiKeyInput.trim()}
                      onClick={() => void handleStartAuth('api_key', apiKeyInput.trim())}
                    >
                      {zh ? '验证并保存' : 'Save key'}
                    </Button>
                  </div>
                ) : null}
              </div>
            ) : null}

            {/* Active OAuth / Device Code interactive panel */}
            {authFlow ? (
              <div className="mt-2.5 space-y-2.5 rounded-xl border border-accent/25 bg-accent/5 p-3 text-xs">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2 text-fg">
                    {isAuthInProgress ? <Loader2 className="size-3.5 shrink-0 animate-spin text-accent" aria-hidden /> : null}
                    <span className="font-medium">
                      {authFlow.phase === 'failed'
                        ? (zh ? '登录未完成' : 'Sign-in failed')
                        : authFlow.phase === 'verifying'
                          ? (zh ? '正在校验登录状态并拉取模型…' : 'Verifying sign-in and loading models…')
                          : authFlow.phase === 'starting'
                            ? (zh ? '正在启动授权流程…' : 'Starting sign-in…')
                            : (zh ? '等待浏览器完成授权' : 'Waiting for browser sign-in')}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => void handleCancelAuth()}
                    className="shrink-0 text-[11px] font-medium text-fg-muted hover:text-fg"
                  >
                    {zh ? '取消' : 'Cancel'}
                  </button>
                </div>

                {authFlow.message ? (
                  <p className={cn('leading-5', authFlow.phase === 'failed' ? 'text-red-600' : 'text-fg-muted')}>
                    {authFlow.message}
                  </p>
                ) : null}

                {authFlow.userCode ? (
                  <div>
                    <p className="text-[11px] font-medium text-fg-muted">
                      {zh ? '一次性验证码：' : 'One-time verification code:'}
                    </p>
                    <CopyTextChip text={authFlow.userCode} icon="code" zh={zh} />
                  </div>
                ) : null}

                {authFlow.authorizationUrl ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      type="button"
                      variant="secondary"
                      className="h-7 gap-1.5 px-2.5 text-xs"
                      onClick={() => {
                        const win = reserveOAuthAuthorizationWindow();
                        void openOAuthAuthorizationUrl(authFlow.authorizationUrl!, win);
                      }}
                    >
                      <ExternalLink className="size-3" aria-hidden />
                      {zh ? '打开授权页面' : 'Open sign-in page'}
                    </Button>
                  </div>
                ) : null}

                {authFlow.phase === 'waiting' && authFlow.inputKind === 'code_or_url' ? (
                  <div className="space-y-1.5 pt-1">
                    <label className="block text-[11px] font-medium text-fg">
                      {zh ? '粘贴 Antigravity 页面上的授权码或回调链接：' : 'Paste the code or full URL from the Antigravity page:'}
                    </label>
                    <div className="flex items-center gap-2">
                      <input
                        className={`${inputClass} min-w-0 flex-1 py-1.5 font-mono text-xs`}
                        value={responseInput}
                        disabled={submittingResponse}
                        onChange={(event) => setResponseInput(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter' && responseInput.trim()) {
                            event.preventDefault();
                            void handleSubmitAuthResponse();
                          }
                        }}
                        placeholder={zh ? '粘贴授权码或 https://antigravity.google/oauth-callback?...' : 'Paste code or callback URL…'}
                      />
                      <Button
                        type="button"
                        variant="primary"
                        className="h-8 shrink-0 px-3 text-xs"
                        disabled={submittingResponse || !responseInput.trim()}
                        onClick={() => void handleSubmitAuthResponse()}
                      >
                        {submittingResponse ? <Loader2 className="size-3 animate-spin" aria-hidden /> : null}
                        {zh ? '提交' : 'Submit'}
                      </Button>
                    </div>
                  </div>
                ) : null}

                {authFlow.phase === 'waiting' && authFlow.inputKind === 'callback_url' ? (
                  <details className="pt-1">
                    <summary className="cursor-pointer text-[11px] font-medium text-fg-muted hover:text-fg">
                      {zh ? '远程访问无法自动跳转？手动粘贴跳转后的 localhost 链接' : 'Signing in remotely? Paste the redirected localhost URL'}
                    </summary>
                    <div className="mt-2 flex items-center gap-2">
                      <input
                        className={`${inputClass} min-w-0 flex-1 py-1.5 font-mono text-xs`}
                        value={responseInput}
                        disabled={submittingResponse}
                        onChange={(event) => setResponseInput(event.target.value)}
                        placeholder="http://localhost:.../auth/callback?code=..."
                      />
                      <Button
                        type="button"
                        variant="secondary"
                        className="h-8 shrink-0 px-3 text-xs"
                        disabled={submittingResponse || !responseInput.trim()}
                        onClick={() => void handleSubmitAuthResponse()}
                      >
                        {zh ? '完成登录' : 'Finish'}
                      </Button>
                    </div>
                  </details>
                ) : null}

                {authFlow.phase === 'failed' ? (
                  <div>
                    <Button
                      type="button"
                      variant="secondary"
                      className="h-7 gap-1.5 px-2.5 text-xs"
                      onClick={() => void handleStartAuth(authFlow.mode)}
                    >
                      <RefreshCw className="size-3" aria-hidden />
                      {zh ? '重新登录' : 'Try again'}
                    </Button>
                  </div>
                ) : null}
              </div>
            ) : null}

            {authError ? <p className="text-red-600">{authError}</p> : null}

            {/* Only show install command prominently when CLI binary is missing */}
            {probe?.status === 'not_installed' && probe.hintCommand ? (
              <CopyTextChip text={probe.hintCommand} zh={zh} />
            ) : null}
          </div>
        )}
      </section>

      {/* Model selection */}
      <div className="space-y-1.5">
        <label htmlFor={`ext-model-${value.kind}`} className="block text-xs font-medium text-fg-muted">
          {zh ? '默认模型（可选）' : 'Default model (optional)'}
        </label>
        {discoveredModels.length > 0 ? (
          <>
            <Select
              id={`ext-model-${value.kind}`}
              value={selectModelValue}
              disabled={disabled}
              onChange={(event) => {
                const next = event.target.value;
                if (next === AUTO_MODEL_SENTINEL) {
                  setCustomModelMode(false);
                  updateFields({ model: undefined });
                } else if (next === CUSTOM_MODEL_SENTINEL) {
                  setCustomModelMode(true);
                } else {
                  setCustomModelMode(false);
                  updateFields({ model: next });
                }
              }}
            >
              <SelectOption value={AUTO_MODEL_SENTINEL}>
                {zh ? '跟随 CLI 默认模型' : 'Auto (CLI default)'}
              </SelectOption>
              {discoveredModels.map((model) => (
                <SelectOption key={model.id} value={model.id}>
                  {model.label}{model.isDefault ? (zh ? '（默认）' : ' (default)') : ''}
                </SelectOption>
              ))}
              <SelectOption value={CUSTOM_MODEL_SENTINEL}>
                {zh ? '自定义模型 ID…' : 'Custom model ID…'}
              </SelectOption>
            </Select>
            {selectModelValue === CUSTOM_MODEL_SENTINEL ? (
              <input
                className={`${inputClass} mt-2 font-mono`}
                disabled={disabled}
                value={savedModel}
                onChange={(event) => updateFields({ model: event.target.value })}
                placeholder={
                  value.kind === 'codex'
                    ? 'gpt-5.3-codex'
                    : value.kind === 'claude'
                      ? 'claude-sonnet-4-6'
                      : 'gemini-3-pro'
                }
              />
            ) : null}
          </>
        ) : (
          <input
            id={`ext-model-${value.kind}`}
            className={`${inputClass} font-mono`}
            disabled={disabled}
            value={savedModel}
            onChange={(event) => updateFields({ model: event.target.value })}
            placeholder={zh ? '留空则使用 CLI 默认模型' : 'Leave empty to use CLI default'}
          />
        )}
        <p className="text-xs leading-5 text-fg-subtle">
          {zh
            ? '留空时自动跟随本机 CLI 的默认模型；完成登录后会自动拉取可用模型列表。'
            : 'Leave blank to use the CLI default model. Live models load automatically after sign-in.'}
        </p>
      </div>

      {/* Permission & approval mode */}
      <div className="space-y-1.5">
        <label htmlFor={`ext-perm-${value.kind}`} className="block text-xs font-medium text-fg-muted">
          {zh ? '权限与审批模式' : 'Permission & approval mode'}
        </label>
        <Select
          id={`ext-perm-${value.kind}`}
          value={value.permissionMode ?? 'full_access'}
          disabled={disabled}
          onChange={(event) => {
            const next = event.target.value;
            updateFields({ permissionMode: next === 'full_access' ? undefined : next });
          }}
        >
          {EXTERNAL_PERMISSION_MODES.map((mode) => (
            <SelectOption key={mode} value={mode}>
              {permissionModeLabel(mode, zh)}
            </SelectOption>
          ))}
        </Select>
        <p className="text-xs leading-5 text-fg-subtle">
          {zh
            ? '需要审批时会在对话输入框上方弹出确认卡；若会话处于「计划模式 / 只读」，会自动收紧为只读并弹窗确认。'
            : 'When approvals are required, a confirmation card appears above the chat composer. Plan/read-only sessions automatically tighten access.'}
        </p>
      </div>

      {/* AGY Auth Method */}
      {value.kind === 'agy' ? (
        <div className="space-y-1.5">
          <label htmlFor="ext-agy-auth-method" className="block text-xs font-medium text-fg-muted">
            {zh ? '认证方式' : 'Sign-in method'}
          </label>
          <Select
            id="ext-agy-auth-method"
            value={value.authMethod ?? AUTO_MODEL_SENTINEL}
            disabled={disabled}
            onChange={(event) => {
              const next = event.target.value;
              updateFields({ authMethod: next === AUTO_MODEL_SENTINEL ? undefined : next });
            }}
          >
            <SelectOption value={AUTO_MODEL_SENTINEL}>
              {zh ? '自动（Google 账号 OAuth）' : 'Auto (Google account OAuth)'}
            </SelectOption>
            {AGY_AUTH_METHODS.map((method) => (
              <SelectOption key={method} value={method}>
                {agyAuthMethodLabel(method, zh)}
              </SelectOption>
            ))}
          </Select>
          <p className="text-xs leading-5 text-fg-subtle">
            {zh
              ? '默认使用 Google 账号 OAuth；如需 Gemini Enterprise、API Key 或 Vertex AI 可在此切换。'
              : 'Uses Google account OAuth by default; switch here for Gemini Enterprise, API key, or Agent Platform.'}
          </p>
        </div>
      ) : null}

      {/* Codex Home Path */}
      {value.kind === 'codex' ? (
        <div className="space-y-1.5">
          <label className="block text-xs font-medium text-fg-muted">
            {zh ? 'CODEX_HOME 目录（可选）' : 'CODEX_HOME directory (optional)'}
          </label>
          <DirectoryPickerPathField
            value={value.homePath ?? ''}
            onChange={(homePath) => updateFields({ homePath })}
            disabled={disabled}
            wd={workingDirectoryMessages}
            placeholder="~/.codex"
            inputAriaLabel="CODEX_HOME"
            inputClassName={`${inputClass} font-mono`}
          />
          <p className="text-xs leading-5 text-fg-subtle">
            {zh
              ? '用于多账号隔离或自定义 Codex 配置目录；留空则使用默认 ~/.codex。修改后可点击上方登录按钮直接登录该目录。'
              : 'Custom Codex config/auth directory for multi-account setups (defaults to ~/.codex). Sign-in above applies to this directory.'}
          </p>
        </div>
      ) : null}

      {/* Advanced CLI overrides */}
      <details className="rounded-xl border border-edge bg-surface-base p-3.5">
        <summary className="cursor-pointer text-xs font-medium text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">
          {zh ? '高级 CLI 路径设置' : 'Advanced CLI path settings'}
          {value.binaryPath || (value.kind === 'agy' && value.geminiDir) || (value.kind === 'claude' && value.configDir) ? (
            <span className="ml-2 font-normal text-fg-muted">{zh ? '已自定义' : 'Customized'}</span>
          ) : null}
        </summary>
        <div className="mt-3.5 space-y-3.5">
          <label className="block text-xs font-medium text-fg-muted">
            {zh ? 'CLI 可执行文件路径（可选）' : 'Custom binary path (optional)'}
            <input
              className={`${inputClass} mt-1.5 font-mono`}
              disabled={disabled}
              value={value.binaryPath ?? ''}
              onChange={(event) => updateFields({ binaryPath: event.target.value })}
              placeholder={value.kind === 'codex' ? 'codex' : value.kind === 'claude' ? 'claude' : 'agy'}
            />
          </label>
          {value.kind === 'claude' ? (
            <div className="space-y-1.5">
              <label className="block text-xs font-medium text-fg-muted">
                {zh ? 'CLAUDE_CONFIG_DIR 目录（可选）' : 'CLAUDE_CONFIG_DIR directory (optional)'}
              </label>
              <DirectoryPickerPathField
                value={value.configDir ?? ''}
                onChange={(configDir) => updateFields({ configDir })}
                disabled={disabled}
                wd={workingDirectoryMessages}
                placeholder="~/.claude"
                inputAriaLabel="CLAUDE_CONFIG_DIR"
                inputClassName={`${inputClass} font-mono`}
              />
            </div>
          ) : null}
          {value.kind === 'agy' ? (
            <div className="space-y-1.5">
              <label className="block text-xs font-medium text-fg-muted">
                {zh ? 'GEMINI_HOME 配置目录（可选）' : 'GEMINI_HOME directory (optional)'}
              </label>
              <DirectoryPickerPathField
                value={value.geminiDir ?? ''}
                onChange={(geminiDir) => updateFields({ geminiDir })}
                disabled={disabled}
                wd={workingDirectoryMessages}
                placeholder="~/.gemini"
                inputAriaLabel="GEMINI_HOME"
                inputClassName={`${inputClass} font-mono`}
              />
            </div>
          ) : null}
        </div>
      </details>
    </div>
  );
}
