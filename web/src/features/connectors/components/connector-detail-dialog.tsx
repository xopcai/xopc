import * as Dialog from '@radix-ui/react-dialog';
import { CheckCircle2, Database, KeyRound, Loader2, PackagePlus, PlugZap, Server, Wrench, X } from 'lucide-react';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import type { ConnectorsSettingsMessages } from '@/i18n/messages';
import { cn } from '@/lib/cn';
import { interaction } from '@/lib/interaction';

import { previewConnector, type ConnectorCapability, type ConnectorDefinition, type ConnectorHealthResult } from '../connectors-api';

function formatConnectorMessage(template: string, params: Record<string, string | number>): string {
  return Object.entries(params).reduce((message, [key, value]) => (
    message.replaceAll(`{{${key}}}`, String(value))
  ), template);
}

function capabilityLabel(capability: ConnectorCapability, t: ConnectorsSettingsMessages): string {
  return t.connectorCapabilityLabels[capability] ?? capability;
}

function runtimeLabel(connector: ConnectorDefinition, t: ConnectorsSettingsMessages): string {
  if (connector.runtime.type === 'mcp') {
    return formatConnectorMessage(t.connectorRuntimeMcp, { serverId: connector.runtime.serverId });
  }
  const id = connector.runtime.id ?? connector.runtime.channelId ?? connector.runtime.toolkit ?? connector.runtime.toolsetId ?? connector.runtime.sourceKind ?? connector.runtime.type;
  return formatConnectorMessage(t.connectorRuntimeGeneric, { runtime: connector.runtime.type, id });
}

function authLabel(connector: ConnectorDefinition, t: ConnectorsSettingsMessages): string {
  if (connector.auth.mode === 'oauth') return t.connectorAuthOAuth;
  if (connector.auth.mode === 'apiKey') return t.connectorAuthApiKey;
  return t.connectorAuthNone;
}

function countRequiredInputs(connector: ConnectorDefinition): number {
  const secretCount = (connector.setup.secrets ?? []).filter((field) => field.required).length;
  const configCount = (connector.setup.config ?? []).filter((field) => field.required).length;
  return secretCount + configCount;
}

function CapabilityPreviewList({
  title,
  items,
}: {
  title: string;
  items: Array<{ id: string; title: string; description?: string }>;
}) {
  if (items.length === 0) return null;
  return (
    <section className="rounded-lg border border-edge bg-surface-base">
      <div className="border-b border-edge px-3 py-2 text-xs font-semibold text-fg">{title}</div>
      <div className="max-h-48 overflow-y-auto">
        {items.slice(0, 16).map((item) => (
          <div key={item.id} className="border-b border-edge-subtle px-3 py-2 last:border-b-0">
            <div className="break-words font-mono text-xs font-medium text-fg">{item.title}</div>
            {item.description ? <p className="mt-1 line-clamp-2 text-xs leading-5 text-fg-muted">{item.description}</p> : null}
          </div>
        ))}
        {items.length > 16 ? <div className="px-3 py-2 text-xs text-fg-subtle">+{items.length - 16}</div> : null}
      </div>
    </section>
  );
}

export function ConnectorDetailDialog({
  connector,
  installed,
  onClose,
  onInstall,
  t,
}: {
  connector: ConnectorDefinition;
  installed: boolean;
  onClose: () => void;
  onInstall: (connector: ConnectorDefinition) => void;
  t: ConnectorsSettingsMessages;
}) {
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewResult, setPreviewResult] = useState<ConnectorHealthResult | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const requiredInputCount = countRequiredInputs(connector);
  const visibleCapabilities = connector.capabilities.slice(0, 8);
  const hiddenCapabilities = Math.max(0, connector.capabilities.length - visibleCapabilities.length);
  const setupItems = [
    ...(connector.setup.secrets ?? []).map((field) => ({
      key: `secret:${field.key}`,
      label: field.label,
      description: field.description,
      required: field.required,
      kind: t.connectorSetupSecret,
    })),
    ...(connector.setup.config ?? []).map((field) => ({
      key: `config:${field.key}`,
      label: field.label,
      description: field.description,
      required: Boolean(field.required),
      kind: t.connectorSetupConfig,
    })),
  ];
  const runPreview = async () => {
    setPreviewLoading(true);
    setPreviewError(null);
    try {
      setPreviewResult(await previewConnector(connector));
    } catch (error) {
      setPreviewResult(null);
      setPreviewError(error instanceof Error ? error.message : String(error));
    } finally {
      setPreviewLoading(false);
    }
  };

  return (
    <Dialog.Root open onOpenChange={(open) => { if (!open) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="xopc-dialog-overlay fixed inset-0 z-[60] bg-scrim" />
        <Dialog.Content
          className={cn(
            'xopc-dialog-content fixed left-1/2 top-1/2 z-[60] flex h-[min(100vh-2rem,44rem)] w-[min(100%-2rem,min(92vw,52rem))] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden',
            'rounded-2xl border border-edge bg-surface-panel shadow-float outline-none dark:border-edge',
          )}
        >
          <div className="flex shrink-0 items-start justify-between gap-3 border-b border-edge-subtle px-6 py-5">
            <div className="min-w-0">
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <span className="rounded-md border border-edge bg-surface-base px-2 py-0.5 text-[11px] font-medium text-fg-muted">
                  {connector.source}
                </span>
                <span className="rounded-md border border-edge bg-surface-base px-2 py-0.5 text-[11px] font-medium text-fg-muted">
                  {connector.kind}
                </span>
                {installed ? (
                  <span className="inline-flex items-center gap-1 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[11px] font-medium text-emerald-700 dark:text-emerald-300">
                    <CheckCircle2 className="size-3" aria-hidden />
                    {t.installedBadge}
                  </span>
                ) : null}
              </div>
              <Dialog.Title className="text-base font-semibold text-fg">
                {connector.displayName}
              </Dialog.Title>
              <Dialog.Description className="mt-1 line-clamp-3 text-sm leading-6 text-fg-muted">
                {connector.description}
              </Dialog.Description>
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

          <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-lg border border-edge bg-surface-base p-3">
                <div className="flex items-center gap-2 text-xs font-medium text-fg-muted">
                  <Wrench className="size-3.5" aria-hidden />
                  {t.detailTools}
                </div>
                <p className="mt-2 text-sm font-semibold text-fg">
                  {previewResult ? formatConnectorMessage(t.connectorPreviewToolsCount, { count: previewResult.toolCount }) : t.connectorPreviewUnknown}
                </p>
              </div>
              <div className="rounded-lg border border-edge bg-surface-base p-3">
                <div className="flex items-center gap-2 text-xs font-medium text-fg-muted">
                  <KeyRound className="size-3.5" aria-hidden />
                  {t.detailPermissions}
                </div>
                <p className="mt-2 text-sm font-semibold text-fg">{authLabel(connector, t)}</p>
              </div>
              <div className="rounded-lg border border-edge bg-surface-base p-3">
                <div className="flex items-center gap-2 text-xs font-medium text-fg-muted">
                  <Database className="size-3.5" aria-hidden />
                  {t.connectorRequiredInputs}
                </div>
                <p className="mt-2 text-sm font-semibold text-fg">
                  {formatConnectorMessage(t.connectorRequiredInputsCount, { count: requiredInputCount })}
                </p>
              </div>
            </div>

            <div className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,1fr)_18rem]">
              <div className="min-w-0 space-y-5">
                <section>
                  <h3 className="text-sm font-semibold text-fg">{t.connectorCapabilitiesTitle}</h3>
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {visibleCapabilities.map((capability) => (
                      <span
                        key={capability}
                        className="rounded-md border border-edge bg-surface-base px-2 py-1 text-xs text-fg-muted"
                      >
                        {capabilityLabel(capability, t)}
                      </span>
                    ))}
                    {hiddenCapabilities > 0 ? (
                      <span className="rounded-md border border-edge bg-surface-base px-2 py-1 text-xs text-fg-subtle">
                        +{hiddenCapabilities}
                      </span>
                    ) : null}
                  </div>
                  <p className="mt-3 text-sm leading-6 text-fg-muted">{t.connectorCapabilitiesHint}</p>
                </section>

                {previewError ? (
                  <p className="rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-600">{previewError}</p>
                ) : null}

                {previewResult ? (
                  <section>
                    <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                      <h3 className="text-sm font-semibold text-fg">{t.connectorPreviewTitle}</h3>
                      <span
                        className={cn(
                          'rounded-full px-2 py-0.5 text-xs font-medium',
                          previewResult.ok
                            ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                            : 'bg-amber-500/10 text-amber-700 dark:text-amber-300',
                        )}
                      >
                        {previewResult.ok ? t.healthStatusHealthy : (t.healthStatusLabels[previewResult.status] ?? previewResult.status)}
                      </span>
                    </div>
                    <div className="mb-3 grid gap-2 text-xs sm:grid-cols-3">
                      <div className="rounded-lg border border-edge bg-surface-base px-3 py-2">
                        <div className="font-semibold text-fg">{previewResult.toolCount}</div>
                        <div className="text-fg-muted">{t.toolsMetric}</div>
                      </div>
                      <div className="rounded-lg border border-edge bg-surface-base px-3 py-2">
                        <div className="font-semibold text-fg">{previewResult.resourceCount}</div>
                        <div className="text-fg-muted">{t.resourcesMetric}</div>
                      </div>
                      <div className="rounded-lg border border-edge bg-surface-base px-3 py-2">
                        <div className="font-semibold text-fg">{previewResult.promptCount}</div>
                        <div className="text-fg-muted">{t.promptsMetric}</div>
                      </div>
                    </div>
                    <div className="grid gap-2">
                      <CapabilityPreviewList
                        title={t.detailTools}
                        items={previewResult.tools.map((tool) => ({
                          id: tool.name,
                          title: tool.shortName ?? tool.name,
                          description: tool.description,
                        }))}
                      />
                      <CapabilityPreviewList
                        title={t.detailResources}
                        items={previewResult.resources.map((resource) => ({
                          id: resource.uri,
                          title: resource.title ?? resource.name ?? resource.uri,
                          description: resource.description ?? resource.uri,
                        }))}
                      />
                      <CapabilityPreviewList
                        title={t.detailPrompts}
                        items={previewResult.prompts.map((prompt) => ({
                          id: prompt.name,
                          title: prompt.title ?? prompt.name,
                          description: prompt.description ?? formatConnectorMessage(t.promptArgumentCount, { count: prompt.argumentCount }),
                        }))}
                      />
                    </div>
                    {previewResult.error ? <p className="mt-3 text-xs leading-5 text-fg-subtle">{previewResult.error}</p> : null}
                    {previewResult.action ? <p className="mt-2 text-xs leading-5 text-fg-subtle">{previewResult.action}</p> : null}
                  </section>
                ) : null}

              </div>

              <aside className="space-y-3">
                <section className="rounded-lg border border-edge bg-surface-base p-3">
                  <h3 className="flex items-center gap-2 text-sm font-semibold text-fg">
                    <KeyRound className="size-4 text-accent" aria-hidden />
                    {t.detailPermissions}
                  </h3>
                  <p className="mt-2 text-sm font-medium text-fg">{authLabel(connector, t)}</p>
                </section>

                <section className="rounded-lg border border-edge bg-surface-base p-3">
                  <h3 className="flex items-center gap-2 text-sm font-semibold text-fg">
                    <Database className="size-4 text-accent" aria-hidden />
                    {t.connectorSetupTitle}
                  </h3>
                  {setupItems.length > 0 ? (
                    <div className="mt-3 divide-y divide-edge overflow-hidden rounded-lg border border-edge">
                      {setupItems.map((item) => (
                        <div key={item.key} className="bg-surface-panel px-3 py-2.5">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-sm font-medium text-fg">{item.label}</span>
                            <span className="rounded-md bg-surface-hover px-1.5 py-0.5 text-[11px] text-fg-muted">{item.kind}</span>
                            {item.required ? (
                              <span className="rounded-md bg-amber-500/10 px-1.5 py-0.5 text-[11px] font-medium text-amber-700 dark:text-amber-300">
                                {t.connectorSetupRequired}
                              </span>
                            ) : null}
                          </div>
                          {item.description ? <p className="mt-1 text-xs leading-5 text-fg-muted">{item.description}</p> : null}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="mt-2 text-sm leading-6 text-fg-muted">
                      {t.connectorSetupNone}
                    </p>
                  )}
                </section>

                <section className="rounded-lg border border-edge bg-surface-base p-3">
                  <h3 className="flex items-center gap-2 text-sm font-semibold text-fg">
                    <Server className="size-4 text-accent" aria-hidden />
                    {t.connectorRuntimeTitle}
                  </h3>
                  <p className="mt-2 break-words text-xs leading-5 text-fg-muted">{runtimeLabel(connector, t)}</p>
                </section>
              </aside>
            </div>
          </div>

          <div className="flex shrink-0 flex-wrap justify-end gap-2 border-t border-edge-subtle px-6 py-4">
            <Dialog.Close asChild>
              <Button variant="secondary">{t.modalClose}</Button>
            </Dialog.Close>
            <Button variant="secondary" disabled={previewLoading} onClick={() => void runPreview()}>
              {previewLoading ? <Loader2 className="size-4 animate-spin" /> : <Wrench className="size-4" />}
              {t.connectorPreviewButton}
            </Button>
            {!installed ? (
              <Button
                variant="primary"
                onClick={() => {
                  onInstall(connector);
                  onClose();
                }}
              >
                <PackagePlus className="size-4" />
                {t.install}
              </Button>
            ) : (
              <Button variant="secondary" disabled>
                <PlugZap className="size-4" />
                {t.installedBadge}
              </Button>
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
