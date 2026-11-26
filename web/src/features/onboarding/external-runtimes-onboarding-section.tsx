import {
  Check,
  ChevronDown,
  Copy,
  ExternalLink,
  KeyRound,
  Loader2,
  LogIn,
  RefreshCw,
  SlidersHorizontal,
  Smartphone,
} from 'lucide-react';
import { useMemo, useState } from 'react';

import { ExternalRuntimeAvatar } from '@/components/brand/external-runtime-avatar';
import { externalRuntimeLabel } from '@/components/brand/external-runtime-badge';
import { Button } from '@/components/ui/button';
import { Select, SelectOption } from '@/components/ui/popover-select';
import { Skeleton } from '@/components/ui/skeleton';
import type { DetectedImportSource, ImportSource } from '@/features/imports/import-api';
import {
  ExternalRuntimeStatusDot,
  externalRuntimeDisplayName,
  externalRuntimeStatusLabel,
} from '@/features/settings/agents/external-runtime-config';
import { useExternalRuntimeAuth } from '@/features/settings/agents/use-external-runtime-auth';
import {
  openOAuthAuthorizationUrl,
  reserveOAuthAuthorizationWindow,
} from '@/features/settings/oauth-authorization-window';
import {
  EXTERNAL_CONTEXT_ACCESS_MODES,
  EXTERNAL_PERMISSION_MODES,
  type ExternalAgentExecution,
  type ExternalAgentKind,
  type ExternalContextAccess,
  type ExternalPermissionMode,
  type ExternalRuntimeFastDetection,
  type ExternalRuntimeProbeResult,
  type GatewayAgentRow,
} from '@/features/settings/types/agent-gateway';
import { cn } from '@/lib/cn';

export const EXTERNAL_KIND_TO_IMPORT_SOURCE: Record<ExternalAgentKind, ImportSource> = {
  codex: 'codex',
  claude: 'claude-code',
  agy: 'antigravity',
};

const inputClass =
  'w-full rounded-lg border border-edge bg-surface-base px-2.5 py-1.5 text-xs text-fg outline-none focus:border-accent focus:ring-2 focus:ring-accent/15';

function permissionModeShortLabel(mode: ExternalPermissionMode, zh: boolean): string {
  if (mode === 'full_access') return zh ? '完全放行' : 'Full access';
  if (mode === 'auto_edit') return zh ? '自动改文件' : 'Auto-edit';
  return zh ? '逐项确认' : 'Ask each time';
}

function contextAccessShortLabel(mode: ExternalContextAccess, zh: boolean): string {
  if (mode === 'read_write') return zh ? '上下文读写' : 'Context read & write';
  if (mode === 'read_only') return zh ? '上下文只读' : 'Context read-only';
  if (mode === 'brief_only') return zh ? '仅简报' : 'Brief only';
  return zh ? '隔离' : 'Isolated';
}

function contextAccessOptionLabel(mode: ExternalContextAccess, zh: boolean): string {
  if (mode === 'read_write') {
    return zh ? '读写（推荐：热简报 + 读写记忆/笔记/任务）' : 'Read & write (warm brief + read/write notes & tasks)';
  }
  if (mode === 'read_only') {
    return zh ? '只读（热简报 + 读取记忆/笔记/任务）' : 'Read-only (warm brief + read notes & tasks)';
  }
  if (mode === 'brief_only') {
    return zh ? '仅热简报（不挂载 xopc MCP 工具）' : 'Brief only (no xopc MCP tools)';
  }
  return zh ? '关闭（完全隔离）' : 'Off (fully isolated)';
}

function InlineRuntimeAuthPanel({
  kind,
  zh,
  disabled,
  onSignedIn,
  onClose,
}: {
  kind: ExternalAgentKind;
  zh: boolean;
  disabled?: boolean;
  onSignedIn: (probe?: ExternalRuntimeProbeResult) => void;
  onClose: () => void;
}) {
  const execution = useMemo<ExternalAgentExecution>(() => ({ kind }), [kind]);
  const [copiedCode, setCopiedCode] = useState(false);
  const {
    authFlow,
    authBusy,
    authError,
    responseInput,
    setResponseInput,
    submittingResponse,
    showApiKeyInput,
    setShowApiKeyInput,
    apiKeyInput,
    setApiKeyInput,
    isAuthInProgress,
    handleStartAuth,
    handleSubmitAuthResponse,
    handleCancelAuth,
  } = useExternalRuntimeAuth({
    execution,
    disabled,
    zh,
    onSignedIn,
  });

  const copyCode = (code: string) => {
    void navigator.clipboard?.writeText(code).then(() => {
      setCopiedCode(true);
      window.setTimeout(() => setCopiedCode(false), 1_600);
    });
  };

  return (
    <div className="border-t border-edge-subtle bg-surface-base/75 px-4 py-3 text-xs">
      {!authFlow ? (
        <div className="space-y-2.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                variant="primary"
                className="h-7 gap-1.5 rounded-lg px-2.5 text-xs"
                disabled={disabled || authBusy}
                onClick={() => void handleStartAuth('browser')}
              >
                {authBusy ? <Loader2 className="size-3 animate-spin" aria-hidden /> : <LogIn className="size-3" aria-hidden />}
                {kind === 'codex'
                  ? (zh ? '使用 ChatGPT 登录' : 'Sign in with ChatGPT')
                  : kind === 'claude'
                    ? (zh ? '使用 Claude 登录' : 'Sign in with Claude')
                    : (zh ? '使用 Google 账号登录' : 'Sign in with Google')}
              </Button>
              {kind === 'codex' ? (
                <>
                  <Button
                    type="button"
                    variant="secondary"
                    className="h-7 gap-1 rounded-lg px-2 text-xs"
                    disabled={disabled || authBusy}
                    onClick={() => void handleStartAuth('device_code')}
                  >
                    <Smartphone className="size-3" aria-hidden />
                    {zh ? '设备码' : 'Device code'}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    className="h-7 gap-1 rounded-lg px-2 text-xs"
                    disabled={disabled || authBusy}
                    onClick={() => setShowApiKeyInput((open) => !open)}
                  >
                    <KeyRound className="size-3" aria-hidden />
                    {zh ? 'API Key' : 'API key'}
                  </Button>
                </>
              ) : null}
            </div>
            <button
              type="button"
              onClick={onClose}
              className="text-[11px] font-medium text-fg-muted hover:text-fg"
            >
              {zh ? '收起' : 'Close'}
            </button>
          </div>

          {kind === 'codex' && showApiKeyInput ? (
            <div className="flex items-center gap-2">
              <input
                type="password"
                className={`${inputClass} min-w-0 flex-1 font-mono`}
                value={apiKeyInput}
                disabled={disabled || authBusy}
                onChange={(event) => setApiKeyInput(event.target.value)}
                placeholder="sk-..."
                aria-label="OpenAI API Key"
              />
              <Button
                type="button"
                variant="primary"
                className="h-7 shrink-0 rounded-lg px-2.5 text-xs"
                disabled={disabled || authBusy || !apiKeyInput.trim()}
                onClick={() => void handleStartAuth('api_key', apiKeyInput.trim())}
              >
                {zh ? '验证并保存' : 'Save key'}
              </Button>
            </div>
          ) : null}
        </div>
      ) : (
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 text-fg">
              {isAuthInProgress ? <Loader2 className="size-3.5 shrink-0 animate-spin text-accent" aria-hidden /> : null}
              <span className="font-medium">
                {authFlow.phase === 'failed'
                  ? (zh ? '登录未完成' : 'Sign-in failed')
                  : authFlow.phase === 'verifying'
                    ? (zh ? '正在校验登录状态…' : 'Verifying sign-in…')
                    : (zh ? '等待浏览器完成授权' : 'Waiting for browser sign-in')}
              </span>
            </div>
            <button
              type="button"
              onClick={() => {
                void handleCancelAuth();
                onClose();
              }}
              className="text-[11px] font-medium text-fg-muted hover:text-fg"
            >
              {zh ? '取消' : 'Cancel'}
            </button>
          </div>

          {authFlow.message ? (
            <p className={cn('leading-5', authFlow.phase === 'failed' ? 'text-danger' : 'text-fg-muted')}>
              {authFlow.message}
            </p>
          ) : null}

          {authFlow.userCode ? (
            <div className="flex items-center justify-between gap-2 rounded-lg border border-edge bg-surface-panel px-2.5 py-1.5">
              <span className="font-mono text-xs font-semibold tracking-wider text-fg">{authFlow.userCode}</span>
              <button
                type="button"
                onClick={() => copyCode(authFlow.userCode!)}
                className="inline-flex items-center gap-1 text-[11px] font-medium text-fg-muted hover:text-fg"
              >
                {copiedCode ? <Check className="size-3 text-success" aria-hidden /> : <Copy className="size-3" aria-hidden />}
                {copiedCode ? (zh ? '已复制' : 'Copied') : (zh ? '复制验证码' : 'Copy code')}
              </button>
            </div>
          ) : null}

          {authFlow.authorizationUrl ? (
            <Button
              type="button"
              variant="secondary"
              className="h-7 gap-1.5 rounded-lg px-2.5 text-xs"
              onClick={() => {
                const win = reserveOAuthAuthorizationWindow();
                void openOAuthAuthorizationUrl(authFlow.authorizationUrl!, win);
              }}
            >
              <ExternalLink className="size-3" aria-hidden />
              {zh ? '打开授权页面' : 'Open sign-in page'}
            </Button>
          ) : null}

          {authFlow.phase === 'waiting' && (authFlow.inputKind === 'code_or_url' || authFlow.inputKind === 'callback_url') ? (
            <div className="flex items-center gap-2 pt-0.5">
              <input
                className={`${inputClass} min-w-0 flex-1 font-mono`}
                value={responseInput}
                disabled={submittingResponse}
                onChange={(event) => setResponseInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && responseInput.trim()) {
                    event.preventDefault();
                    void handleSubmitAuthResponse();
                  }
                }}
                placeholder={
                  authFlow.inputKind === 'code_or_url'
                    ? (zh ? '粘贴授权码或回调链接…' : 'Paste code or callback URL…')
                    : (zh ? '远程访问可粘贴跳转后的 localhost 链接…' : 'Paste redirected localhost URL…')
                }
              />
              <Button
                type="button"
                variant="primary"
                className="h-7 shrink-0 rounded-lg px-2.5 text-xs"
                disabled={submittingResponse || !responseInput.trim()}
                onClick={() => void handleSubmitAuthResponse()}
              >
                {submittingResponse ? <Loader2 className="size-3 animate-spin" aria-hidden /> : null}
                {zh ? '提交' : 'Submit'}
              </Button>
            </div>
          ) : null}

          {authFlow.phase === 'failed' ? (
            <Button
              type="button"
              variant="secondary"
              className="h-7 gap-1.5 rounded-lg px-2.5 text-xs"
              onClick={() => void handleStartAuth(authFlow.mode)}
            >
              <RefreshCw className="size-3" aria-hidden />
              {zh ? '重试登录' : 'Try again'}
            </Button>
          ) : null}
        </div>
      )}

      {authError ? <p className="mt-2 text-danger" role="alert">{authError}</p> : null}
    </div>
  );
}

export type ExternalRuntimesOnboardingSectionProps = {
  zh: boolean;
  loadingFast: boolean;
  loadingFull: boolean;
  refreshing: boolean;
  fastDetections: ExternalRuntimeFastDetection[];
  probes: ExternalRuntimeProbeResult[];
  existingAgents: GatewayAgentRow[];
  selectedKinds: Set<ExternalAgentKind>;
  permissionMode: ExternalPermissionMode;
  contextAccess: ExternalContextAccess;
  syncConfigs: boolean;
  importSources: DetectedImportSource[];
  hasSelectedProjects: boolean;
  projectDefaultRuntime: 'embedded' | ExternalAgentKind;
  disabled?: boolean;
  onToggleKind: (kind: ExternalAgentKind) => void;
  onRefresh: () => void;
  onRuntimeSignedIn: (kind: ExternalAgentKind, probe?: ExternalRuntimeProbeResult) => void;
  onPermissionModeChange: (mode: ExternalPermissionMode) => void;
  onContextAccessChange: (mode: ExternalContextAccess) => void;
  onSyncConfigsChange: (enabled: boolean) => void;
  onProjectDefaultRuntimeChange: (value: 'embedded' | ExternalAgentKind) => void;
  onCustomizeImport: (source: ImportSource) => void;
};

export function ExternalRuntimesOnboardingSection({
  zh,
  loadingFast,
  loadingFull,
  refreshing,
  fastDetections,
  probes,
  existingAgents,
  selectedKinds,
  permissionMode,
  contextAccess,
  syncConfigs,
  importSources,
  hasSelectedProjects,
  projectDefaultRuntime,
  disabled = false,
  onToggleKind,
  onRefresh,
  onRuntimeSignedIn,
  onPermissionModeChange,
  onContextAccessChange,
  onSyncConfigsChange,
  onProjectDefaultRuntimeChange,
  onCustomizeImport,
}: ExternalRuntimesOnboardingSectionProps) {
  const [authOpenKind, setAuthOpenKind] = useState<ExternalAgentKind | null>(null);
  const [presetExpanded, setPresetExpanded] = useState(false);

  const probeByKind = useMemo(() => new Map(probes.map((entry) => [entry.kind, entry])), [probes]);
  const fastByKind = useMemo(() => new Map(fastDetections.map((entry) => [entry.kind, entry])), [fastDetections]);
  const existingByKind = useMemo(() => {
    const map = new Map<ExternalAgentKind, GatewayAgentRow>();
    for (const agent of existingAgents) {
      const kind = agent.override.execution?.kind;
      if (kind && agent.override.enabled !== false && !map.has(kind)) {
        map.set(kind, agent);
      }
    }
    return map;
  }, [existingAgents]);

  const installedKinds = useMemo<ExternalAgentKind[]>(() => {
    const order: ExternalAgentKind[] = ['codex', 'agy', 'claude'];
    return order.filter((kind) => probeByKind.get(kind)?.installed || fastByKind.get(kind)?.installed);
  }, [fastByKind, probeByKind]);

  const matchingImportSources = useMemo(() => {
    const activeKinds = new Set<ExternalAgentKind>([
      ...selectedKinds,
      ...[...existingByKind.keys()].filter((kind) => installedKinds.includes(kind)),
    ]);
    const targetIds = new Set<ImportSource>([...activeKinds].map((kind) => EXTERNAL_KIND_TO_IMPORT_SOURCE[kind]));
    return importSources.filter((src) => src.detected && targetIds.has(src.id));
  }, [existingByKind, importSources, installedKinds, selectedKinds]);

  const projectDefaultOptions = useMemo<ExternalAgentKind[]>(() => {
    const order: ExternalAgentKind[] = ['codex', 'agy', 'claude'];
    return order.filter((kind) => selectedKinds.has(kind) || existingByKind.has(kind));
  }, [existingByKind, selectedKinds]);

  // Completely hidden when nothing is detected on the host.
  if (!loadingFast && installedKinds.length === 0) {
    return null;
  }

  return (
    <div className="xopc-apple-card space-y-2" data-onboarding-external-runtimes style={{ animationDelay: '20ms' }}>
      <div className="flex items-center justify-between px-1">
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-medium tracking-[0.02em] text-fg-subtle">
            {zh ? '本机编程助手' : 'Local coding agents'}
          </span>
          {selectedKinds.size > 0 ? (
            <span className="rounded-full bg-surface-panel px-2 py-0.5 text-[10px] font-medium text-fg-muted ring-1 ring-edge/80">
              {zh ? `将接入 ${selectedKinds.size} 个` : `${selectedKinds.size} to connect`}
            </span>
          ) : null}
        </div>
        <button
          type="button"
          disabled={disabled || refreshing || loadingFast}
          onClick={onRefresh}
          className="inline-flex items-center gap-1 text-[11px] font-medium text-fg-muted transition-colors hover:text-fg disabled:opacity-50"
        >
          <RefreshCw className={cn('size-3', (refreshing || loadingFull) && 'animate-spin')} aria-hidden />
          <span>{zh ? '重新检测' : 'Refresh'}</span>
        </button>
      </div>

      <div className="overflow-hidden rounded-2xl border border-edge/80 bg-surface-panel/95 shadow-surface">
        {loadingFast && installedKinds.length === 0 ? (
          <div className="space-y-2 p-3" aria-busy>
            <Skeleton className="h-12 rounded-xl" />
            <Skeleton className="h-12 rounded-xl" />
          </div>
        ) : (
          <div className="divide-y divide-edge-subtle">
            {installedKinds.map((kind) => {
              const probe = probeByKind.get(kind);
              const existingAgent = existingByKind.get(kind);
              const selected = selectedKinds.has(kind);
              const probingRow = !probe && loadingFull;
              const needsSignIn = probe?.status === 'unauthenticated';
              const isReady = probe?.status === 'ready';
              const authPanelOpen = authOpenKind === kind && !isReady;
              const accountLabel = probe?.account?.label?.trim();
              const statusSubtitle = probingRow
                ? null
                : isReady
                  ? [
                      accountLabel || (zh ? '已就绪' : 'Ready'),
                      probe.models.length > 0
                        ? (zh ? `${probe.models.length} 个模型` : `${probe.models.length} models`)
                        : null,
                    ].filter(Boolean).join(' · ')
                  : needsSignIn
                    ? (zh ? '已安装 · 需要登录账号后使用' : 'Installed · Sign in to connect')
                    : (probe?.message ?? externalRuntimeStatusLabel(probe?.status, zh));

              return (
                <div key={kind} data-external-runtime-row={kind}>
                  <div className="flex items-center gap-3 px-4 py-3">
                    <button
                      type="button"
                      disabled={disabled || Boolean(existingAgent) || needsSignIn || probingRow}
                      onClick={() => onToggleKind(kind)}
                      aria-pressed={Boolean(existingAgent) || selected}
                      className={cn(
                        'flex min-w-0 flex-1 items-center gap-3 text-left transition-opacity',
                        (existingAgent || needsSignIn || probingRow) ? 'cursor-default' : 'cursor-pointer',
                      )}
                    >
                      <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-surface-inset/75">
                        <ExternalRuntimeAvatar kind={kind} size={22} />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex flex-wrap items-center gap-1.5">
                          <span className="truncate text-[13.5px] font-medium text-fg">
                            {externalRuntimeDisplayName(kind)}
                          </span>
                          {probe?.version ? (
                            <span className="rounded-md bg-surface-inset px-1.5 py-0.5 font-mono text-[10px] text-fg-subtle">
                              {probe.version}
                            </span>
                          ) : null}
                        </span>
                        {probingRow ? (
                          <Skeleton className="mt-1.5 h-3 w-36" />
                        ) : (
                          <span className="mt-0.5 flex items-center gap-1.5 truncate text-xs text-fg-subtle">
                            <ExternalRuntimeStatusDot status={probe?.status} className="size-1.5" />
                            <span className="truncate">{statusSubtitle}</span>
                          </span>
                        )}
                      </span>
                    </button>

                    <div className="flex shrink-0 items-center gap-2">
                      {existingAgent ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-success-soft px-2.5 py-0.5 text-[11px] font-medium text-success">
                          <Check className="size-3" aria-hidden />
                          <span>{zh ? '已接入' : 'Connected'}</span>
                        </span>
                      ) : needsSignIn ? (
                        <Button
                          type="button"
                          variant="secondary"
                          disabled={disabled}
                          onClick={() => setAuthOpenKind((current) => (current === kind ? null : kind))}
                          className="h-7 gap-1 rounded-full px-2.5 text-xs"
                        >
                          <LogIn className="size-3" aria-hidden />
                          <span>{authPanelOpen ? (zh ? '收起' : 'Close') : (zh ? '登录' : 'Sign in')}</span>
                        </Button>
                      ) : probingRow ? (
                        <Skeleton className="size-[18px] rounded-full" />
                      ) : (
                        <button
                          type="button"
                          disabled={disabled}
                          onClick={() => onToggleKind(kind)}
                          aria-label={zh ? `选择接入 ${externalRuntimeDisplayName(kind)}` : `Select ${externalRuntimeDisplayName(kind)}`}
                          aria-pressed={selected}
                          className={cn(
                            'flex size-[18px] shrink-0 items-center justify-center rounded-full border transition-all duration-200',
                            selected ? 'xopc-check-pop border-accent bg-accent text-on-accent' : 'border-edge-strong bg-transparent',
                          )}
                        >
                          {selected ? <Check className="size-2.5 stroke-[2.6]" aria-hidden /> : null}
                        </button>
                      )}
                    </div>
                  </div>

                  {authPanelOpen ? (
                    <InlineRuntimeAuthPanel
                      kind={kind}
                      zh={zh}
                      disabled={disabled}
                      onClose={() => setAuthOpenKind(null)}
                      onSignedIn={(updatedProbe) => {
                        setAuthOpenKind(null);
                        onRuntimeSignedIn(kind, updatedProbe);
                      }}
                    />
                  ) : null}
                </div>
              );
            })}

            {/* Collapsible Collaboration & Sync Presets Summary Bar */}
            <div className="bg-surface-base/45">
              <button
                type="button"
                aria-expanded={presetExpanded}
                onClick={() => setPresetExpanded((open) => !open)}
                className="flex w-full items-center justify-between gap-2 px-4 py-2.5 text-left text-[11.5px] text-fg-muted transition-colors hover:bg-surface-hover/40 hover:text-fg"
              >
                <span className="flex min-w-0 items-center gap-1.5 truncate">
                  <SlidersHorizontal className="size-3 shrink-0 opacity-75" aria-hidden />
                  <span className="truncate">
                    {[
                      permissionModeShortLabel(permissionMode, zh),
                      contextAccessShortLabel(contextAccess, zh),
                      matchingImportSources.length > 0 && syncConfigs
                        ? (zh ? '同步已有技能与规则' : 'Sync skills & rules')
                        : null,
                      hasSelectedProjects && projectDefaultOptions.length > 0
                        ? (projectDefaultRuntime === 'embedded'
                          ? (zh ? '项目默认：xopc 内置' : 'Projects: Built-in')
                          : (zh
                            ? `项目默认：${externalRuntimeLabel(projectDefaultRuntime, 'short')}`
                            : `Projects: ${externalRuntimeLabel(projectDefaultRuntime, 'short')}`))
                        : null,
                    ].filter(Boolean).join(' · ')}
                  </span>
                </span>
                <span className="inline-flex shrink-0 items-center gap-1 text-[11px] font-medium text-fg-subtle">
                  <span>{presetExpanded ? (zh ? '收起' : 'Hide') : (zh ? '调整' : 'Customize')}</span>
                  <ChevronDown className={cn('size-3 transition-transform', presetExpanded && 'rotate-180')} aria-hidden />
                </span>
              </button>

              {presetExpanded ? (
                <div className="space-y-3 border-t border-edge-subtle px-4 py-3.5 text-xs">
                  {/* Permission mode */}
                  <div className="space-y-1.5">
                    <span className="block text-[11px] font-medium text-fg-muted">
                      {zh ? '执行权限' : 'Execution permission'}
                    </span>
                    <div className="grid grid-cols-3 gap-1.5">
                      {EXTERNAL_PERMISSION_MODES.map((mode) => {
                        const active = permissionMode === mode;
                        return (
                          <button
                            key={mode}
                            type="button"
                            disabled={disabled}
                            onClick={() => onPermissionModeChange(mode)}
                            aria-pressed={active}
                            className={cn(
                              'rounded-lg border px-2.5 py-1.5 text-center text-[11.5px] font-medium transition-colors',
                              active
                                ? 'border-accent/60 bg-accent-soft text-accent-fg'
                                : 'border-edge bg-surface-panel text-fg-muted hover:text-fg',
                            )}
                          >
                            {permissionModeShortLabel(mode, zh)}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Context & MCP access */}
                  <div className="space-y-1.5">
                    <label htmlFor="onboarding-ext-context-access" className="block text-[11px] font-medium text-fg-muted">
                      {zh ? 'xopc 上下文与记忆共享' : 'xopc context & memory sharing'}
                    </label>
                    <Select
                      id="onboarding-ext-context-access"
                      value={contextAccess}
                      disabled={disabled}
                      onChange={(event) => onContextAccessChange(event.target.value as ExternalContextAccess)}
                    >
                      {EXTERNAL_CONTEXT_ACCESS_MODES.map((mode) => (
                        <SelectOption key={mode} value={mode}>
                          {contextAccessOptionLabel(mode, zh)}
                        </SelectOption>
                      ))}
                    </Select>
                  </div>

                  {/* Project default agent binding */}
                  {hasSelectedProjects && projectDefaultOptions.length > 0 ? (
                    <div className="space-y-1.5">
                      <label htmlFor="onboarding-project-default-runtime" className="block text-[11px] font-medium text-fg-muted">
                        {zh ? '新创建项目的默认助手' : 'Default agent for new projects'}
                      </label>
                      <Select
                        id="onboarding-project-default-runtime"
                        value={projectDefaultRuntime}
                        disabled={disabled}
                        onChange={(event) => onProjectDefaultRuntimeChange(event.target.value as 'embedded' | ExternalAgentKind)}
                      >
                        {projectDefaultOptions.map((kind) => (
                          <SelectOption key={kind} value={kind}>
                            {externalRuntimeDisplayName(kind)}
                          </SelectOption>
                        ))}
                        <SelectOption value="embedded">
                          {zh ? 'xopc 内置智能体' : 'xopc built-in agent'}
                        </SelectOption>
                      </Select>
                    </div>
                  ) : null}

                  {/* Extension layer 1: safe skills & rules import */}
                  {matchingImportSources.length > 0 ? (
                    <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-edge-subtle bg-surface-panel/70 px-3 py-2">
                      <label className="flex min-w-0 cursor-pointer items-center gap-2 text-[11.5px] text-fg">
                        <input
                          type="checkbox"
                          className="size-3.5 accent-[var(--color-accent)]"
                          checked={syncConfigs}
                          disabled={disabled}
                          onChange={(event) => onSyncConfigsChange(event.target.checked)}
                        />
                        <span className="truncate">
                          {zh
                            ? `同时同步 ${matchingImportSources.map((s) => s.name).join('、')} 的已有技能与规则`
                            : `Also sync existing skills & rules from ${matchingImportSources.map((s) => s.name).join(', ')}`}
                        </span>
                      </label>
                      <div className="flex flex-wrap items-center gap-1.5">
                        {matchingImportSources.map((src) => (
                          <button
                            key={src.id}
                            type="button"
                            disabled={disabled}
                            onClick={() => onCustomizeImport(src.id)}
                            className="text-[11px] font-medium text-accent-fg hover:underline"
                          >
                            {matchingImportSources.length > 1
                              ? (zh ? `自定义 ${src.name}` : `Review ${src.name}`)
                              : (zh ? '自定义导入项' : 'Review items')}
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
