import * as Dialog from '@radix-ui/react-dialog';
import { CheckCircle2, Loader2, PackagePlus, PlugZap, X } from 'lucide-react';
import { useCallback, useEffect, useRef } from 'react';

import { Button } from '@/components/ui/button';
import { SecretInput } from '@/components/ui/secret-input';
import type { ConnectorsSettingsMessages } from '@/i18n/messages';
import { cn } from '@/lib/cn';
import { settingsInputFocusClass } from '@/lib/form-field-width';
import { interaction } from '@/lib/interaction';

import { formatConnectorMessage } from '../utils/connector-i18n';
import {
  getConnectorAuthorizationStatus,
  installConnector,
  installStoreConnector,
  startConnectorAuthorization,
  testConnector,
  type ConnectorDefinition,
  type ConnectorHealthResult,
  type ConnectorInstance,
  type ConnectorAuthorizationStartResult,
  type ConnectorAuthorizationStatusResult,
  type StoreConnectorPermissions,
} from '../connectors-api';
import { ConnectorLogo } from './connector-logo';

const inputClass = cn(
  'w-full rounded-lg border border-edge bg-surface-panel px-3 py-2 text-sm text-fg',
  'placeholder:text-fg-subtle',
  settingsInputFocusClass,
);

const textareaClass = cn(inputClass, 'min-h-28 font-mono');

function healthStatusLabel(status: ConnectorHealthResult['status'] | undefined, t: ConnectorsSettingsMessages): string {
  if (!status) return t.healthStatusPending;
  return t.healthStatusLabels[status] ?? status;
}

export type InstallDraft = {
  connector: ConnectorDefinition;
  secrets: Record<string, string>;
  config: Record<string, string>;
  installing: boolean;
  error: string | null;
  result: ConnectorInstance | null;
  health: ConnectorHealthResult | null;
  oauth: {
    flow: DeviceAuthorizationFlow | null;
    connected: boolean;
    status: ConnectorAuthorizationStatusResult['status'] | 'idle';
  };
  store?: {
    packageName: string;
    version: string;
    permissions: StoreConnectorPermissions;
  };
};

type DeviceAuthorizationFlow = ConnectorAuthorizationStartResult & {
  flowId: string;
  userCode: string;
  verificationUri: string;
  intervalSeconds: number;
};

function requiresPreInstallAuthorization(connector: ConnectorDefinition): boolean {
  return connector.auth.mode === 'oauth' && connector.auth.installPhase === 'before_install';
}

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

export function buildInitialDraft(
  connector: ConnectorDefinition,
  store?: InstallDraft['store'],
): InstallDraft {
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
    oauth: {
      flow: null,
      connected: !requiresPreInstallAuthorization(connector),
      status: requiresPreInstallAuthorization(connector) ? 'idle' : 'connected',
    },
    ...(store ? { store } : {}),
  };
}

function CapabilityResultList({
  title,
  items,
}: {
  title: string;
  items: Array<{ id: string; title: string; description?: string }>;
}) {
  if (items.length === 0) return null;
  return (
    <div className="rounded-lg border border-edge bg-surface-panel">
      <div className="border-b border-edge px-3 py-2 text-xs font-semibold text-fg">{title}</div>
      <div className="max-h-40 overflow-y-auto">
        {items.slice(0, 12).map((item) => (
          <div key={item.id} className="border-b border-edge-subtle px-3 py-2 last:border-b-0">
            <div className="break-words font-mono text-xs font-medium text-fg">{item.title}</div>
            {item.description ? <div className="mt-1 line-clamp-2 text-xs leading-5 text-fg-muted">{item.description}</div> : null}
          </div>
        ))}
        {items.length > 12 ? (
          <div className="px-3 py-2 text-xs text-fg-subtle">+{items.length - 12}</div>
        ) : null}
      </div>
    </div>
  );
}

export function InstallConnectorDialog({
  draft,
  onChange,
  onClose,
  onInstalled,
  t,
}: {
  draft: InstallDraft;
  onChange: (draft: InstallDraft) => void;
  onClose: () => void;
  onInstalled: (instance: ConnectorInstance) => Promise<void>;
  t: ConnectorsSettingsMessages;
}) {
  const { connector } = draft;
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const wizardStep = draft.result ? 'complete' : draft.installing ? 'health' : 'configure';
  const stepItems = [
    { id: 'configure', label: t.connectStepConfigure },
    { id: 'health', label: t.connectStepVerify },
    { id: 'complete', label: t.connectStepReady },
  ] as const;

  const startOAuthFlow = useCallback(async () => {
    onChange({ ...draft, installing: true, error: null });
    try {
      const authorization = await startConnectorAuthorization(connector.id);
      if (
        !authorization.flowId ||
        !authorization.userCode ||
        !authorization.verificationUri ||
        !authorization.intervalSeconds
      ) throw new Error('This connector authorization provider does not support a device flow.');
      const flow: DeviceAuthorizationFlow = {
        ...authorization,
        flowId: authorization.flowId,
        userCode: authorization.userCode,
        verificationUri: authorization.verificationUri,
        intervalSeconds: authorization.intervalSeconds,
      };
      window.open(flow.verificationUri, '_blank', 'noopener,noreferrer');
      onChange({
        ...draft,
        installing: false,
        error: null,
        oauth: { flow, connected: false, status: 'pending' },
      });
    } catch (error) {
      onChange({
        ...draft,
        installing: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }, [connector.id, draft, onChange]);

  useEffect(() => {
    const flow = draft.oauth.flow;
    if (!flow || draft.oauth.connected || draft.oauth.status === 'error' || draft.oauth.status === 'expired') {
      return undefined;
    }
    let cancelled = false;
    const poll = async () => {
      try {
        const result = await getConnectorAuthorizationStatus(connector.id, flow.flowId);
        if (cancelled) return;
        onChange({
          ...draftRef.current,
          error: result.error ?? null,
          oauth: {
            flow,
            connected: result.status === 'connected',
            status: result.status,
          },
        });
      } catch (error) {
        if (!cancelled) {
          onChange({
            ...draftRef.current,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    };
    void poll();
    const timer = window.setInterval(() => void poll(), Math.max(1, flow.intervalSeconds) * 1000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [connector.id, draft.oauth.connected, draft.oauth.flow, draft.oauth.status, onChange]);

  const submit = useCallback(async () => {
    onChange({ ...draft, installing: true, error: null, result: null, health: null });
    try {
      if (requiresPreInstallAuthorization(connector) && !draft.oauth.connected) {
        throw new Error(t.oauthRequiredBeforeConnect);
      }
      const config: Record<string, unknown> = {};
      for (const field of connector.setup.config ?? []) {
        const parsed = parseConfigValue(field.type, draft.config[field.key] ?? '');
        if (parsed !== undefined) {
          config[field.key] = parsed;
        }
      }
      const instance = draft.store
        ? await installStoreConnector(draft.store.packageName, { secrets: draft.secrets, config }, draft.store.version)
        : await installConnector(connector.id, { secrets: draft.secrets, config, definition: connector.source === 'registry' ? connector : undefined });
      let health: ConnectorHealthResult | null = null;
      try {
        health = await testConnector(instance.instanceId);
      } catch {
        health = null;
      }
      onChange({ ...draft, installing: false, result: instance, health });
      await onInstalled(instance);
    } catch (error) {
      onChange({
        ...draft,
        installing: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }, [connector, draft, onChange, onInstalled, t.oauthRequiredBeforeConnect]);

  return (
    <Dialog.Root open onOpenChange={(open) => { if (!open) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="xopc-dialog-overlay fixed inset-0 z-[60] bg-scrim" />
        <Dialog.Content
          className={cn(
            'xopc-dialog-content fixed left-1/2 top-1/2 z-[60] flex max-h-[min(100vh-2rem,44rem)] w-[min(100%-2rem,min(92vw,48rem))] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden',
            'rounded-2xl border border-edge bg-surface-panel shadow-float dark:border-edge',
          )}
        >
          <div className="flex shrink-0 items-start justify-between gap-3 border-b border-edge-subtle px-6 py-5">
            <div className="flex min-w-0 items-start gap-3">
              <ConnectorLogo connector={connector} size="lg" />
              <div className="min-w-0">
                <Dialog.Title className="text-base font-semibold text-fg">
                  {formatConnectorMessage(t.connectDialogTitle, { name: connector.displayName })}
                </Dialog.Title>
                <Dialog.Description className="mt-1 line-clamp-3 text-sm text-fg-muted">
                  {connector.description}
                </Dialog.Description>
              </div>
            </div>
            <Dialog.Close asChild>
              <button
                type="button"
                className={cn(
                  'rounded-lg p-1.5 text-fg-muted hover:bg-surface-hover hover:text-fg',
                  interaction.focusRingPanel,
                )}
                aria-label={t.modalClose}
              >
                <X className="size-5" strokeWidth={1.75} aria-hidden />
                <span className="sr-only">{t.modalClose}</span>
              </button>
            </Dialog.Close>
          </div>

          <div className="min-h-0 overflow-y-auto px-6 py-5">
            <div className="mb-5 grid grid-cols-3 gap-2" aria-label={t.connectProgressAria}>
              {stepItems.map((step, index) => {
                const activeIndex = stepItems.findIndex((item) => item.id === wizardStep);
                const active = index === activeIndex;
                const complete = index < activeIndex;
                return (
                  <div
                    key={step.id}
                    className={cn(
                      'rounded-xl border px-3 py-2 text-xs font-medium',
                      active
                        ? 'border-accent bg-accent-soft text-accent-fg'
                        : complete
                          ? 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900/40 dark:bg-emerald-950/40 dark:text-emerald-200'
                          : 'border-edge bg-surface-base text-fg-muted',
                    )}
                  >
                    <span className="mr-1 tabular-nums">{index + 1}.</span>
                    {step.label}
                  </div>
                );
              })}
            </div>
            <div className="flex flex-col gap-4">
          {connector.integrationStrategy ? (
            <div className="rounded-xl border border-accent/20 bg-accent-soft/60 px-4 py-3 text-sm text-accent-fg">
              {connector.integrationStrategy.lane === 'mcp'
                ? t.integrationStrategyMcpHint
                : connector.integrationStrategy.lane === 'native'
                  ? t.integrationStrategyNativeHint
                  : t.integrationStrategyComposioHint}
            </div>
          ) : null}
          {requiresPreInstallAuthorization(connector) ? (
            <div className="rounded-2xl border border-edge bg-surface-panel p-4">
              <p className="text-sm font-semibold text-fg">{t.oauthTitle}</p>
              <p className="mt-1 text-sm text-fg-muted">
                {t.oauthHint}
              </p>
              {draft.oauth.flow ? (
                <div className="mt-3 rounded-xl bg-surface-base p-3 text-sm text-fg-muted">
                  <p>
                    {formatConnectorMessage(t.oauthOpenCodePrefix, { url: draft.oauth.flow.verificationUri })}
                  </p>
                  <p className="mt-2 font-mono text-lg font-semibold tracking-widest text-fg">
                    {draft.oauth.flow.userCode}
                  </p>
                </div>
              ) : null}
              {draft.oauth.connected ? (
                <p className="mt-3 rounded-xl bg-emerald-500/10 px-3 py-2 text-sm text-emerald-700">
                  {t.oauthConnected}
                </p>
              ) : null}
              {draft.oauth.status === 'pending' ? (
                <p className="mt-3 text-sm text-fg-muted">{t.oauthWaiting}</p>
              ) : null}
              {draft.oauth.status === 'installation_required' ? (
                <p className="mt-3 rounded-xl bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-300">
                  {t.oauthInstallRequired}
                </p>
              ) : null}
              {draft.oauth.status === 'expired' ? (
                <p className="mt-3 rounded-xl bg-red-500/10 px-3 py-2 text-sm text-red-600">{t.oauthExpired}</p>
              ) : null}
              <div className="mt-3 flex flex-wrap gap-2">
                <Button variant="secondary" disabled={draft.installing} onClick={() => void startOAuthFlow()}>
                  {draft.installing && !draft.oauth.flow ? <Loader2 className="size-4 animate-spin" /> : <PlugZap className="size-4" />}
                  {t.oauthConnectButton}
                </Button>
                {draft.oauth.status === 'installation_required' && draft.oauth.flow?.installUrl ? (
                  <Button
                    variant="primary"
                    onClick={() => window.open(draft.oauth.flow!.installUrl, '_blank', 'noopener,noreferrer')}
                  >
                    <PlugZap className="size-4" />
                    {t.oauthInstallButton}
                  </Button>
                ) : null}
              </div>
            </div>
          ) : null}

          {draft.store ? (
            <section className="rounded-2xl border border-edge bg-surface-base p-4">
              <h3 className="text-sm font-semibold text-fg">{t.detailPermissions}</h3>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {(draft.store.permissions.data ?? []).map((permission) => (
                  <span key={permission} className="rounded-md border border-edge bg-surface-panel px-2 py-1 text-xs text-fg-muted">
                    {permission}
                  </span>
                ))}
                {(draft.store.permissions.networkDomains ?? []).map((domain) => (
                  <span key={domain} className="rounded-md border border-edge bg-surface-panel px-2 py-1 text-xs text-fg-muted">
                    {domain}
                  </span>
                ))}
                <span className="rounded-md border border-emerald-500/30 bg-emerald-500/10 px-2 py-1 text-xs text-emerald-700 dark:text-emerald-300">
                  {t.storeLocalExecDenied}
                </span>
              </div>
            </section>
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
                labels={t.secretInputLabels}
                placeholder={field.required ? t.requiredPlaceholder : t.optionalPlaceholder}
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

          {draft.installing ? (
            <div className="rounded-2xl border border-edge bg-surface-base p-4 text-sm text-fg-muted">
              <div className="flex items-center gap-2 font-medium text-fg">
                <Loader2 className="size-4 animate-spin text-accent" aria-hidden />
                {t.connectingTitle}
              </div>
              <p className="mt-1 text-xs text-fg-subtle">
                {t.connectingHint}
              </p>
            </div>
          ) : null}

          {draft.error ? <p className="rounded-xl bg-red-500/10 px-3 py-2 text-sm text-red-600">{draft.error}</p> : null}
          {draft.result ? (
            <div className="rounded-2xl border border-edge bg-surface-base p-4 text-sm text-fg-muted">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="font-medium text-fg">
                    {formatConnectorMessage(t.connectedAs, {
                      target: draft.result.materialized.type === 'mcp' ? draft.result.materialized.serverId : draft.result.instanceId,
                    })}
                  </p>
                  <p className="mt-1 text-xs text-fg-subtle">
                    {formatConnectorMessage(t.runtimeLabel, { runtime: draft.result.materialized.type.toUpperCase() })}
                  </p>
                </div>
                <span
                  className={cn(
                    'rounded-full px-2 py-0.5 text-xs font-medium',
                    draft.health?.ok
                      ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                      : draft.health
                        ? 'bg-amber-500/10 text-amber-700 dark:text-amber-300'
                        : 'bg-surface-hover text-fg-muted',
                  )}
                >
                  {draft.health?.ok ? t.healthStatusHealthy : healthStatusLabel(draft.health?.status, t)}
                </span>
              </div>
              {draft.health ? (
                <>
                  <div className="mt-3 grid gap-2 text-xs sm:grid-cols-3">
                    <div className="rounded-lg border border-edge bg-surface-panel px-3 py-2">
                      <div className="font-semibold text-fg">{draft.health.toolCount}</div>
                      <div>{t.toolsMetric}</div>
                    </div>
                    <div className="rounded-lg border border-edge bg-surface-panel px-3 py-2">
                      <div className="font-semibold text-fg">{draft.health.resourceCount}</div>
                      <div>{t.resourcesMetric}</div>
                    </div>
                    <div className="rounded-lg border border-edge bg-surface-panel px-3 py-2">
                      <div className="font-semibold text-fg">{draft.health.promptCount}</div>
                      <div>{t.promptsMetric}</div>
                    </div>
                  </div>
                  <div className="mt-3 grid gap-2">
                    <CapabilityResultList
                      title={t.detailTools}
                      items={draft.health.tools.map((tool) => ({
                        id: tool.name,
                        title: tool.shortName ?? tool.name,
                        description: tool.description,
                      }))}
                    />
                    <CapabilityResultList
                      title={t.detailResources}
                      items={draft.health.resources.map((resource) => ({
                        id: resource.uri,
                        title: resource.title ?? resource.name ?? resource.uri,
                        description: resource.description ?? resource.uri,
                      }))}
                    />
                    <CapabilityResultList
                      title={t.detailPrompts}
                      items={draft.health.prompts.map((prompt) => ({
                        id: prompt.name,
                        title: prompt.title ?? prompt.name,
                        description: prompt.description ?? formatConnectorMessage(t.promptArgumentCount, { count: String(prompt.argumentCount) }),
                      }))}
                    />
                  </div>
                </>
              ) : (
                <p className="mt-3">{t.installedWithoutHealth}</p>
              )}
              {draft.health?.action ? <p className="mt-3 text-xs text-fg-subtle">{draft.health.action}</p> : null}
            </div>
          ) : null}
            </div>
          </div>

          <div className="flex shrink-0 justify-end gap-2 border-t border-edge-subtle px-6 py-4">
            <Button variant="primary" disabled={Boolean(draft.result) || draft.installing || (requiresPreInstallAuthorization(connector) && !draft.oauth.connected)} onClick={() => void submit()}>
              {draft.installing ? <Loader2 className="size-4 animate-spin" /> : draft.result ? <CheckCircle2 className="size-4" /> : <PackagePlus className="size-4" />}
              {draft.result ? t.connectedBadge : t.connect}
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
