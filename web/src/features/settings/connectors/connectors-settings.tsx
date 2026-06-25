import { Cable, CheckCircle2, Database, FileText, KeyRound, Loader2, PackagePlus, Pencil, Plug, PlugZap, Plus, ShieldCheck, Trash2, Wrench } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { Button } from '@/components/ui/button';
import { SecretInput } from '@/components/ui/secret-input';
import { useGatewayConfigSwr } from '@/features/gateway/gateway-config-swr';
import { SettingsFormSection, SettingsFormSectionHeader } from '@/features/settings/settings-form-section';
import { cn } from '@/lib/cn';
import { settingsInputFocusClass } from '@/lib/form-field-width';
import { showToast } from '@/lib/toast';
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
import { McpToolsListDialog } from './mcp/mcp-tools-list-dialog';
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
type ConnectorDetailTab = 'health' | 'tools' | 'resources' | 'prompts' | 'permissions';

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
  const visibleCapabilities = connector.capabilities.slice(0, 4);
  const hiddenCapabilityCount = Math.max(0, connector.capabilities.length - visibleCapabilities.length);

  return (
    <div className="flex min-h-60 flex-col rounded-lg border border-edge bg-surface-panel p-4 shadow-surface transition-colors hover:border-accent/50">
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-3">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent-fg">
              <Cable className="size-5" aria-hidden />
            </div>
            <div className="min-w-0">
              <h3 className="truncate text-sm font-semibold text-fg">{connector.displayName}</h3>
              <p className="mt-1 text-xs uppercase tracking-wide text-fg-subtle">{connector.category}</p>
            </div>
          </div>
          {installed ? (
            <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[11px] font-medium text-emerald-700 dark:text-emerald-300">
              <CheckCircle2 className="size-3" aria-hidden />
              Installed
            </span>
          ) : null}
        </div>

        <p className="mt-4 line-clamp-3 text-sm leading-6 text-fg-muted">{connector.description}</p>

        <div className="mt-4 flex flex-wrap gap-1.5">
          {visibleCapabilities.map((capability) => (
            <span key={capability} className="rounded-md border border-edge bg-surface-base px-2 py-0.5 text-[11px] text-fg-muted">
              {capability}
            </span>
          ))}
          {hiddenCapabilityCount > 0 ? (
            <span className="rounded-md border border-edge bg-surface-base px-2 py-0.5 text-[11px] text-fg-subtle">
              +{hiddenCapabilityCount}
            </span>
          ) : null}
        </div>
      </div>

      {connector.tags?.length ? (
        <div className="mt-4 flex flex-wrap gap-1.5 border-t border-edge pt-3">
          {connector.tags.slice(0, 4).map((tag) => (
            <span key={tag} className="rounded-full border border-edge px-2 py-0.5 text-[11px] text-fg-subtle">
              {tag}
            </span>
          ))}
        </div>
      ) : null}

      <div className="mt-4 flex items-center justify-end">
        <Button
          variant="secondary"
          disabled={installed}
          className="w-full justify-center"
          onClick={() => onInstall(connector)}
        >
          {installed ? <CheckCircle2 className="size-4" /> : <PackagePlus className="size-4" />}
          {installed ? 'Installed' : 'Install'}
        </Button>
      </div>
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
              {draft.health ? (
                <p className="mt-1">
                  {draft.health.toolCount} tools, {draft.health.resourceCount} resources,{' '}
                  {draft.health.promptCount} prompts discovered.
                </p>
              ) : (
                <p className="mt-1">Installed. Capabilities can be tested from Installed.</p>
              )}
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
  const [detailTab, setDetailTab] = useState<ConnectorDetailTab>('health');
  const [toolsDialogOpen, setToolsDialogOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const runTest = useCallback(async () => {
    setTesting(true);
    setError(null);
    try {
      const result = await testConnector(instance.instanceId);
      setHealth(result);
      if (result.toolCount > 0) {
        setDetailTab('tools');
      }
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

  const lastToolCount = health ? health.toolCount : instance.usage.lastToolCount;

  return (
    <>
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
      <div className="mt-4 flex flex-wrap gap-2">
        {([
          ['health', ShieldCheck, 'Health'],
          ['tools', Wrench, `Tools ${health ? health.toolCount : instance.usage.lastToolCount ?? ''}`],
          ['resources', Database, `Resources ${health ? health.resourceCount : instance.usage.lastResourceCount ?? ''}`],
          ['prompts', FileText, `Prompts ${health ? health.promptCount : instance.usage.lastPromptCount ?? ''}`],
          ['permissions', KeyRound, 'Permissions'],
        ] as const).map(([id, Icon, label]) => (
          <button
            key={id}
            type="button"
            className={cn(
              'inline-flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-xs',
              detailTab === id
                ? 'border-accent bg-accent-soft text-accent-fg'
                : 'border-edge bg-surface-base text-fg-muted hover:text-fg',
            )}
            onClick={() => setDetailTab(id)}
          >
            <Icon className="size-3.5" aria-hidden />
            {label}
          </button>
        ))}
      </div>
      <div className="mt-3 rounded-xl border border-edge bg-surface-base p-3 text-sm">
        {detailTab === 'health' ? (
          <div className="space-y-1 text-fg-muted">
            <p>
              Status:{' '}
              <span className={health?.ok ? 'font-medium text-emerald-700 dark:text-emerald-300' : 'font-medium text-fg'}>
                {health?.status ?? instance.usage.lastHealthStatus ?? 'not tested'}
              </span>
            </p>
            <p>
              Last check:{' '}
              {instance.usage.lastHealthCheckAt ? new Date(instance.usage.lastHealthCheckAt).toLocaleString() : 'never'}
            </p>
            {health?.action ? <p>{health.action}</p> : null}
          </div>
        ) : null}
        {detailTab === 'tools' ? (
          health?.tools.length ? (
            <div className="grid gap-2">
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs text-fg-muted">
                  {health.tools.length} tools available for this connector.
                </p>
                <Button
                  type="button"
                  variant="ghost"
                  className="h-7 text-xs"
                  onClick={() => setToolsDialogOpen(true)}
                >
                  View all
                </Button>
              </div>
              {health.tools.slice(0, 8).map((tool) => (
                <div key={tool.name} className="min-w-0">
                  <p className="truncate font-mono text-xs text-fg">{tool.shortName ?? tool.name}</p>
                  {tool.description ? <p className="truncate text-xs text-fg-subtle">{tool.description}</p> : null}
                </div>
              ))}
            </div>
          ) : (
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-fg-muted">
                {lastToolCount
                  ? `${lastToolCount} tools were found in the last health check. Run Test again to load tool details.`
                  : 'Run Test to list tools.'}
              </p>
              <Button type="button" variant="secondary" disabled={testing} onClick={() => void runTest()}>
                {testing ? <Loader2 className="size-4 animate-spin" /> : <PlugZap className="size-4" />}
                Test
              </Button>
            </div>
          )
        ) : null}
        {detailTab === 'resources' ? (
          health?.resources.length ? (
            <div className="grid gap-2">
              {health.resources.slice(0, 8).map((resource) => (
                <div key={resource.uri} className="min-w-0">
                  <p className="truncate font-mono text-xs text-fg">{resource.title ?? resource.name}</p>
                  <p className="truncate text-xs text-fg-subtle">{resource.uri}</p>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-fg-muted">Run Test to list resources exposed by this MCP server.</p>
          )
        ) : null}
        {detailTab === 'prompts' ? (
          health?.prompts.length ? (
            <div className="grid gap-2">
              {health.prompts.slice(0, 8).map((prompt) => (
                <div key={prompt.name} className="min-w-0">
                  <p className="truncate font-mono text-xs text-fg">{prompt.title ?? prompt.name}</p>
                  {prompt.description ? <p className="truncate text-xs text-fg-subtle">{prompt.description}</p> : null}
                </div>
              ))}
            </div>
          ) : (
            <p className="text-fg-muted">Run Test to list prompts exposed by this MCP server.</p>
          )
        ) : null}
        {detailTab === 'permissions' ? (
          <div className="space-y-1 text-fg-muted">
            <p>Secrets configured: {Object.values(instance.secretStatus).filter(Boolean).length}</p>
            <p>Runtime: {instance.materialized.type.toUpperCase()} server `{instance.materialized.serverId}`</p>
            <p>Tool calls run through MCP and follow the agent tool policy/approval gates.</p>
          </div>
        ) : null}
      </div>
    </div>
    <McpToolsListDialog
      open={toolsDialogOpen}
      onOpenChange={setToolsDialogOpen}
      serverId={instance.materialized.serverId}
      title={`${instance.displayName} tools`}
      subtitle="{{serverId}} exposes {{count}} MCP tools."
      searchPlaceholder="Search tools"
      searchEmptyLabel="No tools match your search."
      emptyLabel="Run Test to list tools."
      closeLabel="Close"
      tools={health?.tools ?? []}
      stripPrefix={`${instance.materialized.serverId}__`}
    />
    </>
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
  const [capabilityCounts, setCapabilityCounts] = useState<{
    toolCount: number;
    resourceCount: number;
    promptCount: number;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const summary = mcpServerEndpointSummary(row);

  const runTest = useCallback(async () => {
    setTesting(true);
    setError(null);
    try {
      const result = await testMcpServer(row.id.trim());
      setCapabilityCounts({
        toolCount: result.toolCount,
        resourceCount: result.resourceCount,
        promptCount: result.promptCount,
      });
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
      {capabilityCounts ? (
        <p className="mt-3 text-sm text-fg-muted">
          {capabilityCounts.toolCount} tools, {capabilityCounts.resourceCount} resources,{' '}
          {capabilityCounts.promptCount} prompts discovered.
        </p>
      ) : null}
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
  const [_ttlSaved, setTtlSaved] = useState(false);

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
      showToast({ type: 'success', title: mcp.saved });
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

      <div className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1">
        {(['installed', 'discover'] as const).map((item) => (
          <button
            key={item}
            type="button"
            role="tab"
            aria-selected={tab === item}
            className={cn(
              'shrink-0 rounded-lg px-3 py-2 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
              'transition-transform duration-150 ease-out active:scale-95 motion-reduce:transition-none motion-reduce:active:scale-100',
              tab === item
                ? 'bg-accent-soft text-accent-fg'
                : 'text-fg-muted hover:bg-surface-hover hover:text-fg',
            )}
            onClick={() => setTab(item)}
          >
            {item === 'installed' ? cs.tabInstalled : cs.tabDiscover}
          </button>
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
            <div className="max-w-xl">
              <label className="flex flex-col gap-1.5">
                <span className="text-sm font-medium text-fg">{mcp.idleTtlLabel}</span>
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    type="number"
                    min={0}
                    className={cn(inputClass, 'w-40 flex-none')}
                    value={sessionIdleTtlMinutes ?? ''}
                    placeholder={mcp.idleTtlPlaceholder}
                    onChange={(e) => {
                      const raw = e.target.value.trim();
                      setSessionIdleTtlMinutes(raw === '' ? undefined : Number.parseInt(raw, 10));
                      setTtlSaved(false);
                    }}
                  />
                  <Button variant="secondary" disabled={ttlSaving} onClick={() => void saveTtl()}>
                    {ttlSaving ? <Loader2 className="size-4 animate-spin" /> : null}
                    {mcp.save}
                  </Button>
                </div>
                <span className="text-xs text-fg-subtle">{mcp.idleTtlHint}</span>
              </label>
            </div>
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
        <div className="flex flex-col gap-4">
          <p className="text-sm text-fg-muted">{cs.catalogHint}</p>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {state.catalog.map((connector) => (
              <ConnectorCard
                key={connector.id}
                connector={connector}
                installed={installedIds.has(connector.id) || connectorIsInstalled(connector, state.instances)}
                onInstall={(selected) => setInstallDraft(buildInitialDraft(selected))}
              />
            ))}
          </div>
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
