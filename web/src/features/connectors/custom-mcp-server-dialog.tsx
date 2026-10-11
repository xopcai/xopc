import * as Dialog from '@radix-ui/react-dialog';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { extractManagedMcpServers, patchMcpSettings, type McpServerRow } from './mcp/mcp-config-api';
import { McpServerFormFields } from './mcp/mcp-server-form-fields';
import type { ConnectorsSettingsMessages, McpSettingsMessages } from '@/i18n/messages';

export function CustomMcpServerDialog(props: { open: boolean; mode: 'add' | 'edit'; initialRow: McpServerRow;
  existingCustomServers: McpServerRow[]; config: unknown; managedServerIds: ReadonlySet<string>;
  t: McpSettingsMessages; cs: ConnectorsSettingsMessages; onClose: () => void; onSaved: () => Promise<void> }) {
  const [row, setRow] = useState(props.initialRow);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  async function save() {
    setSaving(true); setError('');
    try {
      if (props.managedServerIds.has(row.id)) throw new Error(props.cs.duplicateServerId);
      const others = props.existingCustomServers.filter(item => item.clientKey !== props.initialRow.clientKey);
      if (others.some(item => item.id.replace(/-/g, '_') === row.id.trim().replace(/-/g, '_'))) throw new Error(props.cs.duplicateServerId);
      await patchMcpSettings({ servers: [...others, row] }, extractManagedMcpServers(props.config));
      await props.onSaved(); props.onClose();
    } catch (error) { setError(error instanceof Error ? error.message : String(error)); }
    finally { setSaving(false); }
  }
  return <Dialog.Root open={props.open} onOpenChange={open => { if (!open) props.onClose(); }}><Dialog.Portal>
    <Dialog.Overlay className="fixed inset-0 z-[60] bg-scrim" />
    <Dialog.Content className="fixed left-1/2 top-1/2 z-[60] flex h-[min(42rem,calc(100vh-2rem))] w-[min(48rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-2xl border border-edge bg-surface-overlay">
      <div className="shrink-0 border-b border-edge p-5"><Dialog.Title className="font-semibold">MCP</Dialog.Title>
        <Dialog.Description className="mt-1 text-sm text-fg-muted">{props.t.transportLabels[row.transport]}</Dialog.Description></div>
      <div className="min-h-0 flex-1 overflow-y-auto p-5"><McpServerFormFields row={row} t={props.t} onUpdate={patch => setRow({ ...row, ...patch })} />
        {error ? <p className="mt-4 text-sm text-danger">{error}</p> : null}</div>
      <div className="flex shrink-0 justify-end gap-2 border-t border-edge p-4"><Button variant="secondary" disabled={saving} onClick={props.onClose}>{props.cs.modalCancel}</Button>
        <Button disabled={saving} onClick={() => void save()}>{props.t.save}</Button></div>
    </Dialog.Content>
  </Dialog.Portal></Dialog.Root>;
}
