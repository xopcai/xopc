import * as Dialog from '@radix-ui/react-dialog';
import { useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import type { McpSettingsMessages } from '@/i18n/messages';

import { fetchMcpDraftTools, fetchMcpTools, type McpToolInfo } from './mcp-config-api';

export function McpToolsDialog({ serverId, draftId, t, onClose, onConfigure }: {
  serverId: string; draftId?: string; t: McpSettingsMessages; onClose: () => void; onConfigure?: () => void;
}) {
  const [tools, setTools] = useState<McpToolInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    setLoading(true);
    setError('');
    setTools([]);
    void (draftId ? fetchMcpDraftTools(draftId, controller.signal) : fetchMcpTools(serverId, controller.signal)).then(result => {
      if (active) setTools(result);
    }).catch(error => {
      if (active) setError(error instanceof Error ? error.message : String(error));
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; controller.abort(); };
  }, [serverId, draftId, revision]);
  const needle = query.trim().toLowerCase();
  const visible = tools.filter(tool => `${tool.name} ${tool.description}`.toLowerCase().includes(needle));
  return <Dialog.Root open onOpenChange={open => { if (!open) onClose(); }}><Dialog.Portal>
    <Dialog.Overlay className="fixed inset-0 z-[60] bg-scrim" />
    <Dialog.Content className="fixed left-1/2 top-1/2 z-[60] flex h-[min(42rem,calc(100vh-2rem))] w-[min(48rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-2xl border border-edge bg-surface-overlay">
      <div className="shrink-0 border-b border-edge p-5">
        <Dialog.Title className="font-semibold">{t.toolsDialogTitle}</Dialog.Title>
        <Dialog.Description className="mt-1 text-sm text-fg-muted">{loading ? serverId : t.toolsDialogSubtitle.replace('{{serverId}}', serverId).replace('{{count}}', String(tools.length))}</Dialog.Description>
        <input className="mt-4 w-full rounded-lg border border-edge bg-surface-panel px-3 py-2 text-sm text-fg" value={query}
          onChange={event => setQuery(event.target.value)} placeholder={t.toolsDialogSearchPlaceholder} aria-label={t.toolsDialogSearchPlaceholder} />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-5" aria-busy={loading} aria-label={t.toolsTitle.replace('{{count}}', String(tools.length))}>
        {loading ? <div role="status" aria-label={t.toolsLoading} className="space-y-3">{[0, 1, 2].map(index => <Skeleton key={index} className="h-24 w-full" />)}</div>
          : error ? <div role="alert" className="space-y-3"><p className="whitespace-pre-wrap break-words text-sm text-danger">{error}</p><p className="text-sm text-fg-muted">{t.toolsAuthHint.replace('{{serverId}}', serverId)}</p>
            {onConfigure ? <Button variant="secondary" onClick={onConfigure}>{t.setupConfigure}</Button> : null}</div>
          : visible.length ? <div className="space-y-3">{visible.map(tool => <article key={tool.name} className="rounded-lg border border-edge p-4">
            <h3 className="break-all font-mono text-sm font-semibold text-fg">{tool.name}</h3>
            {tool.exposure ? <p className="mt-1 text-xs text-fg-muted">{tool.exposure}</p> : null}
            {tool.description ? <p className="mt-2 whitespace-pre-wrap break-words text-sm text-fg-muted">{tool.description}</p> : null}
            <details className="mt-3"><summary className="cursor-pointer text-sm text-accent-fg">{t.toolParameters}</summary>
              <pre className="mt-2 overflow-x-auto rounded-md bg-surface-panel p-3 text-xs text-fg">{JSON.stringify(tool.inputSchema, null, 2)}</pre>
            </details>
          </article>)}</div> : <p className="text-sm text-fg-muted">{tools.length ? t.toolsDialogSearchEmpty : t.toolsEmpty}</p>}
      </div>
      <div className="flex shrink-0 justify-end gap-2 border-t border-edge p-4">
        <Button variant="secondary" disabled={loading} onClick={() => setRevision(value => value + 1)}>{t.refreshTools}</Button>
        <Dialog.Close asChild><Button onClick={onClose}>{t.toolsDialogClose}</Button></Dialog.Close>
      </div>
    </Dialog.Content>
  </Dialog.Portal></Dialog.Root>;
}
