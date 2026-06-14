import { Cable, CheckCircle2, Loader2, PackagePlus, Pencil, Plug, PlugZap, Plus, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { Button } from '@/components/ui/button';
import { SecretInput } from '@/components/ui/secret-input';
import { useGatewayConfigSwr } from '@/features/gateway/gateway-config-swr';
import { SettingsFormSection, SettingsFormSectionHeader } from '@/features/settings/settings-form-section';
import { cn } from '@/lib/cn';
import { settingsInputFocusClass } from '@/lib/form-field-width';
import { messages } from '@/i18n/messages';
import { useGatewayStore } from '@/stores/gateway-store';
import { useLocaleStore } from '@/stores/locale-store';
import { buildNewCustomServerRow } from './build-new-custom-server-row';
import {
  CustomMcpServerDialog,
} from './custom-mcp-server-dialog';
import {
  extractManagedMcpServers,
  normalizeMcpSettingsFromConfig,
  patchMcpSettings,
  testMcpServer,
  type McpServerRow,
} from './mcp/mcp-config-api';
import { mcpServerEndpointSummary } from './mcp/mcp-server-endpoint-summary';
import {
  completeConnectorOAuth,
  fetchConnectorCatalog,
  fetchConnectorInstances,
  installConnector,
  removeConnector,
  startConnectorOAuth,
  testConnector,
  type ConnectorDefinition,
  type ConnectorHealthResult,
  type ConnectorInstance,
  type ConnectorOAuthStartResult,
} from './connectors-api';

type TabId = 'discover' | 'installed';

type LoadState = {
  catalog: ConnectorDefinition[];
  instances: ConnectorInstance[];
  loading: boolean;
  error: string | null;
};

type InstallDraft = {
  connector: ConnectorDefinition;
  secrets: Record<string, string>;
  config: Record<string, string>;
  installing: boolean;
  error: string | null;
  result: ConnectorInstance | null;
  health: ConnectorHealthResult | null;
  oauth: {
    flow: ConnectorOAuthStartResult | null;
    connected: boolean;
  };
};

type CustomDialogState =
  | { mode: 'add'; row: McpServerRow }
  | { mode: 'edit'; row: McpServerRow }
  | null;

const inputClass = cn(
  'w-full rounded-lg border border-edge bg-surface-panel px-3 py-2 text-sm text-fg',
  'placeholder:text-fg-subtle',
  settingsInputFocusClass,
);

const textareaClass = cn(inputClass, 'min-h-28 font-mono');

function parseConfigValue(type: string, raw: string): unknown {
  const trimmed = raw.trim();
  if (type === 'json') {
    return trimmed ? JSON.parse(trimmed) : undefined;
  }
  if (type === 'number') {
    return trimmed ? Number(trimmed) : undefined;
  }
  if (type === 'boolean') {
    return trimmed === 'true';
  }
  return trimmed || undefined;
}

function buildInitialDraft(connector: ConnectorDefinition): InstallDraft {
  const secrets: Record<string, string> = {};
  for (const field of connector.setup.secrets ?? []) {
    secrets[field.key] = '';
  }
  const config: Record<string, string> = {};
  for (const field of connector.setup.config ?? []) {
    config[field.key] =
      field.defaultValue === undefined
        ? ''
        : typeof field.defaultValue === 'string'
          ? field.defaultValue
          : JSON.stringify(field.defaultValue, null, 2);
  }
  return {
    connector,
    secrets,
    config,
    installing: false,
    error: null,
    result: null,
    health: null,
    oauth: { flow: null, connected: connector.auth.mode !== 'oauth' },
  };
}

function connectorIsInstalled(connector: ConnectorDefinition, instances: ConnectorInstance[]): boolean {
  return instances.some((instance) => instance.connectorId === connector.id);
}

function ConnectorCard({
  connector,
  installed,
  onInstall,
}: {
  connector: ConnectorDefinition;
  installed: boolean;
  onInstall: (connector: ConnectorDefinition) => void;
}) {
  return (
    <div className="rounded-2xl border border-edge bg-surface-panel p-4 shadow-surface">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 gap-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-2xl bg-accent-soft text-accent-fg">
            <Cable className="size-5" aria-hidden />
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-sm font-semibold text-fg">{connector.displayName}</h3>
              <span className="rounded-full bg-surface-hover px-2 py-0.5 text-[11px] font-medium text-fg-muted">
                {connector.category}
              </span>
            </div>
            <p className="mt-1 text-sm leading-6 text-fg-muted">{connector.description}</p>
          </div>
        </div>
        <Button
          variant={installed ? 'secondary' : 'primary'}
          disabled={installed}
          onClick={() => onInstall(connector)}
        >
          {installed ? <CheckCircle2 className="size-4" /> : <PackagePlus className="size-4" />}
          {installed ? 'Installed' : 'Install'}
        </Button>
      </div>
      {connector.tags?.length ? (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {connector.tags.map((tag) => (
            <span key={tag} className="rounded-full border border-edge px-2 py-0.5 text-[11px] text-fg-subtle">
              {tag}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function InstallDialog({
  draft,
  onChange,
  onClose,
  onInstalled,
}: {
  draft: InstallDraft;
  onChange: (draft: InstallDraft) => void;
  onClose: () => void;
  onInstalled: () => Promise<void>;
}) {
  const { connector } = draft;

  const startOAuthFlow = useCallback(async () => {
    onChange({ ...draft, installing: true, error: null });
    try {
      const flow = await startConnectorOAuth(connector.id);
      window.open(flow.verificationUri, '_blank', 'noopener,noreferrer');
      onChange({
        ...draft,
        installing: false,
        error: null,
        oauth: { flow, connected: false },
      });
    } catch (error) {
      onChange({
        ...draft,
        installing: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }, [connector.id, draft, onChange]);

  const completeOAuthFlow = useCallback(async () => {
    if (!draft.oauth.flow) {
      return;
    }
    onChange({ ...draft, installing: true, error: null });
    try {
      await completeConnectorOAuth(connector.id, draft.oauth.flow.deviceCode);
      onChange({
        ...draft,
        installing: false,
        error: null,
        oauth: { ...draft.oauth, connected: true },
      });
    } catch (error) {
      onChange({
        ...draft,
        installing: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }, [connector.id, draft, onChange]);

  const submit = useCallback(async () => {
    onChange({ ...draft, installing: true, error: null, result: null, health: null });
    try {
      if (connector.auth.mode === 'oauth' && !draft.oauth.connected) {
        throw new Error('Connect GitHub OAuth before installing this connector.');
      }
      const config: Record<string, unknown> = {};
      for (const field of connector.setup.config ?? []) {
        const parsed = parseConfigValue(field.type, draft.config[field.key] ?? '');
        if (parsed !== undefined) {
          config[field.key] = parsed;
        }
      }
      const instance = await installConnector(connector.id, { secrets: draft.secrets, config });
      let health: ConnectorHealthResult | null = null;
      try {
        health = await testConnector(instance.instanceId);
      } catch {
        health = null;
      }
      onChange({ ...draft, installing: false, result: instance, health });
      await onInstalled();
    } catch (error) {
      onChange({
        ...draft,
        installing: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }, [connector.auth.mode, connector.id, connector.setup.config, draft, onChange, onInstalled]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/35 px-4 py-8">
      <div className="max-h-full w-full max-w-2xl overflow-auto rounded-3xl border border-edge bg-surface-base p-5 shadow-2xl">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold text-fg">Install {connector.displayName}</h2>
            <p className="mt-1 text-sm text-fg-muted">{connector.description}</p>
          </div>
          <Button variant="ghost" onClick={onClose}>Close</Button>
        </div>

        <div className="mt-5 flex flex-col gap-4">
          {connector.auth.mode === 'oauth' ? (
            <div className="rounded-2xl border border-edge bg-surface-panel p-4">
              <p className="text-sm font-semibold text-fg">Connect with GitHub</p>
              <p className="mt-1 text-sm text-fg-muted">
                Authorize xopc in GitHub, then return here to finish the connection.
              </p>
              {draft.oauth.flow ? (
                <div className="mt-3 rounded-xl bg-surface-base p-3 text-sm text-fg-muted">
                  <p>
                    Open <span className="font-medium text-fg">{draft.oauth.flow.verificationUri}</span> and enter this code:
                  </p>
                  <p className="mt-2 font-mono text-lg font-semibold tracking-widest text-fg">
                    {draft.oauth.flow.userCode}
                  </p>
                </div>
              ) : null}
              {draft.oauth.connected ? (
                <p className="mt-3 rounded-xl bg-emerald-500/10 px-3 py-2 text-sm text-emerald-700">
                  GitHub connected. You can install this connector now.
                </p>
              ) : null}
              <div className="mt-3 flex flex-wrap gap-2">
                <Button variant="secondary" disabled={draft.installing} onClick={() => void startOAuthFlow()}>
                  {draft.installing && !draft.oauth.flow ? <Loader2 className="size-4 animate-spin" /> : <PlugZap className="size-4" />}
                  Connect GitHub
                </Button>
                <Button variant="primary" disabled={draft.installing || !draft.oauth.flow} onClick={() => void completeOAuthFlow()}>
                  {draft.installing && draft.oauth.flow ? <Loader2 className="size-4 animate-spin" /> : <CheckCircle2 className="size-4" />}
                  I authorized GitHub
                </Button>
              </div>
            </div>
          ) : null}

          {(connector.setup.secrets ?? []).map((field) => (
            <label key={field.key} className="flex flex-col gap-1.5">
              <span className="text-sm font-medium text-fg">{field.label}</span>
              {field.description ? <span className="text-xs text-fg-subtle">{field.description}</span> : null}
              <SecretInput
                value={draft.secrets[field.key] ?? ''}
                onChange={(value) =>
                  onChange({
                    ...draft,
                    secrets: { ...draft.secrets, [field.key]: value },
                    error: null,
                  })
                }
                labels={{ show: 'Show', hide: 'Hide', copy: 'Copy', copied: 'Copied' }}
                placeholder={field.required ? 'Required' : 'Optional'}
              />
            </label>
          ))}

          {(connector.setup.config ?? []).map((field) => (
            <label key={field.key} className="flex flex-col gap-1.5">
              <span className="text-sm font-medium text-fg">{field.label}</span>
              {field.type === 'json' ? (
                <textarea
                  className={textareaClass}
                  value={draft.config[field.key] ?? ''}
                  placeholder={field.placeholder}
                  onChange={(event) =>
                    onChange({
                      ...draft,
                      config: { ...draft.config, [field.key]: event.currentTarget.value },
                      error: null,
                    })
                  }
                />
              ) : (
                <input
                  className={inputClass}
                  value={draft.config[field.key] ?? ''}
                  placeholder={field.placeholder}
                  onChange={(event) =>
                    onChange({
                      ...draft,
                      config: { ...draft.config, [field.key]: event.currentTarget.value },
                      error: null,
                    })
                  }
                />
              )}
            </label>
          ))}

          {draft.error ? <p className="rounded-xl bg-red-500/10 px-3 py-2 text-sm text-red-600">{draft.error}</p> : null}
          {draft.result ? (
            <div className="rounded-2xl border border-edge bg-surface-panel p-3 text-sm text-fg-muted">
              <p className="font-medium text-fg">Installed as {draft.result.materialized.serverId}</p>
              {draft.health ? <p className="mt-1">{draft.health.toolCount} tools discovered.</p> : <p className="mt-1">Installed. Tool preview can be tested from Installed.</p>}
            </div>
          ) : null}
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>Done</Button>
          <Button variant="primary" disabled={draft.installing || (connector.auth.mode === 'oauth' && !draft.oauth.connected)} onClick={() => void submit()}>
            {draft.installing ? <Loader2 className="size-4 animate-spin" /> : <PackagePlus className="size-4" />}
            Install
          </Button>
        </div>
      </div>
    </div>
  );
}

function InstalledConnectorRow({ instance, onChanged }: { instance: ConnectorInstance; onChanged: () => Promise<void> }) {
  const [testing, setTesting] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [health, setHealth] = useState<ConnectorHealthResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const runTest = useCallback(async () => {
    setTesting(true);
    setError(null);
    try {
      setHealth(await testConnector(instance.instanceId));
      await onChanged();
    } catch (testError) {
      setError(testError instanceof Error ? testError.message : String(testError));
    } finally {
      setTesting(false);
    }
  }, [instance.instanceId, onChanged]);

  const remove = useCallback(async () => {
    setRemoving(true);
    setError(null);
    try {
      await removeConnector(instance.instanceId);
      await onChanged();
    } catch (removeError) {
      setError(removeError instanceof Error ? removeError.message : String(removeError));
      setRemoving(false);
    }
  }, [instance.instanceId, onChanged]);

  return (
    <div className="rounded-2xl border border-edge bg-surface-panel p-4 shadow-surface">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold text-fg">{instance.displayName}</h3>
            <span className="rounded-full border border-edge bg-surface-base px-2 py-0.5 text-[11px] text-fg-muted">
              catalog
            </span>
          </div>
          <p className="mt-1 text-sm text-fg-muted">MCP server: {instance.materialized.serverId}</p>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" disabled={testing} onClick={() => void runTest()}>
            {testing ? <Loader2 className="size-4 animate-spin" /> : <PlugZap className="size-4" />}
            Test
          </Button>
          <Button variant="ghost" disabled={removing} onClick={() => void remove()}>
            {removing ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
            Remove
          </Button>
        </div>
      </div>
      {error ? <p className="mt-3 rounded-xl bg-red-500/10 px-3 py-2 text-sm text-red-600">{error}</p> : null}
      {health ? (
        <p className="mt-3 text-sm text-fg-muted">{health.toolCount} tools discovered.</p>
      ) : null}
    </div>
  );
}

function CustomMcpServerRow({
  row,
  t,
  cs,
  onEdit,
  onRemove,
}: {
  row: McpServerRow;
  t: ReturnType<typeof messages>['mcpSettings'];
  cs: ReturnType<typeof messages>['connectorsSettings'];
  onEdit: () => void;
  onRemove: () => Promise<void>;
}) {
  const [testing, setTesting] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [toolCount, setToolCount] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const summary = mcpServerEndpointSummary(row);

  const runTest = useCallback(async () => {
    setTesting(true);
    setError(null);
    try {
      const result = await testMcpServer(row.id.trim());
      setToolCount(result.toolCount);
    } catch (testError) {
      setError(testError instanceof Error ? testError.message : String(testError));
    } finally {
      setTesting(false);
    }
  }, [row.id]);

  const remove = useCallback(async () => {
    setRemoving(true);
    setError(null);
    try {
      await onRemove();
    } catch (removeError) {
      setError(removeError instanceof Error ? removeError.message : String(removeError));
      setRemoving(false);
    }
  }, [onRemove]);

  return (
    <div className="rounded-2xl border border-edge bg-surface-panel p-4 shadow-surface">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold text-fg">{row.id.trim() || t.cardUntitled}</h3>
            <span className="rounded-full border border-edge bg-surface-base px-2 py-0.5 text-[11px] text-fg-muted">
              {cs.customBadge}
            </span>
            <span className="rounded-full bg-surface-hover px-2 py-0.5 text-[11px] font-medium text-fg-muted">
              {t.transportLabels[row.transport]}
            </span>
          </div>
          {summary ? (
            <p className="mt-1 truncate font-mono text-xs text-fg-subtle" title={summary}>
              {summary}
            </p>
          ) : null}
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" disabled={testing} onClick={() => void runTest()}>
            {testing ? <Loader2 className="size-4 animate-spin" /> : <PlugZap className="size-4" />}
            {t.testConnection}
          </Button>
          <Button variant="secondary" onClick={onEdit}>
            <Pencil className="size-4" />
            {cs.editCustomServer}
          </Button>
          <Button variant="ghost" disabled={removing} onClick={() => void remove()}>
            {removing ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
            {t.removeServer}
          </Button>
        </div>
      </div>
      {error ? <p className="mt-3 rounded-xl bg-red-500/10 px-3 py-2 text-sm text-red-600">{error}</p> : null}
      {toolCount != null ? <p className="mt-3 text-sm text-fg-muted">{toolCount} tools discovered.</p> : null}
    </div>
  );
}

export function ConnectorsSettingsPanel() {
  const language = useLocaleStore((state) => state.language);
  const m = messages(language);
  const cs = m.connectorsSettings;
  const mcp = m.mcpSettings;
  const token = useGatewayStore((state) => state.token);
  const hasToken = Boolean(token);
  const [tab, setTab] = useState<TabId>('installed');
  const [state, setState] = useState<LoadState>({ catalog: [], instances: [], loading: true, error: null });
  const [installDraft, setInstallDraft] = useState<InstallDraft | null>(null);
  const [customDialog, setCustomDialog] = useState<CustomDialogState>(null);
  const [sessionIdleTtlMinutes, setSessionIdleTtlMinutes] = useState<number | undefined>(undefined);
  const [ttlSaving, setTtlSaving] = useState(false);
  const [ttlSaved, setTtlSaved] = useState(false);

  const { data: configData, mutate: mutateConfig } = useGatewayConfigSwr(hasToken);
  const config = configData?.payload?.config;
  const mcpSettings = useMemo(
    () => (config !== undefined ? normalizeMcpSettingsFromConfig(config) : null),
    [config],
  );
  const customServers = mcpSettings?.servers ?? [];

  useEffect(() => {
    if (mcpSettings) {
      setSessionIdleTtlMinutes(mcpSettings.sessionIdleTtlMinutes);
    }
  }, [mcpSettings]);

  const load = useCallback(async () => {
    if (!token) {
      setState({ catalog: [], instances: [], loading: false, error: null });
      return;
    }
    setState((prev) => ({ ...prev, loading: true, error: null }));
    try {
      const [catalog, instances] = await Promise.all([fetchConnectorCatalog(), fetchConnectorInstances()]);
      setState({ catalog, instances, loading: false, error: null });
    } catch (error) {
      setState({ catalog: [], instances: [], loading: false, error: error instanceof Error ? error.message : String(error) });
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  const installedIds = useMemo(() => new Set(state.instances.map((instance) => instance.connectorId)), [state.instances]);
  const managedServerIds = useMemo(
    () => new Set(state.instances.map((instance) => instance.materialized.serverId)),
    [state.instances],
  );

  const removeCustomServer = useCallback(
    async (row: McpServerRow) => {
      if (!mcpSettings || config === undefined) return;
      const nextServers = customServers.filter((server) => server.clientKey !== row.clientKey);
      await patchMcpSettings(
        { sessionIdleTtlMinutes: mcpSettings.sessionIdleTtlMinutes, servers: nextServers },
        extractManagedMcpServers(config),
      );
      await mutateConfig();
      await load();
    },
    [config, customServers, load, mcpSettings, mutateConfig],
  );

  const saveTtl = useCallback(async () => {
    if (!mcpSettings || config === undefined || ttlSaving) return;
    setTtlSaving(true);
    setTtlSaved(false);
    try {
      await patchMcpSettings(
        { sessionIdleTtlMinutes, servers: customServers },
        extractManagedMcpServers(config),
      );
      await mutateConfig();
      setTtlSaved(true);
    } finally {
      setTtlSaving(false);
    }
  }, [config, customServers, mcpSettings, mutateConfig, sessionIdleTtlMinutes, ttlSaving]);

  const installedCount = state.instances.length + customServers.length;

  return (
    <div className="mx-auto flex w-full max-w-app-main flex-col gap-5 px-4 py-8">
      <div>
        <h1 className="text-xl font-semibold text-fg">{cs.title}</h1>
        <p className="mt-1 text-sm text-fg-muted">{cs.subtitle}</p>
      </div>

      {!hasToken ? (
        <p className="rounded-xl border border-edge bg-surface-panel px-4 py-3 text-sm text-fg-muted">
          {cs.tokenHint}
        </p>
      ) : null}

      <div className="flex flex-wrap gap-2">
        {(['installed', 'discover'] as const).map((item) => (
          <Button key={item} variant={tab === item ? 'primary' : 'secondary'} onClick={() => setTab(item)}>
            {item === 'installed' ? cs.tabInstalled : cs.tabDiscover}
          </Button>
        ))}
      </div>

      {state.loading && hasToken ? (
        <div className="flex items-center gap-2 text-sm text-fg-muted">
          <Loader2 className="size-4 animate-spin" />
          {cs.loading}
        </div>
      ) : null}
      {state.error ? <p className="rounded-xl bg-red-500/10 px-3 py-2 text-sm text-red-600">{state.error}</p> : null}

      {tab === 'installed' && hasToken ? (
        <div className="flex flex-col gap-6">
          <SettingsFormSection>
            <SettingsFormSectionHeader icon={Plug} title={mcp.globalTitle} subtitle={mcp.globalHint} />
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
              <label className="flex min-w-0 flex-1 flex-col gap-1.5">
                <span className="text-sm font-medium text-fg">{mcp.idleTtlLabel}</span>
                <input
                  type="number"
                  min={0}
                  className={inputClass}
                  value={sessionIdleTtlMinutes ?? ''}
                  placeholder={mcp.idleTtlPlaceholder}
                  onChange={(e) => {
                    const raw = e.target.value.trim();
                    setSessionIdleTtlMinutes(raw === '' ? undefined : Number.parseInt(raw, 10));
                    setTtlSaved(false);
                  }}
                />
                <span className="text-xs text-fg-subtle">{mcp.idleTtlHint}</span>
              </label>
              <Button variant="secondary" disabled={ttlSaving} onClick={() => void saveTtl()}>
                {ttlSaving ? <Loader2 className="size-4 animate-spin" /> : null}
                {mcp.save}
              </Button>
            </div>
            {ttlSaved ? <p className="text-sm text-fg-muted">{mcp.saved}</p> : null}
          </SettingsFormSection>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-fg">{cs.installedTitle}</h2>
              <p className="mt-1 text-sm text-fg-muted">{cs.installedHint}</p>
            </div>
            <Button
              variant="primary"
              onClick={() =>
                setCustomDialog({
                  mode: 'add',
                  row: buildNewCustomServerRow(customServers, managedServerIds),
                })
              }
            >
              <Plus className="size-4" />
              {cs.addCustomServer}
            </Button>
          </div>

          {installedCount === 0 ? (
            <div className="rounded-2xl border border-dashed border-edge p-8 text-center text-sm text-fg-muted">
              {cs.installedEmpty}
            </div>
          ) : (
            <div className="grid gap-3">
              {state.instances.map((instance) => (
                <InstalledConnectorRow key={instance.instanceId} instance={instance} onChanged={load} />
              ))}
              {customServers.map((row) => (
                <CustomMcpServerRow
                  key={row.clientKey}
                  row={row}
                  t={mcp}
                  cs={cs}
                  onEdit={() => setCustomDialog({ mode: 'edit', row: structuredClone(row) })}
                  onRemove={async () => removeCustomServer(row)}
                />
              ))}
            </div>
          )}

          <p className="text-xs text-fg-subtle">{mcp.disableHint}</p>
        </div>
      ) : null}

      {tab === 'discover' && hasToken ? (
        <div className="grid gap-3">
          <p className="text-sm text-fg-muted">{cs.catalogHint}</p>
          {state.catalog.map((connector) => (
            <ConnectorCard
              key={connector.id}
              connector={connector}
              installed={installedIds.has(connector.id) || connectorIsInstalled(connector, state.instances)}
              onInstall={(selected) => setInstallDraft(buildInitialDraft(selected))}
            />
          ))}
        </div>
      ) : null}

      {installDraft ? (
        <InstallDialog
          draft={installDraft}
          onChange={setInstallDraft}
          onClose={() => setInstallDraft(null)}
          onInstalled={async () => {
            await load();
            await mutateConfig();
            setInstallDraft(null);
            setTab('installed');
          }}
        />
      ) : null}

      {customDialog ? (
        <CustomMcpServerDialog
          key={`${customDialog.mode}-${customDialog.row.clientKey}`}
          open
          mode={customDialog.mode}
          initialRow={customDialog.row}
          existingCustomServers={customServers}
          sessionIdleTtlMinutes={sessionIdleTtlMinutes}
          config={config}
          managedServerIds={managedServerIds}
          t={mcp}
          cs={cs}
          onClose={() => setCustomDialog(null)}
          onSaved={async () => {
            await mutateConfig();
            await load();
            setTab('installed');
          }}
        />
      ) : null}
    </div>
  );
}
