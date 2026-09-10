import * as Dialog from '@radix-ui/react-dialog';
import { CheckCircle2, ExternalLink, Loader2, PackagePlus, X } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Select, SelectOption } from '@/components/ui/popover-select';
import { SecretInput } from '@/components/ui/secret-input';
import { Skeleton } from '@/components/ui/skeleton';
import type { ConnectorsSettingsMessages } from '@/i18n/messages';
import { cn } from '@/lib/cn';
import { isElectron } from '@/lib/electron-env';
import { settingsInputFocusClass } from '@/lib/form-field-width';
import { interaction } from '@/lib/interaction';
import { OAuthProviderConnect } from '@/features/settings/models-hub/oauth-provider-connect';

import { formatConnectorMessage } from '../utils/connector-i18n';
import { connectorDescription } from '../utils/connector-copy';
import {
  configureComposio,
  getComposioHealth,
  getComposioSetupStatus,
  getComposioToolkitAuthState,
  installConnector,
  installStoreConnector,
  startAccountLearning,
  startConnectorAuthorization,
  testConnector,
  type ConnectorHealthResult,
  type ConnectorInstance,
  type ComposioToolkitAuthState,
  type ComposioSetupStatus,
  waitForActiveComposioConnection,
  waitForConnectorAuthorization,
} from '../connectors-api';
import { ConnectorLogo } from './connector-logo';
import type { InstallDraft } from './install-connector-draft';

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
  const description = connectorDescription(connector, t);
  const isComposioToolkit = connector.runtime.type === 'composio' && connector.runtime.role === 'toolkit';
  const composioToolkit = connector.runtime.type === 'composio' && connector.runtime.role === 'toolkit'
    ? connector.runtime.toolkit
    : null;
  const canLearnFromConnection = connector.understanding != null;
  const [composioConfigured, setComposioConfigured] = useState(!isComposioToolkit);
  const [composioSetupStatus, setComposioSetupStatus] = useState<ComposioSetupStatus | null>(null);
  const [composioSetupLoading, setComposioSetupLoading] = useState(isComposioToolkit);
  const [composioApiKey, setComposioApiKey] = useState('');
  const [composioSetupError, setComposioSetupError] = useState<string | null>(null);
  const [composioAuth, setComposioAuth] = useState<ComposioToolkitAuthState | null>(null);
  const [composioAuthLoading, setComposioAuthLoading] = useState(false);
  const [learnAfterConnect, setLearnAfterConnect] = useState(false);

  useEffect(() => {
    if (!isComposioToolkit) return;
    let cancelled = false;
    void getComposioSetupStatus()
      .then((status) => {
        if (!cancelled) {
          setComposioSetupStatus(status);
          setComposioConfigured(status.configured);
        }
      })
      .catch((error) => {
        if (!cancelled) setComposioSetupError(error instanceof Error ? error.message : String(error));
      })
      .finally(() => { if (!cancelled) setComposioSetupLoading(false); });
    return () => { cancelled = true; };
  }, [connector.id, isComposioToolkit]);
  useEffect(() => {
    if (!composioToolkit || !composioConfigured) return;
    let cancelled = false;
    setComposioAuthLoading(true);
    void getComposioToolkitAuthState(composioToolkit)
      .then((auth) => { if (!cancelled) setComposioAuth(auth); })
      .catch((error) => {
        if (!cancelled) setComposioSetupError(error instanceof Error ? error.message : String(error));
      })
      .finally(() => { if (!cancelled) setComposioAuthLoading(false); });
    return () => { cancelled = true; };
  }, [composioConfigured, composioToolkit]);
  const submit = useCallback(async () => {
    const electron = isElectron();
    const usesMcpOAuth = connector.runtime.type === 'mcp' && connector.auth.mode === 'oauth';
    const authWindow = (isComposioToolkit || usesMcpOAuth) && !electron ? window.open('', '_blank') : null;
    if (authWindow) authWindow.opener = null;
    setComposioSetupError(null);
    onChange({ ...draft, installing: true, error: null, result: null, health: null });
    try {
      if (isComposioToolkit && !composioConfigured) {
        if (!composioApiKey.trim()) throw new Error(t.composioSetupSignInRequired);
        await configureComposio(composioApiKey);
        setComposioSetupStatus({ configured: true, mode: 'byok' });
        setComposioConfigured(true);
      }
      const currentComposioAuth = isComposioToolkit && composioToolkit
        ? composioAuth ?? await getComposioToolkitAuthState(composioToolkit)
        : null;
      const selectedAuthConfigId = draft.config.authConfigId?.trim();
      if (currentComposioAuth?.requiresCustomAuthConfig && !selectedAuthConfigId) {
        throw new Error(t.composioAuthConfigRequired);
      }
      if (selectedAuthConfigId) {
        const selected = currentComposioAuth?.authConfigs.find((item) => item.id === selectedAuthConfigId);
        if (!selected || selected.status !== 'ENABLED' || !selected.isEnabledForToolRouter) {
          throw new Error(t.composioAuthConfigUnavailable);
        }
      }
      const config: Record<string, unknown> = {};
      for (const field of connector.setup.config ?? []) {
        const parsed = parseConfigValue(field.type, draft.config[field.key] ?? '');
        if (parsed !== undefined) {
          config[field.key] = parsed;
        }
      }
      if (selectedAuthConfigId) config.authConfigId = selectedAuthConfigId;
      const instance = draft.store
        ? await installStoreConnector(draft.store.packageName, { secrets: draft.secrets, config }, draft.store.version)
        : await installConnector(connector.id, { secrets: draft.secrets, config, definition: connector.source === 'registry' ? connector : undefined });
      let health: ConnectorHealthResult | null = null;
      try {
        if (isComposioToolkit) {
          const existingHealth = composioToolkit
            ? await getComposioHealth(composioToolkit).catch(() => null)
            : null;
          if (existingHealth?.status === 'connected') {
            authWindow?.close();
            const connection = await waitForActiveComposioConnection(composioToolkit!);
            if (canLearnFromConnection && learnAfterConnect) {
              if (!connection.accountId) throw new Error('Connector account is unavailable.');
              await startAccountLearning(connection.accountId);
            }
          } else {
            const authorization = await startConnectorAuthorization(connector.id);
            if (!authorization.authorizationUrl) throw new Error('The connection service did not return an authorization URL.');
            if (electron) {
              const openResult = await window.electronAPI?.shell?.openExternalUrl(authorization.authorizationUrl);
              if (!openResult?.ok) throw new Error(openResult?.error ?? 'Could not open the system browser.');
            } else if (authWindow) {
              authWindow.location.href = authorization.authorizationUrl;
            } else {
              window.open(authorization.authorizationUrl, '_blank', 'noopener,noreferrer');
            }
            const connection = await waitForActiveComposioConnection(composioToolkit!, authorization.connectionId);
            authWindow?.close();
            if (canLearnFromConnection && learnAfterConnect) {
              if (!connection.accountId) throw new Error('Connector account is unavailable.');
              await startAccountLearning(connection.accountId);
            }
          }
        } else if (usesMcpOAuth) {
          const authorization = await startConnectorAuthorization(instance.instanceId);
          if (!authorization.authorizationUrl && authorization.status !== 'connected') {
            throw new Error('The MCP server did not return an authorization URL.');
          }
          if (authorization.authorizationUrl) {
            if (electron) {
              const openResult = await window.electronAPI?.shell?.openExternalUrl(authorization.authorizationUrl);
              if (!openResult?.ok) throw new Error(openResult?.error ?? 'Could not open the system browser.');
            } else if (authWindow) {
              authWindow.location.href = authorization.authorizationUrl;
            } else {
              window.open(authorization.authorizationUrl, '_blank', 'noopener,noreferrer');
            }
          }
          await waitForConnectorAuthorization(instance.instanceId);
          authWindow?.close();
        }
      } catch (error) {
        authWindow?.close();
        onChange({
          ...draft,
          installing: false,
          result: instance,
          health: null,
          error: error instanceof Error ? error.message : String(error),
        });
        await onInstalled(instance);
        return;
      }
      if (!isComposioToolkit) {
        try {
          health = await testConnector(instance.instanceId);
        } catch {
          health = null;
        }
      }
      onChange({ ...draft, installing: false, result: instance, health });
      await onInstalled(instance);
    } catch (error) {
      authWindow?.close();
      onChange({
        ...draft,
        installing: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }, [canLearnFromConnection, composioApiKey, composioAuth, composioConfigured, composioToolkit, connector, draft, isComposioToolkit, learnAfterConnect, onChange, onInstalled, t.composioAuthConfigRequired, t.composioAuthConfigUnavailable]);

  const enabledAuthConfigs = composioAuth?.authConfigs.filter(
    (item) => item.status === 'ENABLED' && item.isEnabledForToolRouter,
  ) ?? [];
  const authConfigRequired = composioAuth?.requiresCustomAuthConfig === true;
  const missingRequiredAuthConfig = composioConfigured && authConfigRequired && !draft.config.authConfigId?.trim();

  return (
    <Dialog.Root open onOpenChange={(open) => { if (!open) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="xopc-dialog-overlay fixed inset-0 z-[60] bg-scrim" />
        <Dialog.Content
          className={cn(
            'xopc-dialog-content fixed left-1/2 top-1/2 z-[60] flex h-[min(100vh-2rem,36rem)] w-[min(100%-2rem,min(92vw,42rem))] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden',
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
                  {description}
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
            <div className="flex flex-col gap-4">
          {isComposioToolkit && composioSetupLoading ? (
            <section
              className="rounded-2xl border border-edge bg-surface-base p-4"
              aria-busy="true"
              aria-label={t.composioSetupTitle}
            >
              <Skeleton className="h-4 w-40" />
              <Skeleton className="mt-2 h-3 w-72 max-w-full" />
              <Skeleton className="mt-3 h-16 w-full rounded-xl" />
            </section>
          ) : isComposioToolkit && !composioConfigured ? (
            <section className="rounded-2xl border border-accent/25 bg-accent-soft/50 p-4">
              <h3 className="text-sm font-semibold text-fg">{t.composioSetupTitle}</h3>
              <p className="mt-1 text-xs leading-5 text-fg-muted">{t.composioSetupHint}</p>
              <div className="mt-3">
                <OAuthProviderConnect
                  providerId="xopc-cloud"
                  displayName="XOPC Cloud"
                  connected={false}
                  onConnected={() => {
                    void getComposioSetupStatus().then((status) => {
                      setComposioSetupStatus(status);
                      setComposioConfigured(status.configured);
                    });
                  }}
                />
              </div>
              <details className="mt-3 rounded-xl border border-edge bg-surface-base p-3">
                <summary className="cursor-pointer text-xs font-medium text-fg">{t.composioSetupByok}</summary>
                <ol className="mt-3 list-inside list-decimal space-y-1 text-xs text-fg-muted">
                  <li>{t.composioSetupStepProject}</li>
                  <li>{t.composioSetupStepKey}</li>
                  <li>{t.composioSetupStepPaste}</li>
                </ol>
                <a className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-accent-fg hover:underline" href="https://app.composio.dev" target="_blank" rel="noreferrer">
                  {t.composioSetupOpenDashboard}<ExternalLink className="size-3.5" aria-hidden />
                </a>
                <SecretInput className="mt-3" value={composioApiKey} onChange={setComposioApiKey} labels={t.secretInputLabels} placeholder={t.composioSetupKeyPlaceholder} />
                <p className="mt-2 text-[11px] text-fg-subtle">{t.composioSetupStorageHint}</p>
              </details>
            </section>
          ) : null}
          {isComposioToolkit && canLearnFromConnection ? (
            <label className="flex items-start gap-3 rounded-2xl border border-edge bg-surface-base p-4">
              <input
                type="checkbox"
                className="mt-0.5 size-4 accent-accent"
                checked={learnAfterConnect}
                onChange={(event) => setLearnAfterConnect(event.currentTarget.checked)}
              />
              <span>
                <span className="block text-sm font-medium text-fg">{t.learnAfterConnect}</span>
                <span className="mt-1 block text-xs leading-5 text-fg-muted">{t.learnAfterConnectHint}</span>
              </span>
            </label>
          ) : null}
          {isComposioToolkit && composioConfigured ? (
            <section className="rounded-2xl border border-edge bg-surface-base p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h3 className="text-sm font-semibold text-fg">{t.composioAuthConfigTitle}</h3>
                  <p className="mt-1 text-xs leading-5 text-fg-muted">
                    {authConfigRequired ? t.composioAuthConfigRequiredHint : t.composioAuthConfigOptionalHint}
                  </p>
                </div>
                {composioSetupStatus?.mode === 'byok' ? <a
                  className="inline-flex items-center gap-1 text-xs font-medium text-accent-fg hover:underline"
                  href="https://app.composio.dev"
                  target="_blank"
                  rel="noreferrer"
                >
                  {t.composioAuthConfigManage}<ExternalLink className="size-3.5" aria-hidden />
                </a> : <span className="rounded-full bg-accent-soft px-2.5 py-1 text-xs font-medium text-accent-fg">{t.composioSetupManaged}</span>}
              </div>
              {composioSetupStatus?.mode === 'managed' ? null : composioAuthLoading ? (
                <Skeleton className="mt-3 h-10 w-full" />
              ) : (
                <Select
                  className={cn(inputClass, 'mt-3')}
                  value={draft.config.authConfigId ?? ''}
                  onChange={(event) => onChange({
                    ...draft,
                    config: { ...draft.config, authConfigId: event.currentTarget.value },
                    error: null,
                  })}
                >
                  {!authConfigRequired ? <SelectOption value="">{t.composioAuthConfigManaged}</SelectOption> : null}
                  {authConfigRequired && !draft.config.authConfigId ? (
                    <SelectOption value="" disabled>{t.composioAuthConfigSelect}</SelectOption>
                  ) : null}
                  {enabledAuthConfigs.map((item) => (
                    <SelectOption key={item.id} value={item.id}>
                      {item.name} · {item.authScheme ?? 'OAuth'} · {item.id}
                    </SelectOption>
                  ))}
                </Select>
              )}
              {!composioAuthLoading && authConfigRequired && enabledAuthConfigs.length === 0 ? (
                <p className="mt-2 text-xs text-amber-700 dark:text-amber-300">{t.composioAuthConfigEmpty}</p>
              ) : null}
            </section>
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
          {composioSetupError ? <p className="rounded-xl bg-red-500/10 px-3 py-2 text-sm text-red-600">{composioSetupError}</p> : null}
          {draft.result ? (
            <div className="rounded-2xl border border-edge bg-surface-base p-4 text-sm text-fg-muted">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="font-medium text-fg">{t.connectedBadge}</p>
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
              <p className="mt-3">
                {draft.health?.ok ? t.connectionReady : draft.health ? t.connectionNeedsSetup : t.installedWithoutHealth}
              </p>
              {draft.health?.action ? <p className="mt-3 text-xs text-fg-subtle">{draft.health.action}</p> : null}
            </div>
          ) : null}
            </div>
          </div>

          <div className="flex shrink-0 justify-end gap-2 border-t border-edge-subtle px-6 py-4">
            <Button variant="primary" disabled={Boolean(draft.result) || draft.installing || composioSetupLoading || composioAuthLoading || missingRequiredAuthConfig || (isComposioToolkit && !composioConfigured && !composioApiKey.trim())} onClick={() => void submit()}>
              {draft.installing ? <Loader2 className="size-4 animate-spin" /> : draft.result ? <CheckCircle2 className="size-4" /> : <PackagePlus className="size-4" />}
              {draft.result ? t.connectedBadge : t.connect}
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
