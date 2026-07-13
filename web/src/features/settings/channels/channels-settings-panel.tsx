import { AlertTriangle, ExternalLink, Loader2, Settings2 } from 'lucide-react';
import { useCallback, useLayoutEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import useSWR from 'swr';

import { Button } from '@/components/ui/button';
import { SchemaForm, type JsonSchema } from '@/components/ui/schema-form';
import { SessionChannelIcon } from '@/components/shell/session-channel-icon';
import { ExtensionIframeHost } from '@/features/extensions/extension-iframe-host';
import { SettingsPageSkeleton } from '@/features/settings/settings-loading-skeleton';
import { SettingsPageFrame, SettingsPageHeader } from '@/features/settings/settings-page-layout';
import { apiFetch, fetchJson } from '@/lib/fetch';
import { apiUrl } from '@/lib/url';
import { cn } from '@/lib/cn';
import { messages } from '@/i18n/messages';
import { useGatewayStore } from '@/stores/gateway-store';
import { useLocaleStore } from '@/stores/locale-store';
import { usePageHeaderStore } from '@/stores/page-header-store';

import { CHANNELS_HUB_PATH, channelDetailPath, normalizeChannelRouteId } from './channels-routes';
import { ChannelSetupCard, choosePrimaryChannelAction } from './channel-setup-card';
import { ChannelSettingsShell } from './channel-settings-shell';
import { ChannelsPageHeaderActions } from './channels-page-header-actions';
import { ChannelsSettingsDialogFooter } from './channels-settings-dialog-footer';
import { useChannelCatalog, type ChannelCatalogEntry, type ChannelSetupIssue, type ChannelSetupStatus } from './use-channel-catalog';

function configSwrKey(channelId: string | null): string | null {
  return channelId ? apiUrl(`/api/channels/${encodeURIComponent(channelId)}/config`) : null;
}

async function fetchChannelConfig(channelId: string): Promise<Record<string, unknown>> {
  const data = await fetchJson<{ ok?: boolean; payload?: { config?: Record<string, unknown> } }>(
    apiUrl(`/api/channels/${encodeURIComponent(channelId)}/config`),
  );
  return data.payload?.config ?? {};
}

type ChannelsConfigMap = Record<string, { config?: Record<string, unknown> }>;

const SCHEMA_FIELD_PATHS_MANAGED_OUTSIDE_FORM = ['enabled'];

async function fetchChannelsConfigMap(): Promise<ChannelsConfigMap> {
  const data = await fetchJson<{ ok?: boolean; payload?: { config?: { channels?: ChannelsConfigMap } } }>(
    apiUrl('/api/config'),
  );
  return data.payload?.config?.channels ?? {};
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

function statusLabel(entry: ChannelCatalogEntry, ch: ReturnType<typeof messages>['channelsSettings']): string {
  const setup = channelSetupStatus(entry);
  if (setup.state === 'needs_setup') return ch.hubStatusNeedsSetup;
  if (setup.state === 'error') return ch.hubStatusError;
  if (setup.enabled && setup.ready && entry.runtime === 'loaded') return ch.hubStatusRunning;
  if (setup.enabled && setup.ready) return ch.hubStatusEnabled;
  if (setup.ready) return ch.hubStatusConfigured;
  return ch.hubStatusNotConfigured;
}

function statusClass(entry: ChannelCatalogEntry): string {
  const setup = channelSetupStatus(entry);
  if (setup.state === 'needs_setup') return 'bg-amber-500/10 text-amber-700 dark:text-amber-300';
  if (setup.state === 'error') return 'bg-red-500/10 text-red-700 dark:text-red-300';
  if (setup.enabled && setup.ready && entry.runtime === 'loaded') return 'bg-emerald-500/12 text-emerald-700 dark:text-emerald-300';
  if (setup.enabled || setup.ready) return 'bg-accent-soft text-accent';
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
  const basic = Object.entries(hints)
    .filter(([, hint]) => {
      if (!isRecord(hint)) return false;
      if (hint.advanced === true) return false;
      const tags = Array.isArray(hint.tags) ? hint.tags.map(String) : [];
      return tags.includes('basic') || hint.advanced === false;
    })
    .map(([path]) => path)
    .filter((path) => !SCHEMA_FIELD_PATHS_MANAGED_OUTSIDE_FORM.includes(path));
  return Array.from(new Set([...basic, ...schemaRequired, ...issuePaths]))
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

function readPath(value: Record<string, unknown>, path: string): unknown {
  let cur: unknown = value;
  for (const part of path.split('.')) {
    if (!isRecord(cur)) return undefined;
    cur = cur[part];
  }
  return cur;
}

function countAccounts(config: Record<string, unknown>): number {
  const accounts = config.accounts;
  if (!isRecord(accounts)) return config.configured === true ? 1 : 0;
  return Object.values(accounts).filter((account) => isRecord(account) && account.enabled !== false).length;
}

function formatSummaryValue(path: string, value: unknown, ch: ReturnType<typeof messages>['channelsSettings']): string | null {
  if (value === undefined || value === null || value === '') return null;
  if (path.toLowerCase().includes('dmpolicy') && typeof value === 'string') {
    return `${ch.dmPolicy}: ${ch.policy.dm[value as keyof typeof ch.policy.dm] ?? value}`;
  }
  if ((path.toLowerCase().includes('stream') || path.toLowerCase().includes('streaming')) && typeof value === 'string') {
    return `${ch.cardStream}: ${ch.policy.stream[value as keyof typeof ch.policy.stream] ?? value}`;
  }
  if (typeof value === 'boolean') return value ? ch.enabledLabel : ch.disabledLabel;
  return String(value);
}

function channelSummary(
  entry: ChannelCatalogEntry,
  config: Record<string, unknown> | undefined,
  ch: ReturnType<typeof messages>['channelsSettings'],
): string[] {
  const out: string[] = [];
  const setup = channelSetupStatus(entry);
  if (setup.issues.length > 0) {
    out.push(setupIssueText(setup.issues[0], ch));
  }
  if (config) {
    const fields = entry.ui?.card?.summaryFields ?? ['dmPolicy', 'streamMode', 'streaming.mode'];
    for (const field of fields) {
      const text = formatSummaryValue(field, readPath(config, field), ch);
      if (text) out.push(text);
    }
    const accounts = countAccounts(config);
    if (accounts > 0) out.push(ch.cardAccounts.replace('{{count}}', String(accounts)));
  }
  if (out.length > 0) return out.slice(0, 2);
  if (setup.ready) return [ch.hubStatusConfigured];
  return [];
}

function channelActionLabel(entry: ChannelCatalogEntry, ch: ReturnType<typeof messages>['channelsSettings']): string {
  const setup = channelSetupStatus(entry);
  const primary = choosePrimaryChannelAction(entry);
  if (setup.state === 'needs_setup') return primary?.[1].label ?? ch.completeSetup;
  if (!setup.enabled && setup.ready) return ch.enableChannel;
  if (setup.state === 'error') return ch.diagnose;
  return setup.ready ? ch.manageChannel : primary?.[1].label ?? ch.startConfiguration;
}

function channelSetupHint(entry: ChannelCatalogEntry, ch: ReturnType<typeof messages>['channelsSettings']): string {
  const primary = choosePrimaryChannelAction(entry);
  if (primary?.[1].result === 'qr') return ch.cardSetupQrHint;
  if (primary?.[1].result === 'form') return ch.cardSetupConfigHint;
  return ch.cardSetupGenericHint;
}

function channelCapabilityLabels(
  entry: ChannelCatalogEntry,
  ch: ReturnType<typeof messages>['channelsSettings'],
): string[] {
  const c = entry.capabilities ?? {};
  const labels: string[] = [];
  if (c.login === true) labels.push(ch.cardCapabilityLogin);
  if (c.pairing === true) labels.push(ch.cardCapabilityPairing);
  if (c.multiAccount === true) labels.push(ch.cardCapabilityMultiAccount);
  if (c.streaming === true) labels.push(ch.cardCapabilityStreaming);
  if (c.media === true) labels.push(ch.cardCapabilityMedia);
  if (c.doctor === true) labels.push(ch.cardCapabilityDoctor);
  return labels.slice(0, 3);
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
  const gatewayToken = useGatewayStore((s) => s.token);
  const [customIconFailed, setCustomIconFailed] = useState(false);
  const customIconSrc = useMemo(() => {
    if (!entry.ui?.icon || customIconFailed) return null;
    const url = new URL(
      apiUrl(`/api/extensions/${encodeURIComponent(entry.extensionId)}/assets/${encodeAssetPath(entry.ui.icon)}`),
    );
    if (gatewayToken?.trim()) url.searchParams.set('token', gatewayToken.trim());
    return url.toString();
  }, [customIconFailed, entry.extensionId, entry.ui?.icon, gatewayToken]);

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
  config,
  busy,
  ch,
  onOpen,
  onToggle,
}: {
  entry: ChannelCatalogEntry;
  config?: Record<string, unknown>;
  busy: boolean;
  ch: ReturnType<typeof messages>['channelsSettings'];
  onOpen: () => void;
  onToggle: () => void;
}) {
  const setup = channelSetupStatus(entry);
  const summary = channelSummary(entry, config, ch);
  const capabilityLabels = channelCapabilityLabels(entry, ch);
  const canDirectEnable = !setup.enabled && setup.ready;
  return (
    <article
      className="flex min-h-[15.5rem] flex-col rounded-xl bg-surface-panel p-4 shadow-surface transition-colors hover:bg-surface-hover/45"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 items-start gap-3">
          <ChannelIcon entry={entry} />
          <div className="min-w-0">
            <h2 className="truncate text-base font-semibold text-fg">{entry.label}</h2>
            <span className={cn('mt-1 inline-flex rounded-full px-2 py-0.5 text-xs font-medium', statusClass(entry))}>
              {statusLabel(entry, ch)}
            </span>
          </div>
        </div>
        <ChannelEnabledSwitch
          checked={setup.enabled}
          disabled={busy}
          label={ch.toggleChannel.replace('{{channel}}', entry.label)}
          onToggle={onToggle}
        />
      </div>

      <button type="button" onClick={onOpen} className="mt-5 min-h-[6.25rem] text-left">
        {setup.ready ? (
          <>
            <p className="line-clamp-2 text-sm leading-6 text-fg-muted">{entry.description ?? entry.id}</p>
            {summary.length > 0 ? (
              <div className="mt-3 space-y-0.5 text-sm leading-5 text-fg-muted">
                {summary.map((item) => (
                  <p key={item} className="truncate" title={item}>
                    {item}
                  </p>
                ))}
              </div>
            ) : null}
          </>
        ) : (
          <div className="rounded-lg bg-surface-base px-3 py-3">
            <p className="text-sm font-medium text-fg">{ch.cardSetupTitle}</p>
            <p className="mt-1 line-clamp-2 text-sm leading-5 text-fg-muted">
              {summary[0] ?? channelSetupHint(entry, ch)}
            </p>
            {capabilityLabels.length > 0 ? (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {capabilityLabels.map((label) => (
                  <span key={label} className="rounded-full bg-surface-hover px-2 py-0.5 text-xs text-fg-muted">
                    {label}
                  </span>
                ))}
              </div>
            ) : null}
          </div>
        )}
        {!setup.ready && entry.description ? (
          <p className="mt-3 truncate text-xs text-fg-subtle" title={entry.description}>
            {ch.cardAdapterLabel}: {entry.description}
          </p>
        ) : null}
      </button>

      <div className="mt-auto pt-4">
        <Button type="button" variant="primary" className="w-full rounded-2xl py-2.5" onClick={canDirectEnable ? onToggle : onOpen}>
          {busy ? <Loader2 className="size-4 animate-spin" /> : null}
          {channelActionLabel(entry, ch)}
        </Button>
      </div>
    </article>
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
    <section className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-amber-950 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-100">
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

export function ChannelsSettingsPanel() {
  const language = useLocaleStore((s) => s.language);
  const m = messages(language);
  const hasToken = useGatewayStore((s) => Boolean(s.token));
  const navigate = useNavigate();
  const { channelId: routeChannelId } = useParams<{ channelId?: string }>();
  const activeChannelId = normalizeChannelRouteId(routeChannelId);

  const catalog = useChannelCatalog(hasToken, language);
  const entries = catalog.entries;
  const { data: channelsConfig = {}, mutate: mutateChannelsConfig } = useSWR(
    hasToken ? 'channels-config-map' : null,
    fetchChannelsConfigMap,
    { revalidateOnFocus: false },
  );
  const setPageHeader = usePageHeaderStore((s) => s.setPageHeader);
  const clearPageHeader = usePageHeaderStore((s) => s.clearPageHeader);
  const activeEntry = useMemo(
    () => entries.find((entry) => entry.id === activeChannelId),
    [activeChannelId, entries],
  );
  const activeConfigKey = activeEntry ? channelConfigKey(activeEntry) : null;

  const { data: remoteConfig, mutate: mutateConfig } = useSWR(
    hasToken && activeConfigKey ? configSwrKey(activeConfigKey) : null,
    () => fetchChannelConfig(activeConfigKey!),
  );
  const [draft, setDraft] = useState<Record<string, unknown> | null>(null);
  const [saving, setSaving] = useState(false);
  const [toggleBusy, setToggleBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

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
    () => pickSchemaPaths(formConfigSchema, basicConfigPaths),
    [basicConfigPaths, formConfigSchema],
  );
  const advancedConfigSchema = useMemo(
    () => omitSchemaPaths(formConfigSchema, basicConfigPaths),
    [basicConfigPaths, formConfigSchema],
  );
  const hasBasicConfigFields = useMemo(() => hasSchemaFields(basicConfigSchema), [basicConfigSchema]);
  const schemaLabels = useMemo(() => ({
    defaultBooleanLabel: ch.schemaBooleanDefault,
    unsupportedArrayType: ch.schemaUnsupportedArrayType,
    arrayAddPlaceholder: ch.schemaArrayAddPlaceholder,
    unsupportedFieldType: (title: string, type?: string) => ch.schemaUnsupportedFieldType
      .replace('{{title}}', title)
      .replace('{{type}}', type ? ` (${type})` : ''),
  }), [ch]);

  const headerEnd = useMemo(
    () => hasToken ? (
      <ChannelsPageHeaderActions
        ch={ch}
        refreshing={catalog.isValidating}
        saveOk={false}
        onRefresh={() => void catalog.mutate()}
      />
    ) : null,
    [catalog, ch, hasToken],
  );

  useLayoutEffect(() => {
    setPageHeader({
      startExtra: null,
      main: (
        <div className="min-w-0">
          <h1 className="truncate text-base font-semibold tracking-tight text-fg">{m.settingsSections.channels}</h1>
        </div>
      ),
      end: headerEnd,
    });
    return () => clearPageHeader();
  }, [clearPageHeader, headerEnd, m.settingsSections.channels, setPageHeader]);

  const openChannel = useCallback((id: string) => {
    navigate(channelDetailPath(id));
    setDraft(null);
    setError(null);
  }, [navigate]);

  const closeChannel = useCallback(() => {
    navigate(CHANNELS_HUB_PATH);
    setDraft(null);
    setError(null);
  }, [navigate]);

  const saveConfig = useCallback(async () => {
    if (!activeEntry || !draft) return false;
    const key = channelConfigKey(activeEntry);
    setSaving(true);
    setError(null);
    try {
      const res = await apiFetch(apiUrl('/api/config'), {
        method: 'PATCH',
        body: JSON.stringify({ channels: { [key]: draft } }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: { message?: string } };
        throw new Error(body.error?.message ?? res.statusText);
      }
      await mutateConfig(draft, false);
      await mutateChannelsConfig();
      await catalog.mutate();
      setDraft(null);
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return false;
    } finally {
      setSaving(false);
    }
  }, [activeEntry, catalog, draft, mutateChannelsConfig, mutateConfig]);

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
      await mutateChannelsConfig();
      if (activeEntry?.id === entry.id) {
        await mutateConfig();
        setDraft(null);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setToggleBusy(null);
    }
  }, [activeEntry?.id, catalog, draft, mutateChannelsConfig, mutateConfig, openChannel]);

  const extensionModal = activeEntry?.ui?.modal;
  const showSchemaConfig = extensionModal?.placement !== 'replace-config';

  if (!hasToken) {
    return (
      <SettingsPageFrame gap="gap-3" padding="px-3 py-8 sm:px-5 xl:px-6">
        <SettingsPageHeader title={m.settingsSections.channels} />
        <p className="text-sm text-fg-muted">{ch.tokenRequired}</p>
      </SettingsPageFrame>
    );
  }

  return (
    <SettingsPageFrame gap="gap-4">
      {catalog.isLoading ? (
        <SettingsPageSkeleton sections={2} />
      ) : catalog.error ? (
        <p className="text-sm text-red-600 dark:text-red-400">{String(catalog.error)}</p>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {entries.map((entry) => (
            <ChannelHubCard
              key={entry.id}
              entry={entry}
              config={channelsConfig[channelConfigKey(entry)]?.config}
              busy={toggleBusy === entry.id}
              ch={ch}
              onOpen={() => openChannel(entry.id)}
              onToggle={() => void toggleChannel(entry)}
            />
          ))}
        </div>
      )}

      {error ? <p className="mt-4 text-sm text-red-600 dark:text-red-400">{error}</p> : null}

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
              dirty={Boolean(draft)}
              saving={saving}
              onCancel={closeChannel}
              onDiscard={() => setDraft(null)}
              onSave={saveConfig}
            />
          ) : null
        }
      >
        {activeEntry ? (
          <div className="space-y-4">
            <div className="rounded-xl bg-surface-panel/80 px-3 py-3 shadow-surface">
              <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 items-start gap-3">
                  <ChannelIcon entry={activeEntry} />
                  <div className="min-w-0">
                    <div className="flex min-w-0 flex-wrap items-center gap-2">
                      <h2 className="truncate text-base font-semibold text-fg">{activeEntry.label}</h2>
                      <span className={cn('shrink-0 rounded-full px-2 py-0.5 text-xs font-medium', statusClass(activeEntry))}>
                        {statusLabel(activeEntry, ch)}
                      </span>
                    </div>
                    <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-sm text-fg-muted">
                      <span className="min-w-0 truncate">
                        {choosePrimaryChannelAction(activeEntry)?.[1].result === 'qr'
                          ? ch.scanLoginHint.replace('{{channel}}', activeEntry.label)
                          : activeEntry.description}
                      </span>
                      {activeEntry.docsPath ? (
                        <a
                          href={activeEntry.docsPath}
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
                  <span className="hidden text-xs text-fg-muted sm:inline">{ch.enabledLabel}</span>
                  <ChannelEnabledSwitch
                    checked={channelSetupStatus(activeEntry).enabled}
                    disabled={toggleBusy === activeEntry.id}
                    label={ch.toggleChannel.replace('{{channel}}', activeEntry.label)}
                    onToggle={() => void toggleChannel(activeEntry)}
                  />
                </div>
              </div>
            </div>

            <ChannelSetupReadinessBanner entry={activeEntry} ch={ch} />

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

            {extensionModal?.placement !== 'replace-config' ? (
              <ChannelSetupCard
                key={activeEntry.id}
                entry={activeEntry}
                locale={language}
                messages={ch}
                autoStartPrimary
                compact
                onChanged={async () => {
                  await mutateConfig();
                  await catalog.mutate();
                  await mutateChannelsConfig();
                }}
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

            {showSchemaConfig && hasSchemaFields(advancedConfigSchema) ? (
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
            ) : null}

            {error ? <p className="text-sm text-red-600 dark:text-red-400">{error}</p> : null}
          </div>
        ) : null}
      </ChannelSettingsShell>
    </SettingsPageFrame>
  );
}
