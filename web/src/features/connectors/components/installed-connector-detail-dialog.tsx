import * as Dialog from '@radix-ui/react-dialog';
import {
  Content as TooltipContent,
  Portal as TooltipPortal,
  Provider as TooltipProvider,
  Root as TooltipRoot,
  Trigger as TooltipTrigger,
} from '@radix-ui/react-tooltip';
import { Database, FileText, KeyRound, Loader2, PlugZap, Save, ShieldCheck, Trash2, Wrench, X } from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';

import { Button } from '@/components/ui/button';
import type { ConnectorsSettingsMessages, McpSettingsMessages } from '@/i18n/messages';
import { cn } from '@/lib/cn';
import { settingsInputFocusClass } from '@/lib/form-field-width';
import { interaction } from '@/lib/interaction';

import {
  removeConnector,
  syncConnectorMemory,
  testConnector,
  updateConnectorConfig,
  type ConnectorDefinition,
  type ConnectorHealthResult,
  type ConnectorHealthStatus,
  type ConnectorInstance,
} from '../connectors-api';
import { McpToolsListDialog } from '../mcp/mcp-tools-list-dialog';
import { formatConnectorMessage } from '../utils/connector-i18n';
import { ComposioConnectorPanel } from './composio-connector-panel';
import { ConnectorLogo } from './connector-logo';

type ConnectorDetailTab = 'health' | 'tools' | 'resources' | 'prompts' | 'permissions' | 'config';

const inputClass = cn(
  'w-full rounded-lg border border-edge bg-surface-panel px-3 py-2 text-sm text-fg',
  'placeholder:text-fg-subtle',
  settingsInputFocusClass,
);

function healthStatusLabel(status: ConnectorHealthStatus | undefined, t: ConnectorsSettingsMessages): string {
  if (!status) return t.healthNotTested;
  return t.healthStatusLabels[status] ?? status;
}

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

function CapabilityListItem({
  title,
  description,
  meta,
}: {
  title: string;
  description?: string;
  meta?: string;
}) {
  const descriptionNode = description ? (
    <TooltipProvider delayDuration={300} skipDelayDuration={100}>
      <TooltipRoot>
        <TooltipTrigger asChild>
          <p
            tabIndex={0}
            title={description}
            className={cn(
              'mt-1 line-clamp-3 cursor-help text-xs leading-5 text-fg-muted',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40',
            )}
          >
            {description}
          </p>
        </TooltipTrigger>
        <TooltipPortal>
          <TooltipContent
            side="top"
            align="start"
            sideOffset={6}
            collisionPadding={12}
            className="!z-[10000] max-h-[min(16rem,45vh)] max-w-[min(32rem,calc(100vw-2rem))] overflow-y-auto rounded-md border border-edge bg-surface-panel px-2.5 py-2 text-left text-xs leading-5 text-fg shadow-popover"
          >
            <span className="whitespace-pre-wrap break-words">{description}</span>
          </TooltipContent>
        </TooltipPortal>
      </TooltipRoot>
    </TooltipProvider>
  ) : null;

  return (
    <div className="rounded-lg border border-edge bg-surface-panel px-3 py-2.5">
      <div className="flex min-w-0 items-start justify-between gap-3">
        <p className="min-w-0 break-all font-mono text-xs font-medium leading-5 text-fg">{title}</p>
        {meta ? (
          <span className="shrink-0 rounded-md bg-surface-hover px-1.5 py-0.5 text-[11px] leading-4 text-fg-subtle">
            {meta}
          </span>
        ) : null}
      </div>
      {descriptionNode}
    </div>
  );
}

export function InstalledConnectorDetailDialog({
  instance,
  definition,
  onClose,
  onChanged,
  t,
  mcp,
}: {
  instance: ConnectorInstance;
  definition?: ConnectorDefinition;
  onClose: () => void;
  onChanged: () => Promise<void>;
  t: ConnectorsSettingsMessages;
  mcp: McpSettingsMessages;
}) {
  const [testing, setTesting] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [savingConfig, setSavingConfig] = useState(false);
  const [syncingMemory, setSyncingMemory] = useState(false);
  const [memorySyncCount, setMemorySyncCount] = useState<number | null>(null);
  const [health, setHealth] = useState<ConnectorHealthResult | null>(null);
  const [detailTab, setDetailTab] = useState<ConnectorDetailTab>(
    instance.materialized.type === 'mcp' ? 'health' : 'permissions',
  );
  const [toolsDialogOpen, setToolsDialogOpen] = useState(false);
  const [configDraft, setConfigDraft] = useState(() => initialConfigDraft(definition, instance));
  const [error, setError] = useState<string | null>(null);

  const editableConfigFields = definition?.setup.config ?? [];
  const supportsConfigEdit = (instance.materialized.type === 'mcp' || instance.materialized.type === 'memorySource')
    && editableConfigFields.length > 0
    && (definition?.setup.secrets ?? []).length === 0;
  const lastToolCount = health ? health.toolCount : instance.usage.lastToolCount;
  const tabItems = useMemo(() => {
    const items = instance.materialized.type === 'mcp'
      ? [
          ['health', ShieldCheck, t.detailHealth],
          ['tools', Wrench, `${t.detailTools} ${health ? health.toolCount : instance.usage.lastToolCount ?? ''}`],
          ['resources', Database, `${t.detailResources} ${health ? health.resourceCount : instance.usage.lastResourceCount ?? ''}`],
          ['prompts', FileText, `${t.detailPrompts} ${health ? health.promptCount : instance.usage.lastPromptCount ?? ''}`],
          ['permissions', KeyRound, t.detailPermissions],
        ] as const
      : [['permissions', KeyRound, t.detailPermissions]] as const;
    return supportsConfigEdit ? [...items, ['config', Database, t.connectorConfigLabel] as const] : items;
  }, [health, instance.materialized.type, instance.usage.lastPromptCount, instance.usage.lastResourceCount, instance.usage.lastToolCount, supportsConfigEdit, t]);

  const runTest = useCallback(async () => {
    setTesting(true);
    setError(null);
    try {
      const result = await testConnector(instance.instanceId);
      setHealth(result);
      if (result.toolCount > 0) setDetailTab('tools');
      void onChanged();
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
      setDetailTab('health');
    } catch (configError) {
      setError(configError instanceof Error ? configError.message : String(configError));
    } finally {
      setSavingConfig(false);
    }
  }, [configDraft, definition, instance.instanceId, onChanged, supportsConfigEdit]);

  const syncMemory = useCallback(async () => {
    setSyncingMemory(true);
    setMemorySyncCount(null);
    setError(null);
    try {
      const result = await syncConnectorMemory(instance.connectorId);
      setMemorySyncCount(result.recordIds.length);
      await onChanged();
    } catch (syncError) {
      setError(syncError instanceof Error ? syncError.message : String(syncError));
    } finally {
      setSyncingMemory(false);
    }
  }, [instance.connectorId, onChanged]);

  return (
    <Dialog.Root open onOpenChange={(open) => { if (!open) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="xopc-dialog-overlay fixed inset-0 z-[60] bg-scrim" />
        <Dialog.Content
          className={cn(
            'xopc-dialog-content fixed left-1/2 top-1/2 z-[60] flex h-[min(100vh-2rem,44rem)] w-[min(100%-2rem,min(92vw,54rem))] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden',
            'rounded-2xl border border-edge bg-surface-panel shadow-float outline-none dark:border-edge',
          )}
        >
          <div className="flex shrink-0 items-start justify-between gap-3 border-b border-edge-subtle px-6 py-5">
            <div className="flex min-w-0 items-start gap-3">
              <ConnectorLogo connector={definition} size="lg" />
              <div className="min-w-0">
                <Dialog.Title className="text-base font-semibold text-fg">{instance.displayName}</Dialog.Title>
                <Dialog.Description className="mt-1 text-sm text-fg-muted">
                  {instance.materialized.type === 'mcp'
                    ? formatConnectorMessage(t.mcpServerRuntime, { serverId: instance.materialized.serverId })
                    : formatConnectorMessage(t.runtimeLabel, { runtime: instance.materialized.type })}
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

            <div className="flex flex-wrap gap-2">
              {tabItems.map(([id, Icon, label]) => (
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

            <div className="mt-4 rounded-xl border border-edge bg-surface-base p-3 text-sm">
              {detailTab === 'health' ? (
                <div className="space-y-1 text-fg-muted">
                  <p>
                    {t.statusLabel}{' '}
                    <span className={health?.ok ? 'font-medium text-emerald-700 dark:text-emerald-300' : 'font-medium text-fg'}>
                      {healthStatusLabel(health?.status ?? instance.usage.lastHealthStatus, t)}
                    </span>
                  </p>
                  <p>
                    {t.lastCheckLabel}{' '}
                    {instance.usage.lastHealthCheckAt ? new Date(instance.usage.lastHealthCheckAt).toLocaleString() : t.never}
                  </p>
                  {health?.action ? <p>{health.action}</p> : null}
                </div>
              ) : null}
              {detailTab === 'tools' ? (
                health?.tools.length ? (
                  <div className="grid gap-3">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-xs text-fg-muted">
                        {formatConnectorMessage(t.toolsAvailable, { count: String(health.tools.length) })}
                      </p>
                      <Button type="button" variant="ghost" className="h-7 text-xs" onClick={() => setToolsDialogOpen(true)}>
                        {mcp.viewAllTools}
                      </Button>
                    </div>
                    <div className="grid gap-2">
                      {health.tools.slice(0, 8).map((tool) => (
                        <CapabilityListItem
                          key={tool.name}
                          title={tool.shortName ?? tool.name}
                          description={tool.description}
                        />
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-fg-muted">
                      {lastToolCount
                        ? formatConnectorMessage(t.toolsLastCheckSummary, { count: String(lastToolCount) })
                        : t.toolsRunTestHint}
                    </p>
                    <Button type="button" variant="secondary" disabled={testing} onClick={() => void runTest()}>
                      {testing ? <Loader2 className="size-4 animate-spin" /> : <PlugZap className="size-4" />}
                      {t.test}
                    </Button>
                  </div>
                )
              ) : null}
              {detailTab === 'resources' ? (
                health?.resources.length ? (
                  <div className="grid gap-2">
                    {health.resources.slice(0, 8).map((resource) => (
                      <CapabilityListItem
                        key={resource.uri}
                        title={resource.title ?? resource.name}
                        description={resource.uri}
                        meta={resource.mimeType}
                      />
                    ))}
                  </div>
                ) : <p className="text-fg-muted">{t.resourcesRunTestHint}</p>
              ) : null}
              {detailTab === 'prompts' ? (
                health?.prompts.length ? (
                  <div className="grid gap-2">
                    {health.prompts.slice(0, 8).map((prompt) => (
                      <CapabilityListItem
                        key={prompt.name}
                        title={prompt.title ?? prompt.name}
                        description={prompt.description}
                        meta={
                          prompt.argumentCount
                            ? formatConnectorMessage(t.promptArgumentCount, { count: String(prompt.argumentCount) })
                            : undefined
                        }
                      />
                    ))}
                  </div>
                ) : <p className="text-fg-muted">{t.promptsRunTestHint}</p>
              ) : null}
              {detailTab === 'permissions' ? (
                <div className="space-y-1 text-fg-muted">
                  <p>{formatConnectorMessage(t.secretsConfigured, { count: String(Object.values(instance.secretStatus).filter(Boolean).length) })}</p>
                  <p>
                    {instance.materialized.type === 'mcp'
                      ? formatConnectorMessage(t.runtimeServerLabel, {
                          runtime: instance.materialized.type.toUpperCase(),
                          serverId: instance.materialized.serverId,
                        })
                      : formatConnectorMessage(t.runtimeLabel, { runtime: instance.materialized.type.toUpperCase() })}
                  </p>
                  <p>{instance.materialized.type === 'mcp' ? t.mcpPolicyHint : t.connectorPolicyHint}</p>
                </div>
              ) : null}
              {detailTab === 'config' && supportsConfigEdit ? (
                <div className="grid gap-3">
                  {editableConfigFields.map((field) => (
                    <label key={field.key} className="flex flex-col gap-1.5">
                      <span className="text-sm font-medium text-fg">{field.label}</span>
                      {field.description ? <span className="text-xs text-fg-subtle">{field.description}</span> : null}
                      <input
                        className={inputClass}
                        value={configDraft[field.key] ?? ''}
                        placeholder={field.placeholder}
                        onChange={(event) => setConfigDraft((prev) => ({ ...prev, [field.key]: event.currentTarget.value }))}
                      />
                    </label>
                  ))}
                </div>
              ) : null}
            </div>

            {instance.materialized.type === 'composio' ? (
              <ComposioConnectorPanel instance={instance} t={t} onChanged={onChanged} />
            ) : null}
            {instance.materialized.type === 'memorySource' ? (
              <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-edge bg-surface-base p-3 text-sm">
                <div>
                  <p className="font-medium text-fg">{t.memorySourceSync}</p>
                  <p className="text-xs text-fg-muted">{definition?.description}</p>
                  {memorySyncCount !== null ? (
                    <p className="mt-1 text-xs text-emerald-600">
                      {formatConnectorMessage(t.memorySourceSynced, { count: String(memorySyncCount) })}
                    </p>
                  ) : null}
                </div>
                <Button disabled={syncingMemory} onClick={() => void syncMemory()}>
                  {syncingMemory ? <Loader2 className="size-4 animate-spin" /> : <Database className="size-4" />}
                  {t.composioSyncNow}
                </Button>
              </div>
            ) : null}
          </div>

          <div className="flex shrink-0 flex-wrap justify-end gap-2 border-t border-edge-subtle px-6 py-4">
            <Button variant="secondary" onClick={onClose}>{t.modalClose}</Button>
            {detailTab === 'config' && supportsConfigEdit ? (
              <Button variant="primary" disabled={savingConfig} onClick={() => void saveConfig()}>
                {savingConfig ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
                {t.modalSave}
              </Button>
            ) : null}
            {instance.materialized.type === 'mcp' ? (
              <Button variant="secondary" disabled={testing} onClick={() => void runTest()}>
                {testing ? <Loader2 className="size-4 animate-spin" /> : <PlugZap className="size-4" />}
                {t.test}
              </Button>
            ) : null}
            <Button variant="ghost" disabled={removing} onClick={() => void remove()}>
              {removing ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
              {t.remove}
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>

      {instance.materialized.type === 'mcp' ? (
        <McpToolsListDialog
          open={toolsDialogOpen}
          onOpenChange={setToolsDialogOpen}
          serverId={instance.materialized.serverId}
          title={formatConnectorMessage(t.installedToolsDialogTitle, { name: instance.displayName })}
          subtitle={t.installedToolsDialogSubtitle}
          searchPlaceholder={mcp.toolsDialogSearchPlaceholder}
          searchEmptyLabel={mcp.toolsDialogSearchEmpty}
          emptyLabel={t.toolsRunTestHint}
          closeLabel={mcp.toolsDialogClose}
          tools={health?.tools ?? []}
          stripPrefix={`${instance.materialized.serverId}__`}
        />
      ) : null}
    </Dialog.Root>
  );
}
