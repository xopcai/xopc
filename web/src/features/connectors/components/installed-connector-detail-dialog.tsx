import { CliConnectorDialog } from './cli-connector-dialog';
import * as Dialog from '@radix-ui/react-dialog';
import { Database, Loader2, Save, Trash2, X } from 'lucide-react';
import { useCallback, useState } from 'react';

import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import type { ConnectorsSettingsMessages, McpSettingsMessages } from '@/i18n/messages';
import { cn } from '@/lib/cn';
import { settingsInputFocusClass } from '@/lib/form-field-width';
import { interaction } from '@/lib/interaction';

import {
  removeConnector,
  syncConnectorSource,
  updateConnectorConfig,
  type ConnectorDefinition,
  type ConnectorInstance,
} from '../connectors-api';
import { connectorDescription } from '../utils/connector-copy';
import { formatConnectorMessage } from '../utils/connector-i18n';
import { ComposioConnectorPanel } from './composio-connector-panel';
import { ConnectorLogo } from './connector-logo';


const inputClass = cn(
  'w-full rounded-lg border border-edge bg-surface-panel px-3 py-2 text-sm text-fg',
  'placeholder:text-fg-subtle',
  settingsInputFocusClass,
);

function initialConfigDraft(definition: ConnectorDefinition | undefined, instance: ConnectorInstance): Record<string, string> {
  const draft: Record<string, string> = {};
  for (const field of definition?.setup.config ?? []) {
    const value = instance.config?.[field.key] ?? field.defaultValue ?? '';
    draft[field.key] = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  }
  return draft;
}

function parseConfigValue(type: string, raw: string): unknown {
  const trimmed = raw.trim();
  if (type === 'json') return trimmed ? JSON.parse(trimmed) : undefined;
  if (type === 'number') return trimmed ? Number(trimmed) : undefined;
  if (type === 'boolean') return trimmed === 'true';
  return trimmed || undefined;
}

function StandardInstalledConnectorDetailDialog({
  instance,
  definition,
  onClose,
  onChanged,
  t,
}: {
  instance: ConnectorInstance;
  definition?: ConnectorDefinition;
  onClose: () => void;
  onChanged: () => Promise<void>;
  t: ConnectorsSettingsMessages;
  mcp: McpSettingsMessages;
}) {
  const [removing, setRemoving] = useState(false);
  const [removeConfirmOpen, setRemoveConfirmOpen] = useState(false);
  const [savingConfig, setSavingConfig] = useState(false);
  const [syncingSource, setSyncingSource] = useState(false);
  const [sourceSyncCount, setSourceSyncCount] = useState<number | null>(null);
  const [configDraft, setConfigDraft] = useState(() => initialConfigDraft(definition, instance));
  const [error, setError] = useState<string | null>(null);

  const editableConfigFields = definition?.setup.config ?? [];
  const supportsConfigEdit = (instance.materialized.type === 'mcp' || instance.materialized.type === 'memorySource')
    && editableConfigFields.length > 0
    && (definition?.setup.secrets ?? []).length === 0;
  const isMcp = instance.materialized.type === 'mcp';
  const isComposio = instance.materialized.type === 'composio';
  const isMemorySource = instance.materialized.type === 'memorySource';
  const description = definition ? connectorDescription(definition, t) : null;

  const remove = useCallback(async () => {
    setRemoving(true);
    setError(null);
    try {
      await removeConnector(instance.instanceId);
      await onChanged();
      onClose();
    } catch (removeError) {
      setError(removeError instanceof Error ? removeError.message : String(removeError));
      setRemoving(false);
    }
  }, [instance.instanceId, onChanged, onClose]);

  const saveConfig = useCallback(async () => {
    if (!definition || !supportsConfigEdit) return;
    setSavingConfig(true);
    setError(null);
    try {
      const config: Record<string, unknown> = {};
      for (const field of definition.setup.config ?? []) {
        const parsed = parseConfigValue(field.type, configDraft[field.key] ?? '');
        if (parsed !== undefined) config[field.key] = parsed;
      }
      await updateConnectorConfig(instance.instanceId, { config });
      await onChanged();
    } catch (configError) {
      setError(configError instanceof Error ? configError.message : String(configError));
    } finally {
      setSavingConfig(false);
    }
  }, [configDraft, definition, instance.instanceId, onChanged, supportsConfigEdit]);

  const syncSource = useCallback(async () => {
    setSyncingSource(true);
    setSourceSyncCount(null);
    setError(null);
    try {
      const result = await syncConnectorSource(instance.connectorId);
      setSourceSyncCount(result.recordIds.length);
      await onChanged();
    } catch (syncError) {
      setError(syncError instanceof Error ? syncError.message : String(syncError));
    } finally {
      setSyncingSource(false);
    }
  }, [instance.connectorId, onChanged]);

  return (
    <Dialog.Root open onOpenChange={(open) => { if (!open) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="xopc-dialog-overlay fixed inset-0 z-[60] bg-scrim" />
        <Dialog.Content
          className={cn(
            'xopc-dialog-content fixed left-1/2 top-1/2 z-[60] flex -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden',
            isComposio ? 'h-[min(100dvh-2rem,36rem)] w-[min(100%-2rem,40rem)]' : 'h-[min(100dvh-2rem,44rem)] w-[min(100%-2rem,min(92vw,54rem))]',
            'rounded-2xl border border-edge bg-surface-overlay shadow-float outline-none dark:border-edge',
          )}
        >
          <div className="flex shrink-0 items-start justify-between gap-3 border-b border-edge-subtle px-6 py-5">
            <div className="flex min-w-0 items-start gap-3">
              <ConnectorLogo connector={definition} size="lg" />
              <div className="min-w-0">
                <Dialog.Title className="text-base font-semibold text-fg">{instance.displayName}</Dialog.Title>
                <Dialog.Description className="mt-1 text-sm text-fg-muted">
                  {description ?? (instance.materialized.type === 'mcp'
                    ? formatConnectorMessage(t.mcpServerRuntime, { serverId: instance.materialized.serverId })
                    : formatConnectorMessage(t.runtimeLabel, { runtime: instance.materialized.type }))}
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
                <span className="sr-only">{t.modalClose}</span>
              </button>
            </Dialog.Close>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
            {error ? <p className="mb-4 rounded-xl bg-red-500/10 px-3 py-2 text-sm text-red-600">{error}</p> : null}

            {isMcp ? (
              <div className="space-y-3 rounded-xl border border-edge bg-surface-base p-3 text-sm">
                <p className="text-fg-muted">{t.connectorConfigLabel} · xopc mcp list / login / logout</p>
                {supportsConfigEdit ? editableConfigFields.map(field => (
                  <label key={field.key} className="flex flex-col gap-1.5">
                    <span className="font-medium text-fg">{field.label}</span>
                    {field.description ? <span className="text-xs text-fg-subtle">{field.description}</span> : null}
                    <input className={inputClass} value={configDraft[field.key] ?? ''} placeholder={field.placeholder}
                      onChange={event => setConfigDraft(previous => ({ ...previous, [field.key]: event.currentTarget.value }))} />
                  </label>
                )) : null}
              </div>
            ) : null}

            {isComposio ? (
              <ComposioConnectorPanel instance={instance} t={t} onChanged={onChanged} />
            ) : null}
            {isMemorySource ? (
              <div className="space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-edge bg-surface-base p-4 text-sm">
                  <div>
                    <p className="font-medium text-fg">{t.connectedSourceSync}</p>
                    {description ? <p className="mt-1 text-xs text-fg-muted">{description}</p> : null}
                    {sourceSyncCount !== null ? (
                      <p className="mt-1 text-xs text-emerald-600">
                        {formatConnectorMessage(t.connectedSourceSynced, { count: String(sourceSyncCount) })}
                      </p>
                    ) : null}
                  </div>
                  <Button disabled={syncingSource} onClick={() => void syncSource()}>
                    {syncingSource ? <Loader2 className="size-4 animate-spin" /> : <Database className="size-4" />}
                    {t.composioSyncNow}
                  </Button>
                </div>
                {supportsConfigEdit ? (
                  <div className="grid gap-3 rounded-xl border border-edge bg-surface-base p-4">
                    {editableConfigFields.map((field) => (
                      <label key={field.key} className="flex flex-col gap-1.5">
                        <span className="text-sm font-medium text-fg">{field.label}</span>
                        {field.description ? <span className="text-xs text-fg-subtle">{field.description}</span> : null}
                        <input
                          className={inputClass}
                          value={configDraft[field.key] ?? ''}
                          placeholder={field.placeholder}
                          onChange={(event) => setConfigDraft((previous) => ({ ...previous, [field.key]: event.currentTarget.value }))}
                        />
                      </label>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : null}
            {!isMcp && !isComposio && !isMemorySource ? (
              <div className="rounded-xl border border-edge bg-surface-base p-4 text-sm text-fg-muted">
                <p>{t.connectorPolicyHint}</p>
              </div>
            ) : null}

            <details className="mt-5 rounded-xl border border-edge">
              <summary className="cursor-pointer px-4 py-3 text-sm font-medium text-fg-muted hover:text-danger">{t.dangerZone}</summary>
              <div className="flex flex-col gap-3 border-t border-danger/15 px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-xs leading-5 text-fg-muted">{t.removeConnectorHint}</p>
                <Button
                  variant="secondary"
                  className="shrink-0 border-danger/30 text-danger hover:bg-danger/10"
                  disabled={removing}
                  onClick={() => setRemoveConfirmOpen(true)}
                >
                  {removing ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
                  {t.remove}
                </Button>
              </div>
            </details>
          </div>

          <div className="flex shrink-0 flex-wrap justify-end gap-2 border-t border-edge-subtle px-6 py-4">
            <Button variant="secondary" onClick={onClose}>{t.modalClose}</Button>
            {(isMcp || isMemorySource) && supportsConfigEdit ? (
              <Button variant="primary" disabled={savingConfig} onClick={() => void saveConfig()}>
                {savingConfig ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
                {t.modalSave}
              </Button>
            ) : null}
          </div>
        </Dialog.Content>
      </Dialog.Portal>

      <ConfirmDialog
        open={removeConfirmOpen}
        title={formatConnectorMessage(t.removeConfirmTitle, { name: instance.displayName })}
        description={t.removeConfirmDescription}
        confirmLabel={t.removeConfirmAction}
        cancelLabel={t.modalCancel}
        destructive
        onConfirm={() => {
          setRemoveConfirmOpen(false);
          void remove();
        }}
        onCancel={() => {
          if (!removing) setRemoveConfirmOpen(false);
        }}
      />
    </Dialog.Root>
  );
}

export function InstalledConnectorDetailDialog(props: Parameters<typeof StandardInstalledConnectorDetailDialog>[0]) {
  return props.instance.materialized.type === 'cli' && props.definition
    ? <CliConnectorDialog definition={props.definition} instance={props.instance} onClose={props.onClose} onChanged={props.onChanged} />
    : <StandardInstalledConnectorDetailDialog {...props} />;
}
