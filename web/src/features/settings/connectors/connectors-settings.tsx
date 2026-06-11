import { Cable, CheckCircle2, Loader2, PackagePlus, PlugZap, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { Button } from '@/components/ui/button';
import { SecretInput } from '@/components/ui/secret-input';
import { cn } from '@/lib/cn';
import { settingsInputFocusClass } from '@/lib/form-field-width';
import { useGatewayStore } from '@/stores/gateway-store';
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
          <h3 className="text-sm font-semibold text-fg">{instance.displayName}</h3>
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
      <div className="mt-3 grid gap-2 rounded-xl bg-surface-base p-3 text-xs text-fg-muted sm:grid-cols-3">
        <div>
          <p className="font-medium text-fg">Last health</p>
          <p className="mt-1">{instance.usage.lastHealthStatus ?? 'Never tested'}</p>
        </div>
        <div>
          <p className="font-medium text-fg">Tools</p>
          <p className="mt-1">{instance.usage.lastToolCount ?? 'Unknown'}</p>
        </div>
        <div>
          <p className="font-medium text-fg">Checked at</p>
          <p className="mt-1">{instance.usage.lastHealthCheckAt ?? '—'}</p>
        </div>
      </div>
      {instance.audit.length ? (
        <div className="mt-3 rounded-xl border border-edge bg-surface-base p-3">
          <p className="text-xs font-medium uppercase tracking-wide text-fg-subtle">Recent activity</p>
          <div className="mt-2 grid gap-1.5">
            {instance.audit.slice(-3).reverse().map((record) => (
              <div key={`${record.at}-${record.action}`} className="flex flex-wrap items-center justify-between gap-2 text-xs text-fg-muted">
                <span className="font-medium text-fg">{record.action.replace('_', ' ')}</span>
                <span>{record.status ?? (record.ok === undefined ? 'recorded' : record.ok ? 'ok' : 'failed')}</span>
                <span className="text-fg-subtle">{record.at}</span>
              </div>
            ))}
          </div>
        </div>
      ) : null}
      {health ? (
        <div className="mt-3 rounded-xl bg-surface-base p-3">
          <p className="text-sm font-medium text-fg">{health.toolCount} tools</p>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            {health.tools.slice(0, 8).map((tool) => (
              <div key={tool.name} className="rounded-lg border border-edge px-3 py-2">
                <p className="truncate text-xs font-medium text-fg">{tool.shortName ?? tool.name}</p>
                {tool.description ? <p className="mt-1 line-clamp-2 text-xs text-fg-subtle">{tool.description}</p> : null}
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function ConnectorsSettingsPanel() {
  const token = useGatewayStore((state) => state.token);
  const [tab, setTab] = useState<TabId>('discover');
  const [state, setState] = useState<LoadState>({ catalog: [], instances: [], loading: true, error: null });
  const [draft, setDraft] = useState<InstallDraft | null>(null);

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

  return (
    <div className="mx-auto flex w-full max-w-app-main flex-col gap-5 px-4 py-8">
      <div>
        <h1 className="text-xl font-semibold text-fg">Connectors</h1>
        <p className="mt-1 text-sm text-fg-muted">Install connector packages. Connectors are the only product entry point for MCP-backed tools.</p>
      </div>

      <div className="flex flex-wrap gap-2">
        {(['discover', 'installed'] as const).map((item) => (
          <Button key={item} variant={tab === item ? 'primary' : 'secondary'} onClick={() => setTab(item)}>
            {item === 'discover' ? 'Discover' : 'Installed'}
          </Button>
        ))}
      </div>

      {state.loading ? <div className="flex items-center gap-2 text-sm text-fg-muted"><Loader2 className="size-4 animate-spin" /> Loading connectors…</div> : null}
      {state.error ? <p className="rounded-xl bg-red-500/10 px-3 py-2 text-sm text-red-600">{state.error}</p> : null}

      {tab === 'discover' ? (
        <div className="grid gap-3">
          {state.catalog.map((connector) => (
            <ConnectorCard
              key={connector.id}
              connector={connector}
              installed={installedIds.has(connector.id) || connectorIsInstalled(connector, state.instances)}
              onInstall={(selected) => setDraft(buildInitialDraft(selected))}
            />
          ))}
        </div>
      ) : null}

      {tab === 'installed' ? (
        <div className="grid gap-3">
          {state.instances.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-edge p-8 text-center text-sm text-fg-muted">
              No connectors installed yet.
            </div>
          ) : (
            state.instances.map((instance) => (
              <InstalledConnectorRow key={instance.instanceId} instance={instance} onChanged={load} />
            ))
          )}
        </div>
      ) : null}
      {draft ? <InstallDialog draft={draft} onChange={setDraft} onClose={() => setDraft(null)} onInstalled={load} /> : null}
    </div>
  );
}
