import { CheckCircle2, Loader2, PlugZap, Trash2 } from 'lucide-react';
import { useCallback, useState } from 'react';

import { Button } from '@/components/ui/button';
import type { ConnectorsSettingsMessages } from '@/i18n/messages';

import { removeConnector, testConnector, type ConnectorDefinition, type ConnectorInstance } from '../connectors-api';
import { formatConnectorMessage } from '../utils/connector-i18n';

export function InstalledConnectorRow({
  instance,
  definition,
  onOpenDetails,
  onChanged,
  t,
}: {
  instance: ConnectorInstance;
  definition?: ConnectorDefinition;
  onOpenDetails: (instance: ConnectorInstance) => void;
  onChanged: () => Promise<void>;
  t: ConnectorsSettingsMessages;
}) {
  const [testing, setTesting] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const runTest = useCallback(async () => {
    setTesting(true);
    setError(null);
    try {
      await testConnector(instance.instanceId);
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

  const statusText = instance.usage.lastHealthStatus
    ? (t.healthStatusLabels[instance.usage.lastHealthStatus] ?? instance.usage.lastHealthStatus)
    : t.healthNotTested;
  const toolCount = instance.usage.lastToolCount ?? 0;
  const canEditConfig = Boolean(definition?.setup.config?.length && !definition.setup.secrets?.length && instance.materialized.type === 'mcp');

  return (
    <div
      className="flex h-full min-h-[10.5rem] cursor-pointer flex-col rounded-lg bg-surface-panel p-4 shadow-surface transition-colors hover:bg-surface-hover/45"
      onClick={() => onOpenDetails(instance)}
    >
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="truncate text-sm font-semibold text-fg">{instance.displayName}</h3>
          <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[11px] font-medium text-emerald-700 dark:text-emerald-300">
            <CheckCircle2 className="size-3" aria-hidden />
            {t.installedBadge}
          </span>
          {canEditConfig ? (
            <span className="rounded-full bg-surface-base px-2 py-0.5 text-[11px] text-fg-muted">
              {t.tabConfig}
            </span>
          ) : null}
        </div>
        <p className="mt-3 line-clamp-2 break-all text-sm leading-5 text-fg-muted">
          {instance.materialized.type === 'mcp'
            ? formatConnectorMessage(t.mcpServerRuntime, { serverId: instance.materialized.serverId })
            : formatConnectorMessage(t.runtimeLabel, { runtime: instance.materialized.type })}
        </p>
        <div className="mt-3 flex flex-wrap gap-2 text-xs text-fg-muted">
          <span className="rounded-md bg-surface-base px-2 py-1">
            {t.statusLabel} {statusText}
          </span>
          <span className="rounded-md bg-surface-base px-2 py-1">
            {formatConnectorMessage(t.toolsAvailable, { count: String(toolCount) })}
          </span>
        </div>
        {error ? <p className="mt-3 rounded-xl bg-red-500/10 px-3 py-2 text-sm text-red-600">{error}</p> : null}
      </div>
      <div className="mt-4 flex items-center justify-between gap-2 border-t border-edge pt-3" onClick={(event) => event.stopPropagation()}>
        <span className="text-xs text-fg-subtle">{t.connectorDetails}</span>
        <div className="flex shrink-0 gap-2">
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
      </div>
    </div>
  );
}
