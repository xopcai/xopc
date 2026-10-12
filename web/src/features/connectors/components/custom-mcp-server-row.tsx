import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import type { messages } from '@/i18n/messages';
import type { McpServerRow } from '../mcp/mcp-config-api';
import { McpToolsDialog } from '../mcp/mcp-tools-dialog';
import { mcpServerEndpointSummary } from '../mcp/mcp-server-endpoint-summary';
export function CustomMcpServerRow({ row, t, cs, onEdit, onRemove }: { row: McpServerRow;
  t: ReturnType<typeof messages>['mcpSettings']; cs: ReturnType<typeof messages>['connectorsSettings'];
  onEdit: () => void; onRemove: () => Promise<void> }) {
  const [showTools, setShowTools] = useState(false);
  const [confirm, setConfirm] = useState(false); const [error, setError] = useState('');
  return <div className="px-4 py-3.5">
    <button className="block w-full text-left" onClick={onEdit}><h3 className="text-sm font-semibold">{row.id}</h3>
      <p className="mt-2 break-all font-mono text-xs text-fg-muted">{mcpServerEndpointSummary(row)}</p></button>
    <p className="mt-2 text-xs text-fg-muted">{t.setupEditHint}</p>
    {error ? <p className="text-sm text-danger">{error}</p> : null}
    <div className="mt-2 flex justify-end gap-2"><Button variant="secondary" onClick={() => setShowTools(true)}>{t.viewTools}</Button><Button variant="ghost" onClick={() => setConfirm(true)}>{t.removeServer}</Button></div>
    {showTools ? <McpToolsDialog serverId={row.id} t={t} onClose={() => setShowTools(false)} onConfigure={() => { setShowTools(false); onEdit(); }} /> : null}
    <ConfirmDialog open={confirm} title={cs.removeConfirmTitle.replace('{{name}}', row.id)} description={cs.removeConfirmDescription}
      confirmLabel={t.removeServer} cancelLabel={cs.modalCancel} destructive onCancel={() => setConfirm(false)}
      onConfirm={() => { setConfirm(false); void onRemove().catch(error => setError(String(error))); }} />
  </div>;
}
