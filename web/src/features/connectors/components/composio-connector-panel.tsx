import { KeyRound, Loader2 } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/cn';
import { settingsInputFocusClass } from '@/lib/form-field-width';

import {
  getComposioScope,
  listComposioConnections,
  listComposioTools,
  listComposioTriggerEvents,
  setComposioScope,
  startComposioAuthorize,
  type ComposioConnection,
  type ComposioScope,
  type ComposioTool,
  type ComposioTriggerEvent,
  type ConnectorInstance,
} from '../connectors-api';

const inputClass = cn(
  'w-full rounded-lg border border-edge bg-surface-panel px-3 py-2 text-sm text-fg',
  'placeholder:text-fg-subtle',
  settingsInputFocusClass,
);

function toolkitFromComposioInstance(instance: ConnectorInstance): string | null {
  if (instance.materialized.type !== 'composio') return null;
  return instance.connectorId.replace(/^composio-/, '');
}

export function ComposioConnectorPanel({ instance }: { instance: ConnectorInstance }) {
  const toolkit = toolkitFromComposioInstance(instance);
  const [connections, setConnections] = useState<ComposioConnection[]>([]);
  const [tools, setTools] = useState<ComposioTool[]>([]);
  const [events, setEvents] = useState<ComposioTriggerEvent[]>([]);
  const [scope, setScope] = useState<ComposioScope>('read');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadComposio = useCallback(async () => {
    if (!toolkit || toolkit === 'api-key') return;
    setLoading(true);
    setError(null);
    try {
      const [nextConnections, nextTools, nextEvents, nextScope] = await Promise.all([
        listComposioConnections().catch(() => []),
        listComposioTools(toolkit).catch(() => []),
        listComposioTriggerEvents(20).catch(() => []),
        getComposioScope(toolkit).catch((): ComposioScope => 'read'),
      ]);
      setConnections(nextConnections.filter((connection) => connection.toolkit.toLowerCase() === toolkit.toLowerCase()));
      setTools(nextTools);
      setEvents(nextEvents.filter((event) => !event.toolkit || event.toolkit.toLowerCase() === toolkit.toLowerCase()));
      setScope(nextScope);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError));
    } finally {
      setLoading(false);
    }
  }, [toolkit]);

  useEffect(() => {
    void loadComposio();
  }, [loadComposio]);

  const authorize = useCallback(async () => {
    if (!toolkit) return;
    setLoading(true);
    setError(null);
    try {
      const result = await startComposioAuthorize(toolkit);
      window.open(result.connectUrl, '_blank', 'noopener,noreferrer');
    } catch (authorizeError) {
      setError(authorizeError instanceof Error ? authorizeError.message : String(authorizeError));
    } finally {
      setLoading(false);
    }
  }, [toolkit]);

  const updateScope = useCallback(async (nextScope: ComposioScope) => {
    if (!toolkit) return;
    setScope(nextScope);
    try {
      await setComposioScope(toolkit, nextScope);
      await loadComposio();
    } catch (scopeError) {
      setError(scopeError instanceof Error ? scopeError.message : String(scopeError));
    }
  }, [loadComposio, toolkit]);

  if (!toolkit) return null;
  if (toolkit === 'api-key') {
    return <p className="mt-3 text-sm text-fg-muted">Composio API key stored. Install a toolkit connector to manage OAuth connections and tools.</p>;
  }

  return (
    <div className="mt-4 rounded-xl border border-edge bg-surface-base p-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="font-medium text-fg">Composio toolkit: {toolkit}</p>
          <p className="text-xs text-fg-subtle">Curated actions are filtered by read/write/admin scope before they reach the agent.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <select
            className={cn(inputClass, 'h-9 w-28 py-1')}
            value={scope}
            onChange={(event) => void updateScope(event.currentTarget.value as ComposioScope)}
          >
            <option value="read">Read</option>
            <option value="write">Write</option>
            <option value="admin">Admin</option>
          </select>
          <Button variant="secondary" disabled={loading} onClick={() => void authorize()}>
            {loading ? <Loader2 className="size-4 animate-spin" /> : <KeyRound className="size-4" />}
            Connect OAuth
          </Button>
          <Button variant="ghost" disabled={loading} onClick={() => void loadComposio()}>
            Refresh
          </Button>
        </div>
      </div>
      {error ? <p className="mt-3 rounded-xl bg-red-500/10 px-3 py-2 text-sm text-red-600">{error}</p> : null}
      <div className="mt-4 grid gap-3 lg:grid-cols-3">
        <div>
          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-fg-subtle">Connections</p>
          {connections.length ? connections.map((connection) => (
            <div key={connection.id} className="rounded-lg border border-edge bg-surface-panel p-2">
              <p className="truncate font-mono text-xs text-fg">{connection.accountEmail ?? connection.username ?? connection.workspace ?? connection.id}</p>
              <p className="text-xs text-fg-subtle">{connection.status}</p>
            </div>
          )) : <p className="text-xs text-fg-muted">No active connection loaded.</p>}
        </div>
        <div>
          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-fg-subtle">Agent tools</p>
          {tools.length ? tools.slice(0, 8).map((tool) => (
            <div key={tool.slug} className="rounded-lg border border-edge bg-surface-panel p-2">
              <p className="truncate font-mono text-xs text-fg">{tool.slug}</p>
              <p className="text-xs text-fg-subtle">{tool.scope}{tool.curated ? '' : ' · uncurated'}</p>
            </div>
          )) : <p className="text-xs text-fg-muted">No actions available at this scope.</p>}
        </div>
        <div>
          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-fg-subtle">Recent triggers</p>
          {events.length ? events.slice(0, 5).map((event) => (
            <div key={`${event.id}-${event.at}`} className="rounded-lg border border-edge bg-surface-panel p-2">
              <p className="truncate text-xs text-fg">{event.trigger ?? event.id}</p>
              <p className="text-xs text-fg-subtle">{new Date(event.at).toLocaleString()}</p>
            </div>
          )) : <p className="text-xs text-fg-muted">No trigger events archived yet.</p>}
        </div>
      </div>
    </div>
  );
}

