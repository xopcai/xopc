import * as Dialog from '@radix-ui/react-dialog';
import { CheckCircle2, KeyRound, Loader2, PackagePlus, Server, Wrench, X } from 'lucide-react';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import type { ConnectorsSettingsMessages } from '@/i18n/messages';
import { cn } from '@/lib/cn';
import { interaction } from '@/lib/interaction';

import {
  previewConnector,
  type ConnectorCapability,
  type ConnectorDefinition,
  type ConnectorHealthResult,
} from '../connectors-api';
import { connectorBenefitsFor } from '../utils/connector-benefits';
import { connectorDescription } from '../utils/connector-copy';
import { formatConnectorMessage } from '../utils/connector-i18n';
import { ConnectorLogo } from './connector-logo';

function capabilityLabel(capability: ConnectorCapability, t: ConnectorsSettingsMessages): string {
  return t.connectorCapabilityLabels[capability] ?? capability;
}

function runtimeLabel(connector: ConnectorDefinition, t: ConnectorsSettingsMessages): string {
  if (connector.runtime.type === 'mcp') {
    return formatConnectorMessage(t.connectorRuntimeMcp, { serverId: connector.runtime.serverId });
  }
  const id = connector.runtime.type === 'composio'
    ? connector.runtime.toolkit
    : connector.runtime.type === 'channel'
      ? connector.runtime.channelId
      : connector.runtime.type === 'nativeTool'
        ? connector.runtime.toolsetId
        : connector.runtime.sourceKind;
  return formatConnectorMessage(t.connectorRuntimeGeneric, { runtime: connector.runtime.type, id: id ?? connector.runtime.type });
}

function authLabel(connector: ConnectorDefinition, t: ConnectorsSettingsMessages): string {
  if (connector.auth.mode === 'oauth') return t.connectorAuthOAuth;
  if (connector.auth.mode === 'apiKey') return t.connectorAuthApiKey;
  return t.connectorAuthNone;
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
    <section>
      <h4 className="mb-2 text-xs font-medium text-fg-muted">{title}</h4>
      <div className="divide-y divide-edge-subtle overflow-hidden rounded-lg border border-edge bg-surface-panel">
        {items.slice(0, 12).map((item) => (
          <div key={item.id} className="px-3 py-2.5">
            <p className="break-words font-mono text-xs font-medium text-fg">{item.title}</p>
            {item.description ? <p className="mt-1 line-clamp-2 text-xs leading-5 text-fg-muted">{item.description}</p> : null}
          </div>
        ))}
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
  const description = connectorDescription(connector, t);
  const [previewResult, setPreviewResult] = useState<ConnectorHealthResult | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const benefits = connectorBenefitsFor(connector);
  const requiredInputs = [
    ...(connector.setup.secrets ?? []).filter((field) => field.required),
    ...(connector.setup.config ?? []).filter((field) => field.required),
  ];
  const capabilities = connector.capabilities.filter((capability) => (
    !capability.startsWith('runtime.') && !capability.startsWith('auth.')
  ));

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
            'xopc-dialog-content fixed left-1/2 top-1/2 z-[60] flex h-[min(100vh-2rem,42rem)] w-[min(100%-2rem,min(92vw,44rem))] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden',
            'rounded-2xl border border-edge bg-surface-panel shadow-float outline-none dark:border-edge',
          )}
        >
          <div className="flex shrink-0 items-start justify-between gap-3 border-b border-edge-subtle px-5 py-5 sm:px-6">
            <div className="flex min-w-0 items-start gap-3">
              <ConnectorLogo connector={connector} size="lg" />
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <Dialog.Title className="text-base font-semibold text-fg">{connector.displayName}</Dialog.Title>
                  {installed ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[11px] font-medium text-emerald-700 dark:text-emerald-300">
                      <CheckCircle2 className="size-3" aria-hidden />
                      {t.connectedBadge}
                    </span>
                  ) : null}
                </div>
                <Dialog.Description className="mt-1 line-clamp-3 text-sm leading-6 text-fg-muted">
                  {description}
                </Dialog.Description>
              </div>
            </div>
            <Dialog.Close asChild>
              <button
                type="button"
                className={cn('rounded-lg p-1.5 text-fg-muted hover:bg-surface-hover hover:text-fg', interaction.focusRingPanel)}
                aria-label={t.modalClose}
              >
                <X className="size-5" strokeWidth={1.75} aria-hidden />
              </button>
            </Dialog.Close>
          </div>

          <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-5 sm:px-6">
            {benefits.length ? (
              <section>
                <h3 className="text-sm font-semibold text-fg">{t.connectorWhyConnect}</h3>
                <div className="mt-3 divide-y divide-edge-subtle overflow-hidden rounded-xl border border-edge bg-surface-base">
                  {benefits.map((benefit) => (
                    <div key={benefit} className="px-4 py-3">
                      <p className="text-sm font-medium text-fg">{t.connectorBenefitHeadings[benefit]}</p>
                      <p className="mt-1 text-xs leading-5 text-fg-muted">{t.connectorBenefitHints[benefit]}</p>
                    </div>
                  ))}
                </div>
              </section>
            ) : null}

            <section className="overflow-hidden rounded-xl border border-edge bg-surface-base">
              <div className="flex items-start gap-3 border-b border-edge-subtle px-4 py-3">
                <KeyRound className="mt-0.5 size-4 shrink-0 text-fg-muted" aria-hidden />
                <div>
                  <p className="text-sm font-medium text-fg">{t.detailPermissions}</p>
                  <p className="mt-1 text-xs text-fg-muted">{authLabel(connector, t)}</p>
                </div>
              </div>
              <div className="px-4 py-3">
                <p className="text-sm font-medium text-fg">{t.connectorSetupTitle}</p>
                <p className="mt-1 text-xs leading-5 text-fg-muted">
                  {requiredInputs.length
                    ? formatConnectorMessage(t.connectorRequiredInputsCount, { count: String(requiredInputs.length) })
                    : t.connectorSetupNone}
                </p>
              </div>
            </section>

            <details className="rounded-xl border border-edge bg-surface-base">
              <summary className="cursor-pointer px-4 py-3 text-sm font-medium text-fg-muted hover:text-fg">
                {t.connectorTechnicalDetails}
              </summary>
              <div className="space-y-5 border-t border-edge-subtle px-4 py-4">
                <div>
                  <p className="flex items-center gap-2 text-xs font-medium text-fg-muted">
                    <Server className="size-3.5" aria-hidden />
                    {t.connectorRuntimeTitle}
                  </p>
                  <p className="mt-1 break-words text-xs text-fg-subtle">{runtimeLabel(connector, t)}</p>
                </div>
                {capabilities.length ? (
                  <div className="flex flex-wrap gap-1.5">
                    {capabilities.map((capability) => (
                      <span key={capability} className="rounded-md bg-surface-panel px-2 py-1 text-xs text-fg-muted">
                        {capabilityLabel(capability, t)}
                      </span>
                    ))}
                  </div>
                ) : null}
                <Button variant="secondary" disabled={previewLoading} onClick={() => void runPreview()}>
                  {previewLoading ? <Loader2 className="size-4 animate-spin" /> : <Wrench className="size-4" />}
                  {t.connectorPreviewButton}
                </Button>
                {previewError ? <p className="rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-600">{previewError}</p> : null}
                {previewResult ? (
                  <div className="space-y-4">
                    <CapabilityPreviewList
                      title={t.detailTools}
                      items={previewResult.tools.map((tool) => ({ id: tool.name, title: tool.shortName ?? tool.name, description: tool.description }))}
                    />
                    <CapabilityPreviewList
                      title={t.detailResources}
                      items={previewResult.resources.map((resource) => ({ id: resource.uri, title: resource.title ?? resource.name ?? resource.uri, description: resource.description }))}
                    />
                    <CapabilityPreviewList
                      title={t.detailPrompts}
                      items={previewResult.prompts.map((prompt) => ({ id: prompt.name, title: prompt.title ?? prompt.name, description: prompt.description }))}
                    />
                  </div>
                ) : null}
              </div>
            </details>
          </div>

          <div className="flex shrink-0 justify-end gap-2 border-t border-edge-subtle px-5 py-4 sm:px-6">
            <Dialog.Close asChild><Button variant="secondary">{t.modalClose}</Button></Dialog.Close>
            {!installed ? (
              <Button
                variant="primary"
                onClick={() => {
                  onInstall(connector);
                  onClose();
                }}
              >
                <PackagePlus className="size-4" />
                {t.connect}
              </Button>
            ) : null}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
