import { secretInputLabelsFromChannels } from '@/lib/secret-input-labels';
import { TelegramSetupGuide } from './telegram-setup-guide';
import { channelDocsUrl } from '@/navigation';
import { AlertTriangle, CircleAlert, CircleCheck, ExternalLink, Loader2, RotateCcw, Settings, Settings2 } from 'lucide-react';
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import useSWR from 'swr';

import { SettingsAdvancedSection } from '@/features/settings/settings-advanced-section';
import { Button } from '@/components/ui/button';
import type { CapabilityHeaderActionChange } from '@/features/capabilities/capability-header-actions';
import { PopoverSelect, type PopoverSelectOption } from '@/components/ui/popover-select';
import { SchemaForm, type JsonSchema } from '@/components/ui/schema-form';
import { SessionChannelIcon } from '@/components/shell/session-channel-icon';
import { ExtensionIframeHost } from '@/features/extensions/extension-iframe-host';
import { fetchChatAgents } from '@/features/chat/agent-selection/chat-agents-api';
import type { GatewayConfigBinding } from '@/features/settings/agents-admin-api';
import { agentListDisplayName } from '@/features/settings/agents/agent-display-names';
import { AgentAvatarDisplay } from '@/features/settings/agents/agent-avatar-display';
import { channelsStatusSwrKey, fetchChannelsStatusSwr } from '@/features/settings/channels-status-swr';
import { SettingsPageSkeleton } from '@/features/settings/settings-loading-skeleton';
import { SettingsPageFrame } from '@/features/settings/settings-page-layout';
import { apiFetch, fetchJson } from '@/lib/fetch';
import { apiUrl } from '@/lib/url';
import { cn } from '@/lib/cn';
import { messages } from '@/i18n/messages';
import { useGatewayStore } from '@/stores/gateway-store';
import { useLocaleStore } from '@/stores/locale-store';

import { CHANNELS_HUB_PATH, channelDetailPath, normalizeChannelRouteId } from './channels-routes';
import { choosePrimaryChannelAction } from './channel-primary-action';
import { ChannelSetupCard } from './channel-setup-card';
import { getChannelAgentBinding, mergeChannelAgentBinding } from './channel-agent-binding';
import { resolveChannelRuntime, type ChannelRuntimeState } from './channel-runtime';
import { ChannelSettingsShell } from './channel-settings-shell';
import { ChannelsPageHeaderActions } from './channels-page-header-actions';
import { ChannelsSettingsDialogFooter } from './channels-settings-dialog-footer';
import { useChannelCatalog, type ChannelCatalogEntry, type ChannelSetupIssue, type ChannelSetupStatus } from './use-channel-catalog';
import {
  parseChannelStatusRealtimeDetail,
  useChannelStatusRealtime,
} from './use-channel-status-realtime';

function configSwrKey(channelId: string | null): string | null {
  return channelId ? apiUrl(`/api/channels/${encodeURIComponent(channelId)}/config`) : null;
}

async function fetchChannelConfig(channelId: string): Promise<Record<string, unknown>> {
  const data = await fetchJson<{ ok?: boolean; payload?: { config?: Record<string, unknown> } }>(
    apiUrl(`/api/channels/${encodeURIComponent(channelId)}/config`),
  );
  return data.payload?.config ?? {};
}

type ChannelsSettingsConfig = {
  bindings: GatewayConfigBinding[];
};

const SCHEMA_FIELD_PATHS_MANAGED_OUTSIDE_FORM = ['enabled'];
const capabilityPageClassName = 'max-w-7xl';
const capabilityPagePadding = 'px-4 pb-7 pt-3 sm:px-6 lg:px-8 lg:pb-9 lg:pt-4';

async function fetchChannelsSettingsConfig(): Promise<ChannelsSettingsConfig> {
  const data = await fetchJson<{
    ok?: boolean;
    payload?: { config?: { bindings?: GatewayConfigBinding[] } };
  }>(
    apiUrl('/api/config'),
  );
  return {
    bindings: data.payload?.config?.bindings ?? [],
  };
}

function encodeAssetPath(entrypoint: string): string {
  return entrypoint
    .split('/')
    .filter(Boolean)
    .map((seg) => encodeURIComponent(seg))
    .join('/');
}

function channelConfigKey(entry: ChannelCatalogEntry): string {
  return entry.configPath.startsWith('channels.')
    ? entry.configPath.slice('channels.'.length).split('.')[0] || entry.id
    : entry.id;
}

function channelSetupStatus(entry: ChannelCatalogEntry): ChannelSetupStatus {
  const ready = entry.configured === true;
  const enabled = entry.enabled === true;
  return entry.setupStatus ?? {
    enabled,
    ready,
    state: enabled && !ready ? 'needs_setup' : enabled ? 'ready' : 'disabled',
    issues: [],
  };
}

function runtimeStatusLabel(runtime: ChannelRuntimeState, ch: ReturnType<typeof messages>['channelsSettings']): string {
  if (runtime === 'running') return ch.connectionRunning;
  if (runtime === 'stopped') return ch.connectionStopped;
  if (runtime === 'checking') return ch.connectionChecking;
  if (runtime === 'disabled') return ch.connectionDisabled;
  return ch.connectionNeedsSetup;
}

function runtimeStatusHint(runtime: ChannelRuntimeState, ch: ReturnType<typeof messages>['channelsSettings']): string {
  if (runtime === 'running') return ch.connectionRunningHint;
  if (runtime === 'stopped') return ch.connectionStoppedHint;
  if (runtime === 'disabled') return ch.connectionDisabledHint;
  if (runtime === 'needs_setup') return ch.connectionNeedsSetupHint;
  return ch.connectionChecking;
}

function runtimeStatusClass(runtime: ChannelRuntimeState): string {
  if (runtime === 'running') return 'bg-emerald-500/12 text-emerald-700 dark:text-emerald-300';
  if (runtime === 'stopped') return 'bg-red-500/10 text-red-700 dark:text-red-300';
  if (runtime === 'checking') return 'bg-amber-500/10 text-amber-700 dark:text-amber-300';
  return 'bg-surface-hover text-fg-muted';
}

function getBasicConfigPaths(entry: ChannelCatalogEntry | undefined): string[] {
  if (!entry) return [];
  const hints = entry.uiHints ?? {};
  const schemaRequired = isRecord(entry.configSchema) && Array.isArray(entry.configSchema.required)
    ? entry.configSchema.required.map(String)
    : [];
  const issuePaths = channelSetupStatus(entry).issues
    .map((issue) => issue.fieldPath)
    .filter((path): path is string => Boolean(path));
  const accessFields = new Set(['dmPolicy', 'groupPolicy', 'allowFrom', 'groupAllowFrom']);
  const accessPaths = [
    ...Object.keys(hints).filter((path) => !path.includes('*') && accessFields.has(path.split('.').at(-1) ?? '')),
    ...Object.keys(isRecord(entry.configSchema?.properties) ? entry.configSchema.properties : {}).filter((path) => accessFields.has(path)),
  ];
  const basic = Object.entries(hints)
    .filter(([, hint]) => {
      if (!isRecord(hint)) return false;
      if (hint.advanced === true) return false;
      const tags = Array.isArray(hint.tags) ? hint.tags.map(String) : [];
      return tags.includes('basic') || hint.advanced === false;
    })
    .map(([path]) => path)
    .filter((path) => !SCHEMA_FIELD_PATHS_MANAGED_OUTSIDE_FORM.includes(path));
  return Array.from(new Set([...basic, ...accessPaths, ...schemaRequired, ...issuePaths]))
    .filter((path) => !SCHEMA_FIELD_PATHS_MANAGED_OUTSIDE_FORM.includes(path));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function cloneSchema(schema: JsonSchema | undefined): JsonSchema {
  return JSON.parse(JSON.stringify(schema ?? { type: 'object', properties: {} })) as JsonSchema;
}

function pickSchemaPaths(schema: JsonSchema, paths: string[]): JsonSchema {
  const out = { ...cloneSchema(schema), properties: {} as Record<string, unknown> };
  for (const path of paths) {
    const parts = path.split('.');
    let src: Record<string, unknown> = schema;
    let dst: Record<string, unknown> = out;
    for (const [index, part] of parts.entries()) {
      const srcProps = src.properties;
      if (!isRecord(srcProps) || !isRecord(srcProps[part])) break;
      const dstProps = isRecord(dst.properties) ? dst.properties : {};
      dst.properties = dstProps;
      if (!dstProps[part]) dstProps[part] = { ...cloneSchema(srcProps[part]), properties: {} };
      if (index === parts.length - 1) {
        dstProps[part] = cloneSchema(srcProps[part]);
        break;
      }
      src = srcProps[part];
      dst = dstProps[part] as Record<string, unknown>;
    }
  }
  return out;
}

function removeEmptyObjectFields(schema: JsonSchema): boolean {
  const props = schema.properties;
  if (!isRecord(props)) return false;
  for (const [key, value] of Object.entries(props)) {
    if (!isRecord(value)) continue;
    if (value.type === 'object' && removeEmptyObjectFields(value)) {
      delete props[key];
    }
  }
  return Object.keys(props).length === 0;
}

function omitSchemaPaths(schema: JsonSchema, paths: string[]): JsonSchema {
  const out = cloneSchema(schema);
  for (const path of paths) {
    const parts = path.split('.');
    let cur: Record<string, unknown> = out;
    for (const [index, part] of parts.entries()) {
      const props = cur.properties;
      if (!isRecord(props)) break;
      if (index === parts.length - 1) {
        delete props[part];
        break;
      }
      if (!isRecord(props[part])) break;
      cur = props[part];
    }
  }
  removeEmptyObjectFields(out);
  return out;
}

function hasSchemaFields(schema: JsonSchema): boolean {
  return schema.type === 'object' && isRecord(schema.properties) && Object.keys(schema.properties).length > 0;
}

function setupIssueText(issue: ChannelSetupIssue, ch: ReturnType<typeof messages>['channelsSettings']): string {
  if (issue.code === 'telegram.missing_credential') return ch.setupIssueTelegramMissingCredential;
  if (issue.code === 'weixin.missing_account') return ch.setupIssueWeixinMissingAccount;
  if (issue.code === 'feishu.missing_credentials') return ch.setupIssueFeishuMissingCredentials;
  if (issue.code === 'config.missing_required' && issue.fieldPath) {
    return ch.setupIssueMissingRequired.replace('{{field}}', issue.fieldPath);
  }
  return issue.message;
}

function ChannelIcon({ entry }: { entry: ChannelCatalogEntry }) {
  const [customIconFailed, setCustomIconFailed] = useState(false);
  const customIconSrc = useMemo(() => {
    if (!entry.ui?.icon || customIconFailed) return null;
    const url = new URL(
      apiUrl(`/api/extensions/${encodeURIComponent(entry.extensionId)}/assets/${encodeAssetPath(entry.ui.icon)}`),
    );
    return url.toString();
  }, [customIconFailed, entry.extensionId, entry.ui?.icon]);

  return (
    <span className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-surface-base text-fg">
      {customIconSrc ? (
        <img
          src={customIconSrc}
          alt=""
          draggable={false}
          className="size-7"
          aria-hidden
          onError={() => setCustomIconFailed(true)}
        />
      ) : (
        <SessionChannelIcon sourceChannel={entry.id} className="size-7" />
      )}
    </span>
  );
}

function ChannelEnabledSwitch({
  checked,
  disabled,
  onToggle,
  label,
}: {
  checked: boolean;
  disabled?: boolean;
  onToggle: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={(event) => {
        event.stopPropagation();
        onToggle();
      }}
      className={cn(
        'relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border transition-colors',
        checked ? 'border-accent bg-accent' : 'border-edge bg-surface-hover',
        disabled && 'cursor-not-allowed opacity-60',
      )}
    >
      <span
        className={cn(
          'size-5 rounded-full bg-white shadow-surface transition-transform',
          checked ? 'translate-x-5' : 'translate-x-0.5',
        )}
      />
    </button>
  );
}

function ChannelHubCard({
  entry,
  runtime,
  busy,
  restarting,
  ch,
  onOpen,
  onSettings,
  onToggle,
  onRestart,
}: {
  entry: ChannelCatalogEntry;
  runtime: ChannelRuntimeState;
  busy: boolean;
  restarting: boolean;
  ch: ReturnType<typeof messages>['channelsSettings'];
  onOpen: () => void;
  onSettings: () => void;
  onToggle: () => void;
  onRestart: () => void;
}) {
  const statusId = useId();
  const action = choosePrimaryChannelAction(entry);
  const label = runtime === 'disabled' ? ch.enableChannel
    : runtime === 'stopped' ? ch.restartChannel
    : runtime === 'running' ? ch.testMessage
    : action?.[1].result === 'qr' ? ch.scanToConnect
    : ch.connect;
  const pending = busy || restarting || runtime === 'checking';
  const status = restarting ? ch.restartingChannel
    : busy ? ch.enablingChannel
    : runtime === 'needs_setup' ? ch.pendingSetup
    : runtime === 'running' ? ch.connected
    : runtimeStatusLabel(runtime, ch);
  const settingsLabel = ch.channelSettingsLabel.replace('{{channel}}', entry.label);

  return (
    <article className={cn(
      'relative flex items-start justify-between gap-2 rounded-2xl bg-surface-inset p-4 transition-colors dark:bg-surface-overlay',
      !pending && 'hover:bg-surface-hover dark:hover:bg-surface-hover',
    )}>
      <button
        type="button"
        className="absolute inset-0 cursor-pointer rounded-2xl focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent disabled:cursor-default"
        aria-label={`${entry.label} · ${label}`}
        aria-describedby={statusId}
        title={pending ? undefined : label}
        onClick={runtime === 'disabled' ? onToggle : runtime === 'stopped' ? onRestart : onOpen}
        disabled={pending}
      />
      <div className="flex min-w-0 items-center gap-3">
        <ChannelIcon entry={entry} />
        <div className="min-w-0">
          <h2 className="truncate text-base font-semibold text-fg">{entry.label}</h2>
          <span id={statusId} className={cn(
            'mt-1 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium',
            runtimeStatusClass(pending ? 'checking' : runtime),
          )}>
            {pending ? <Loader2 aria-hidden className="size-3 shrink-0 motion-safe:animate-spin" /> : null}
            {status}
          </span>
        </div>
      </div>
      <Button type="button" variant="ghost" className="relative size-11 shrink-0 p-0"
        aria-label={settingsLabel} title={settingsLabel} onClick={onSettings}
      >
        <Settings className="size-4" />
      </Button>
    </article>
  );
}

function ChannelConnectionStatusPanel({
  runtime,
  restarting,
  checking,
  showConnectionOptions,
  canManageConnection,
  ch,
  onRestart,
  onCheck,
  onManageConnection,
}: {
  runtime: ChannelRuntimeState;
  restarting: boolean;
  checking: boolean;
  showConnectionOptions: boolean;
  canManageConnection: boolean;
  ch: ReturnType<typeof messages>['channelsSettings'];
  onRestart: () => void;
  onCheck: () => void;
  onManageConnection: () => void;
}) {
  const Icon =
    runtime === 'running'
      ? CircleCheck
      : runtime === 'stopped' || runtime === 'needs_setup'
        ? CircleAlert
        : Loader2;
  return (
    <section className="rounded-xl bg-surface-panel/80 p-4 shadow-surface">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <Icon className={cn(
            'mt-0.5 size-5 shrink-0',
            runtime === 'running' && 'text-emerald-600 dark:text-emerald-400',
            runtime === 'stopped' && 'text-red-600 dark:text-red-400',
            runtime === 'checking' && 'animate-spin text-amber-600 dark:text-amber-400',
            runtime === 'disabled' && 'text-fg-muted',
            runtime === 'needs_setup' && 'text-amber-600 dark:text-amber-400',
          )} />
          <div>
            <h3 className="text-sm font-semibold text-fg">{ch.connectionStatus}</h3>
            <p className="mt-1 text-sm text-fg-muted">{runtimeStatusHint(runtime, ch)}</p>
          </div>
        </div>
        <div className="flex shrink-0 gap-2">
          <Button type="button" variant="secondary" className="px-2.5 py-1.5 text-xs" disabled={checking || restarting} onClick={onCheck}>
            {checking ? <Loader2 className="size-4 animate-spin" /> : null}
            {checking ? ch.checkingConnection : ch.checkConnection}
          </Button>
          {runtime === 'stopped' ? (
            <Button type="button" variant="primary" className="px-2.5 py-1.5 text-xs" disabled={restarting || checking} onClick={onRestart}>
              {restarting ? <Loader2 className="size-4 animate-spin" /> : <RotateCcw className="size-4" />}
              {restarting ? ch.restartingChannel : ch.restartChannel}
            </Button>
          ) : null}
          {canManageConnection ? (
            <Button type="button" variant="ghost" className="px-2.5 py-1.5 text-xs" disabled={checking || restarting} onClick={onManageConnection}>
              {showConnectionOptions ? ch.hideConnectionOptions : ch.connectionOptions}
            </Button>
          ) : null}
        </div>
      </div>
    </section>
  );
}

function ChannelSetupReadinessBanner({
  entry,
  ch,
}: {
  entry: ChannelCatalogEntry;
  ch: ReturnType<typeof messages>['channelsSettings'];
}) {
  const setup = channelSetupStatus(entry);
  if (setup.ready || setup.issues.length === 0) return null;
  return (
    <section className="rounded-xl bg-amber-50 px-4 py-3 text-amber-950 dark:bg-amber-950/30 dark:text-amber-100">
      <div className="flex items-start gap-3">
        <AlertTriangle className="mt-0.5 size-4 shrink-0" />
        <div className="min-w-0">
          <h3 className="text-sm font-semibold">{ch.setupReadinessTitle}</h3>
          <p className="mt-1 text-sm leading-5 text-amber-900 dark:text-amber-200">
            {setup.enabled ? ch.setupReadinessEnabledBody : ch.setupReadinessDisabledBody}
          </p>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-amber-900 dark:text-amber-200">
            {setup.issues.map((issue) => (
              <li key={`${issue.code}:${issue.fieldPath ?? ''}`}>{setupIssueText(issue, ch)}</li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}

export function ChannelsSettingsPanel({
  channelId,
  onHeaderActionChange,
}: {
  channelId?: string;
  onHeaderActionChange?: CapabilityHeaderActionChange;
}) {
  const language = useLocaleStore((s) => s.language);
  const m = messages(language);
  const hasToken = useGatewayStore((s) => Boolean(s.conversationId));
  const navigate = useNavigate();
  const activeChannelId = normalizeChannelRouteId(channelId);

  const catalog = useChannelCatalog(hasToken, language);
  const mutateCatalog = catalog.mutate;
  const entries = catalog.entries;
  const { data: runtimeStatuses, mutate: mutateRuntimeStatuses, isValidating: isValidatingRuntime } = useSWR(
    hasToken ? channelsStatusSwrKey() : null,
    fetchChannelsStatusSwr,
    { revalidateOnFocus: true },
  );
  const { data: channelsSettingsConfig, mutate: mutateChannelsSettingsConfig } = useSWR(
    hasToken ? 'channels-config-map' : null,
    fetchChannelsSettingsConfig,
    { revalidateOnFocus: false },
  );
  const bindings = channelsSettingsConfig?.bindings ?? [];
  const { data: agentsData } = useSWR(
    hasToken ? 'channel-routing-agents' : null,
    fetchChatAgents,
    { revalidateOnFocus: false },
  );
  const activeEntry = useMemo(
    () => entries.find((entry) => entry.id === activeChannelId),
    [activeChannelId, entries],
  );
  const activeConfigKey = activeEntry ? channelConfigKey(activeEntry) : null;

  const { data: remoteConfig, mutate: mutateConfig } = useSWR(
    hasToken && activeConfigKey ? configSwrKey(activeConfigKey) : null,
    () => fetchChannelConfig(activeConfigKey!),
  );
  const [quickConnection, setQuickConnection] = useState<{ id: string; test: boolean } | null>(null);
  const quickEntry = entries.find((entry) => entry.id === quickConnection?.id);
  const [draft, setDraft] = useState<Record<string, unknown> | null>(null);
  const [saving, setSaving] = useState(false);
  const [toggleBusy, setToggleBusy] = useState<string | null>(null);
  const [restartingChannelId, setRestartingChannelId] = useState<string | null>(null);
  const [showConnectionOptions, setShowConnectionOptions] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [agentBindingDraft, setAgentBindingDraft] = useState<string | null>(null);

  const effectiveConfig = draft ?? remoteConfig ?? {};
  const ch = m.channelsSettings;
  const fullConfigSchema = useMemo(
    () => (activeEntry?.configSchema ?? { type: 'object', properties: {} }) as JsonSchema,
    [activeEntry?.configSchema],
  );
  const formConfigSchema = useMemo(
    () => omitSchemaPaths(fullConfigSchema, SCHEMA_FIELD_PATHS_MANAGED_OUTSIDE_FORM),
    [fullConfigSchema],
  );
  const basicConfigPaths = useMemo(() => getBasicConfigPaths(activeEntry), [activeEntry]);
  const basicConfigSchema = useMemo(
    () => activeEntry?.id === 'telegram' ? orderTelegramSetupSchema(pickSchemaPaths(formConfigSchema, basicConfigPaths)) : pickSchemaPaths(formConfigSchema, basicConfigPaths),
    [activeEntry?.id, basicConfigPaths, formConfigSchema],
  );
  const advancedConfigSchema = useMemo(
    () => omitSchemaPaths(formConfigSchema, basicConfigPaths),
    [activeEntry?.id, basicConfigPaths, formConfigSchema],
  );
  const hasBasicConfigFields = useMemo(() => hasSchemaFields(basicConfigSchema), [basicConfigSchema]);
  const channelAgentId = activeEntry
    ? agentBindingDraft ?? getChannelAgentBinding(bindings, activeEntry.id)
    : '';
  const agentOptions = useMemo<PopoverSelectOption[]>(() => (
    (agentsData?.items ?? []).map((agent) => ({
      value: agent.id,
      label: agentListDisplayName(agent, m.agentsSettings),
      icon: <AgentAvatarDisplay agentId={agent.id} avatar={agent.avatar} size={20} />,
    }))
  ), [agentsData?.items, m.agentsSettings]);
  const defaultAgent = agentsData?.items.find((agent) => agent.id === agentsData.defaultId);
  const defaultAgentName = defaultAgent
    ? agentListDisplayName(defaultAgent, m.agentsSettings)
    : agentsData?.defaultId ?? '';
  const defaultReplyLabel = defaultAgentName
    ? ch.agentRoutingDefault.replace('{{agent}}', defaultAgentName)
    : ch.agentRoutingSelect;
  const schemaLabels = useMemo(() => ({
    secretInputLabels: secretInputLabelsFromChannels(ch),
    defaultBooleanLabel: ch.schemaBooleanDefault,
    unsupportedArrayType: ch.schemaUnsupportedArrayType,
    arrayAddPlaceholder: ch.schemaArrayAddPlaceholder,
    unsupportedFieldType: (title: string, type?: string) => ch.schemaUnsupportedFieldType
      .replace('{{title}}', title)
      .replace('{{type}}', type ? ` (${type})` : ''),
  }), [ch]);

  const runtimeByChannel = useMemo(
    () => new Map((runtimeStatuses ?? []).map((status) => [status.name, status])),
    [runtimeStatuses],
  );
  const runtimeLoaded = runtimeStatuses !== undefined;
  const runtimeFor = useCallback(
    (entry: ChannelCatalogEntry) => resolveChannelRuntime(entry, runtimeByChannel.get(entry.id), runtimeLoaded),
    [runtimeByChannel, runtimeLoaded],
  );
  const refreshChannelState = useCallback(async () => {
    await Promise.all([mutateCatalog(), mutateRuntimeStatuses()]);
  }, [mutateCatalog, mutateRuntimeStatuses]);
  const onQuickChanged = useCallback(async () => {
    await Promise.all([refreshChannelState(), mutateChannelsSettingsConfig()]);
  }, [refreshChannelState, mutateChannelsSettingsConfig]);
  const onAdvancedSetupChanged = useCallback(async () => {
    await Promise.all([onQuickChanged(), mutateConfig()]);
  }, [onQuickChanged, mutateConfig]);
  const onChannelStatusEvent = useCallback((detail: unknown) => {
    const next = parseChannelStatusRealtimeDetail(detail);
    if (next) void mutateRuntimeStatuses(next, false);
  }, [mutateRuntimeStatuses]);
  useChannelStatusRealtime(onChannelStatusEvent, hasToken);

  const headerContribution = useMemo(
    () => hasToken ? ({ secondary: (
      <ChannelsPageHeaderActions
        ch={ch}
        refreshing={catalog.isValidating || isValidatingRuntime}
        saveOk={false}
        onRefresh={() => void refreshChannelState()}
      />
    ) }) : null,
    [catalog.isValidating, ch, hasToken, isValidatingRuntime, refreshChannelState],
  );

  useLayoutEffect(() => {
    onHeaderActionChange?.(headerContribution);
    return () => onHeaderActionChange?.(null);
  }, [headerContribution, onHeaderActionChange]);

  const openChannel = useCallback((id: string) => {
    setQuickConnection(null);
    navigate(channelDetailPath(id));
    setDraft(null);
    setAgentBindingDraft(null);
    setError(null);
  }, [navigate]);

  const closeChannel = useCallback(() => {
    navigate(CHANNELS_HUB_PATH);
    setDraft(null);
    setAgentBindingDraft(null);
    setError(null);
  }, [navigate]);

  const restartChannel = useCallback(async (entry: ChannelCatalogEntry) => {
    setRestartingChannelId(entry.id);
    setError(null);
    try {
      const res = await apiFetch(apiUrl(`/api/channels/${encodeURIComponent(entry.id)}/restart`), { method: 'POST' });
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: { message?: string } };
        throw new Error(body.error?.message ?? res.statusText);
      }
      await refreshChannelState();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRestartingChannelId(null);
    }
  }, [refreshChannelState]);

  useEffect(() => {
    setAgentBindingDraft(null);
    setShowConnectionOptions(false);
  }, [activeEntry?.id]);

  const saveConfig = useCallback(async () => {
    if (!activeEntry || (!draft && agentBindingDraft === null)) return false;
    const key = channelConfigKey(activeEntry);
    setSaving(true);
    setError(null);
    try {
      const res = await apiFetch(apiUrl('/api/config'), {
        method: 'PATCH',
        body: JSON.stringify({
          ...(draft ? { channels: { [key]: draft } } : {}),
          ...(agentBindingDraft !== null
            ? { bindings: mergeChannelAgentBinding(bindings, activeEntry.id, agentBindingDraft) }
            : {}),
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: { message?: string } };
        throw new Error(body.error?.message ?? res.statusText);
      }
      if (draft) {
        await mutateConfig(draft, false);
      }
      await mutateChannelsSettingsConfig();
      await catalog.mutate();
      setDraft(null);
      setAgentBindingDraft(null);
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return false;
    } finally {
      setSaving(false);
    }
  }, [activeEntry, agentBindingDraft, bindings, catalog, draft, mutateChannelsSettingsConfig, mutateConfig]);

  const toggleChannel = useCallback(async (entry: ChannelCatalogEntry) => {
    const setup = channelSetupStatus(entry);
    const key = channelConfigKey(entry);
    const activeDraft = activeEntry?.id === entry.id ? draft : null;
    if (!setup.enabled && !setup.ready && !activeDraft) {
      openChannel(entry.id);
      return;
    }
    setToggleBusy(entry.id);
    setError(null);
    try {
      const nextConfig = setup.enabled
        ? { enabled: false }
        : activeDraft
          ? { ...activeDraft, enabled: true }
          : { enabled: true };
      const res = await apiFetch(apiUrl('/api/config'), {
        method: 'PATCH',
        body: JSON.stringify({ channels: { [key]: nextConfig } }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: { message?: string } };
        throw new Error(body.error?.message ?? res.statusText);
      }
      await catalog.mutate();
      await mutateChannelsSettingsConfig();
      await mutateRuntimeStatuses();
      if (activeEntry?.id === entry.id) {
        await mutateConfig();
        setDraft(null);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setToggleBusy(null);
    }
  }, [activeEntry?.id, catalog, draft, mutateChannelsSettingsConfig, mutateConfig, mutateRuntimeStatuses, openChannel]);

  const extensionModal = activeEntry?.ui?.modal;
  const showSchemaConfig = extensionModal?.placement !== 'replace-config';
  const activeRuntime = activeEntry ? runtimeFor(activeEntry) : 'checking';
  const showSetupCard = activeEntry
    ? !channelSetupStatus(activeEntry).ready || showConnectionOptions
    : false;

  if (!hasToken) {
    return (
      <SettingsPageFrame gap="gap-3" className={capabilityPageClassName} padding={capabilityPagePadding}>
        <p className="text-sm text-fg-muted">{ch.tokenRequired}</p>
      </SettingsPageFrame>
    );
  }

  return (
    <SettingsPageFrame
      gap="gap-4"
      className={capabilityPageClassName}
      padding={capabilityPagePadding}
    >
      {catalog.isLoading ? (
        <SettingsPageSkeleton sections={2} />
      ) : catalog.error ? (
        <p className="text-sm text-red-600 dark:text-red-400">{String(catalog.error)}</p>
      ) : (
        <div className="grid gap-5 md:grid-cols-2 md:gap-6 xl:grid-cols-3">
          {entries.map((entry) => (
            <ChannelHubCard
              key={entry.id}
              entry={entry}
              runtime={runtimeFor(entry)}
              busy={toggleBusy === entry.id}
              restarting={restartingChannelId === entry.id}
              ch={ch}
              onOpen={() => {
                const test = runtimeFor(entry) === 'running';
                if (test || (choosePrimaryChannelAction(entry) && entry.ui?.modal?.placement !== 'replace-config')) {
                  setQuickConnection({ id: entry.id, test });
                } else {
                  openChannel(entry.id);
                }
              }}
              onSettings={() => openChannel(entry.id)}
              onToggle={() => void toggleChannel(entry)}
              onRestart={() => void restartChannel(entry)}
            />
          ))}
        </div>
      )}

      {error ? <p className="mt-4 text-sm text-red-600 dark:text-red-400">{error}</p> : null}

      <ChannelSettingsShell
        presentation="modal"
        open={Boolean(quickEntry) && !activeEntry}
        onOpenChange={(open) => { if (!open) setQuickConnection(null); }}
        closeAriaLabel={ch.close}
        srTitle={quickEntry?.label ?? ch.connect}
        srDescription={quickEntry?.description ?? ch.setupEmptyHint}
        compact
        headerExtra={quickEntry ? (
          <div className="flex items-center justify-between gap-3 border-b border-edge py-3 pl-6 pr-14">
            <h2 className="text-base font-semibold text-fg">{quickEntry.label}</h2>
            <Button type="button" variant="ghost" className="size-11 shrink-0 p-0"
              aria-label={ch.channelSettingsLabel.replace('{{channel}}', quickEntry.label)}
              title={ch.advancedConfiguration} onClick={() => openChannel(quickEntry.id)}
            >
              <Settings className="size-4" />
            </Button>
          </div>
        ) : null}
      >
        {quickEntry && quickConnection?.test ? (
          <div className="space-y-3 text-sm text-fg-muted">
            <p>{ch.testMessageHint}</p>
            {quickEntry.docsPath ? (
              <a href={channelDocsUrl(language, quickEntry.docsPath)} target="_blank" rel="noreferrer"
                className="inline-flex items-center gap-1 text-accent hover:underline"
              >
                {ch.docs}<ExternalLink className="size-3.5" />
              </a>
            ) : null}
          </div>
        ) : quickEntry ? (
          <ChannelSetupCard key={quickEntry.id} entry={quickEntry} locale={language} messages={ch}
            onChanged={onQuickChanged} quick
          />
        ) : null}
      </ChannelSettingsShell>

      <ChannelSettingsShell
        presentation="modal"
        open={Boolean(activeEntry)}
        onOpenChange={(open) => {
          if (!open) closeChannel();
        }}
        closeAriaLabel={ch.close}
        srTitle={activeEntry?.label ?? ch.selectChannel}
        srDescription={activeEntry?.description}
        wide
        footer={
          activeEntry ? (
            <ChannelsSettingsDialogFooter
              ch={ch}
              dirty={Boolean(draft) || agentBindingDraft !== null}
              saving={saving}
              onCancel={closeChannel}
              onDiscard={() => {
                setDraft(null);
                setAgentBindingDraft(null);
              }}
              onSave={saveConfig}
            />
          ) : null
        }
      >
        {activeEntry ? (
          <div className="space-y-4">
            <div className="rounded-xl bg-surface-panel/80 p-3 shadow-surface">
              <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 items-start gap-3">
                  <ChannelIcon entry={activeEntry} />
                  <div className="min-w-0">
                    <div className="flex min-w-0 flex-wrap items-center gap-2">
                      <h2 className="truncate text-base font-semibold text-fg">{activeEntry.label}</h2>
                      <span className={cn('shrink-0 rounded-full px-2 py-0.5 text-xs font-medium', runtimeStatusClass(activeRuntime))}>
                        {runtimeStatusLabel(activeRuntime, ch)}
                      </span>
                    </div>
                    <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-sm text-fg-muted">
                      <span className="min-w-0 truncate">
                        {!channelSetupStatus(activeEntry).ready && choosePrimaryChannelAction(activeEntry)?.[1].result === 'qr'
                          ? ch.scanLoginHint.replace('{{channel}}', activeEntry.label)
                          : activeEntry.description}
                      </span>
                      {activeEntry.docsPath ? (
                        <a
                          href={channelDocsUrl(language, activeEntry.docsPath)}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex shrink-0 items-center gap-1 text-accent hover:underline"
                        >
                          {ch.docs}
                          <ExternalLink className="size-3.5" />
                        </a>
                      ) : null}
                    </div>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2 pr-8">
                  <span className="hidden text-xs text-fg-muted sm:inline">
                    {channelSetupStatus(activeEntry).enabled ? ch.enabledLabel : ch.disabledLabel}
                  </span>
                  <ChannelEnabledSwitch
                    checked={channelSetupStatus(activeEntry).enabled}
                    disabled={toggleBusy === activeEntry.id}
                    label={ch.toggleChannel.replace('{{channel}}', activeEntry.label)}
                    onToggle={() => void toggleChannel(activeEntry)}
                  />
                </div>
              </div>
            </div>

            <ChannelConnectionStatusPanel
              runtime={activeRuntime}
              restarting={restartingChannelId === activeEntry.id}
              checking={isValidatingRuntime}
              showConnectionOptions={showConnectionOptions}
              canManageConnection={channelSetupStatus(activeEntry).ready && extensionModal?.placement !== 'replace-config'}
              ch={ch}
              onRestart={() => void restartChannel(activeEntry)}
              onCheck={() => void refreshChannelState()}
              onManageConnection={() => setShowConnectionOptions((show) => !show)}
            />

            <ChannelSetupReadinessBanner entry={activeEntry} ch={ch} />
            {activeEntry.id === 'telegram' ? <TelegramSetupGuide language={language} /> : null}

            {showSetupCard && extensionModal?.placement !== 'replace-config' ? (
              <ChannelSetupCard
                key={activeEntry.id}
                entry={activeEntry}
                locale={language}
                messages={ch}
                compact
                onStarted={() => setShowConnectionOptions(true)}
                onChanged={onAdvancedSetupChanged}
              />
            ) : null}

            {extensionModal?.entrypoint && extensionModal.placement === 'before-config' ? (
              <ExtensionIframeHost
                extensionId={activeEntry.extensionId}
                extensionName={activeEntry.label}
                entrypoint={extensionModal.entrypoint}
                permissions={extensionModal.permissions}
                minHeight={extensionModal.minHeight}
                maxHeight={extensionModal.maxHeight}
                initialData={{ channelId: activeEntry.id, entry: activeEntry, config: effectiveConfig }}
              />
            ) : null}

            {extensionModal?.entrypoint && extensionModal.placement !== 'before-config' ? (
              <ExtensionIframeHost
                extensionId={activeEntry.extensionId}
                extensionName={activeEntry.label}
                entrypoint={extensionModal.entrypoint}
                permissions={extensionModal.permissions}
                minHeight={extensionModal.minHeight}
                maxHeight={extensionModal.maxHeight}
                initialData={{ channelId: activeEntry.id, entry: activeEntry, config: effectiveConfig }}
              />
            ) : null}

            {showSchemaConfig && hasBasicConfigFields ? (
              <section className="rounded-xl bg-surface-panel/80 p-4 shadow-surface">
                <div className="mb-4">
                  <h3 className="text-sm font-semibold text-fg">{ch.basicConfiguration}</h3>
                  <p className="mt-1 text-sm text-fg-muted">{ch.basicConfigurationHint}</p>
                </div>
                <SchemaForm
                  schema={basicConfigSchema}
                  values={effectiveConfig}
                  onChange={(next) => setDraft(next)}
                  disabled={saving}
                  labels={schemaLabels}
                />
              </section>
            ) : null}

            <details className="group rounded-xl bg-surface-panel/80 shadow-surface">
              <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3 text-sm font-medium text-fg marker:hidden [&::-webkit-details-marker]:hidden">
                <Settings2 className="size-4 text-fg-muted" />
                {ch.messageHandling}
              </summary>
              <div className="bg-surface-base/50 p-4">
                <div className="mb-3">
                  <h3 className="text-sm font-semibold text-fg">{ch.agentRouting}</h3>
                  <p className="mt-1 text-sm text-fg-muted">{ch.agentRoutingHint}</p>
                </div>
                <PopoverSelect
                  value={channelAgentId}
                  options={agentOptions}
                  placeholder={defaultReplyLabel}
                  ariaLabel={ch.agentRouting}
                  disabled={saving || !agentsData}
                  onChange={(agentId) => setAgentBindingDraft(agentId)}
                />
              </div>
            </details>

            {showSchemaConfig && hasSchemaFields(advancedConfigSchema) ? (
              <SettingsAdvancedSection title={ch.advancedConfiguration} summary={ch.messageHandlingHint}>
                <details className="group rounded-xl bg-surface-panel/80 shadow-surface">
                  <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3 text-sm font-medium text-fg marker:hidden [&::-webkit-details-marker]:hidden">
                    <Settings2 className="size-4 text-fg-muted" />
                    {ch.advancedConfiguration}
                  </summary>
                  <div className="bg-surface-base/50 p-4">
                    <SchemaForm
                      schema={advancedConfigSchema}
                      values={effectiveConfig}
                      onChange={(next) => setDraft(next)}
                      disabled={saving}
                      labels={schemaLabels}
                    />
                  </div>
                </details>
              </SettingsAdvancedSection>
            ) : null}

            {error ? <p className="text-sm text-red-600 dark:text-red-400">{error}</p> : null}
          </div>
        ) : null}
      </ChannelSettingsShell>
    </SettingsPageFrame>
  );
}

function orderTelegramSetupSchema(schema: JsonSchema): JsonSchema {
  const properties = schema.properties as Record<string, JsonSchema> | undefined;
  if (!properties) return schema;
  const order = ['botToken', 'dmPolicy', 'allowFrom', 'groupPolicy', 'groupAllowFrom'];
  return { ...schema, properties: Object.fromEntries(Object.entries(properties).map(([key, value]) => [key,
    { ...orderTelegramSetupSchema(value), ...(order.includes(key) ? { 'x-order': order.indexOf(key) } : {}) }])) };
}
