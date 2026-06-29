import { Database, FileText, KeyRound, Loader2, PlugZap, ShieldCheck, Trash2, Wrench } from 'lucide-react';
import { useCallback, useState } from 'react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/cn';

import {
  removeConnector,
  testConnector,
  type ConnectorHealthResult,
  type ConnectorInstance,
} from '../connectors-api';
import { McpToolsListDialog } from '../mcp/mcp-tools-list-dialog';
import { ComposioConnectorPanel } from './composio-connector-panel';

type ConnectorDetailTab = 'health' | 'tools' | 'resources' | 'prompts' | 'permissions';

export function InstalledConnectorRow({ instance, onChanged }: { instance: ConnectorInstance; onChanged: () => Promise<void> }) {
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
          <p className="mt-1 text-sm text-fg-muted">
            {instance.materialized.type === 'mcp' ? `MCP server: ${instance.materialized.serverId}` : `Runtime: ${instance.materialized.type}`}
          </p>
        </div>
        <div className="flex gap-2">
          {instance.materialized.type === 'mcp' ? (
            <Button variant="secondary" disabled={testing} onClick={() => void runTest()}>
              {testing ? <Loader2 className="size-4 animate-spin" /> : <PlugZap className="size-4" />}
              Test
            </Button>
          ) : null}
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
            <p>Runtime: {instance.materialized.type.toUpperCase()}{instance.materialized.type === 'mcp' ? ` server \`${instance.materialized.serverId}\`` : ''}</p>
            <p>{instance.materialized.type === 'mcp' ? 'Tool calls run through MCP and follow the agent tool policy/approval gates.' : 'Tool calls follow connector scope and curated allowlist gates.'}</p>
          </div>
        ) : null}
      </div>
      {instance.materialized.type === 'composio' ? <ComposioConnectorPanel instance={instance} /> : null}
    </div>
    {instance.materialized.type === 'mcp' ? <McpToolsListDialog
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
    /> : null}
    </>
  );
}

