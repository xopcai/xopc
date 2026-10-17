import { useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import type { messages } from '@/i18n/messages';
import type { McpServerRow, McpLastCheck } from '../mcp/mcp-config-api';
import { McpToolsDialog } from '../mcp/mcp-tools-dialog';
import { mcpServerEndpointSummary } from '../mcp/mcp-server-endpoint-summary';
export function CustomMcpServerRow({ row, lastCheck, t, cs, onEdit, onRemove }: { row: McpServerRow; lastCheck?: McpLastCheck;
  t: ReturnType<typeof messages>['mcpSettings']; cs: ReturnType<typeof messages>['connectorsSettings'];
  onEdit: () => void; onRemove: () => Promise<void> }) {
  const [showTools, setShowTools] = useState(false);
  const toolsTrigger = useRef<HTMLButtonElement>(null);
  const [confirm, setConfirm] = useState(false); const [error, setError] = useState('');
  return <div className="px-4 py-3.5">
    <button className="block w-full text-left" onClick={onEdit}><h3 className="text-sm font-semibold">{row.displayName || row.id}</h3>
      <p className="mt-2 break-all font-mono text-xs text-fg-muted">{mcpServerEndpointSummary(row)}</p></button>
    <p className="mt-2 text-xs text-fg-muted">{row.extra.enabled === false ? t.setupDisabled : lastCheck ? t.setupLastCheck.replace('{{count}}', String(lastCheck.toolCount)) : t.setupUnverified}</p>
    {lastCheck ? <p className="mt-1 text-xs text-fg-muted"><time dateTime={lastCheck.checkedAt}>{new Intl.DateTimeFormat(undefined, { dateStyle: 'short', timeStyle: 'short' }).format(new Date(lastCheck.checkedAt))}</time></p> : null}
    {error ? <p role="alert" className="text-sm text-danger">{error}</p> : null}
    <div className="mt-3 flex flex-wrap justify-end gap-2"><Button variant="ghost" onClick={onEdit}>{t.setupConfigure}</Button><Button ref={toolsTrigger} variant="secondary" disabled={row.extra.enabled === false} onClick={() => setShowTools(true)}>{t.viewTools}</Button><Button variant="ghost" onClick={() => setConfirm(true)}>{t.removeServer}</Button></div>
    {showTools ? <McpToolsDialog serverId={row.id} displayName={row.displayName} returnFocusTo={toolsTrigger.current} t={t} onClose={() => setShowTools(false)} onConfigure={() => { setShowTools(false); onEdit(); }} /> : null}
    <ConfirmDialog open={confirm} title={cs.removeConfirmTitle.replace('{{name}}', row.displayName || row.id)} description={cs.removeConfirmDescription}
      confirmLabel={t.removeServer} cancelLabel={cs.modalCancel} destructive onCancel={() => setConfirm(false)}
      onConfirm={() => { setConfirm(false); setError(''); void onRemove().catch(() => setError(t.setupRemoveFailed)); }} />
  </div>;
}
