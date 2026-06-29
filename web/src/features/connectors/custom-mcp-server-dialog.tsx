import * as Dialog from '@radix-ui/react-dialog';
import { CheckCircle2, Loader2, PlugZap, Wrench, X } from 'lucide-react';
import { useCallback, useState } from 'react';

import { Button } from '@/components/ui/button';
import {
  buildMcpServerConfigFromRow,
  extractManagedMcpServers,
  patchMcpSettings,
  testMcpServer,
  type McpServerRow,
  type McpSettingsState,
  type McpToolInfo,
} from '@/features/connectors/mcp/mcp-config-api';
import { McpServerFormFields } from '@/features/connectors/mcp/mcp-server-form-fields';
import { McpToolsListDialog } from '@/features/connectors/mcp/mcp-tools-list-dialog';
import type { ConnectorsSettingsMessages, McpSettingsMessages } from '@/i18n/messages';
import { cn } from '@/lib/cn';
import { interaction } from '@/lib/interaction';

type Props = {
  open: boolean;
  mode: 'add' | 'edit';
  initialRow: McpServerRow;
  existingCustomServers: McpServerRow[];
  sessionIdleTtlMinutes: number | undefined;
  config: unknown;
  managedServerIds: ReadonlySet<string>;
  t: McpSettingsMessages;
  cs: ConnectorsSettingsMessages;
  onClose: () => void;
  onSaved: () => Promise<void>;
};

type ToolState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ok'; tools: McpToolInfo[] }
  | { status: 'error'; message: string };

export function CustomMcpServerDialog({
  open,
  mode,
  initialRow,
  existingCustomServers,
  sessionIdleTtlMinutes,
  config,
  managedServerIds,
  t,
  cs,
  onClose,
  onSaved,
}: Props) {
  const [row, setRow] = useState<McpServerRow>(initialRow);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toolState, setToolState] = useState<ToolState>({ status: 'idle' });
  const [toolsDialog, setToolsDialog] = useState<McpToolInfo[] | null>(null);

  const originalId = initialRow.id.trim();
  const reservedId =
    row.id.trim() !== originalId && managedServerIds.has(row.id.trim())
      ? t.reservedServerId
      : managedServerIds.has(row.id.trim()) && mode === 'add'
        ? t.reservedServerId
        : undefined;

  const duplicateId =
    row.id.trim() &&
    existingCustomServers.some(
      (server) => server.clientKey !== initialRow.clientKey && server.id.trim() === row.id.trim(),
    )
      ? cs.duplicateServerId
      : undefined;

  const canSave =
    row.id.trim().length > 0 &&
    !reservedId &&
    !duplicateId &&
    (row.transport === 'stdio' ? row.command.trim().length > 0 : row.url.trim().length > 0);

  const runTest = useCallback(async () => {
    if (!row.id.trim()) return;
    setTesting(true);
    setError(null);
    setToolState({ status: 'loading' });
    try {
      const result = await testMcpServer(row.id.trim(), buildMcpServerConfigFromRow(row));
      setToolState({ status: 'ok', tools: result.tools });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setToolState({ status: 'error', message });
    } finally {
      setTesting(false);
    }
  }, [row]);

  const save = useCallback(async () => {
    if (!canSave || saving) return;
    setSaving(true);
    setError(null);
    try {
      const nextServers = existingCustomServers.filter((server) => {
        if (mode === 'edit' && server.clientKey === initialRow.clientKey) return false;
        return true;
      });
      nextServers.push(row);
      const state: McpSettingsState = {
        sessionIdleTtlMinutes,
        servers: nextServers.sort((a, b) => a.id.localeCompare(b.id)),
      };
      await patchMcpSettings(state, extractManagedMcpServers(config));
      await onSaved();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }, [
    canSave,
    config,
    existingCustomServers,
    initialRow.clientKey,
    mode,
    onClose,
    onSaved,
    originalId,
    row,
    saving,
    sessionIdleTtlMinutes,
  ]);

  if (!open) return null;

  return (
    <>
      <Dialog.Root open={open} onOpenChange={(next) => { if (!next) onClose(); }}>
        <Dialog.Portal>
          <Dialog.Overlay className="xopc-dialog-overlay fixed inset-0 z-[60] bg-scrim" />
          <Dialog.Content
            className={cn(
              'xopc-dialog-content fixed left-1/2 top-1/2 z-[60] flex h-[min(100vh-2rem,44rem)] w-[min(100%-2rem,min(92vw,48rem))] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden',
              'rounded-2xl border border-edge bg-surface-panel shadow-float dark:border-edge',
            )}
          >
            <div className="flex shrink-0 items-start justify-between gap-3 border-b border-edge-subtle px-6 py-5">
              <div className="min-w-0">
                <Dialog.Title className="text-base font-semibold text-fg">
                  {mode === 'add' ? cs.addCustomServerTitle : cs.editCustomServerTitle}
                </Dialog.Title>
                <Dialog.Description className="mt-1 text-sm text-fg-muted">
                  {mode === 'add' ? cs.addCustomServerHint : cs.editCustomServerHint}
                </Dialog.Description>
              </div>
              <Dialog.Close asChild>
                <button
                  type="button"
                  className={cn(
                    'rounded-lg p-1.5 text-fg-muted hover:bg-surface-hover hover:text-fg',
                    interaction.focusRingPanel,
                  )}
                  aria-label={cs.modalClose}
                >
                  <X className="size-5" strokeWidth={1.75} aria-hidden />
                  <span className="sr-only">{cs.modalClose}</span>
                </button>
              </Dialog.Close>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
              <div className="flex flex-col gap-4">
                <McpServerFormFields
                  row={row}
                  t={t}
                  onUpdate={(patch) => {
                    setRow((prev) => ({ ...prev, ...patch }));
                    setError(null);
                  }}
                  idConflictMessage={reservedId ?? duplicateId}
                />

                {toolState.status === 'ok' ? (
                  <div className="rounded-xl border border-edge bg-surface-base px-3 py-2.5">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2 text-sm font-medium text-fg">
                        <Wrench className="size-4 text-accent" aria-hidden />
                        {toolState.tools.length === 0
                          ? t.toolsEmpty
                          : t.toolsTitle.replace('{{count}}', String(toolState.tools.length))}
                      </div>
                      {toolState.tools.length > 0 ? (
                        <Button type="button" variant="ghost" className="h-8 text-xs" onClick={() => setToolsDialog(toolState.tools)}>
                          {t.viewAllTools}
                        </Button>
                      ) : null}
                    </div>
                  </div>
                ) : null}

                {toolState.status === 'error' ? (
                  <p className="rounded-xl bg-red-500/10 px-3 py-2 text-sm text-red-600">{toolState.message}</p>
                ) : null}

                {error ? <p className="rounded-xl bg-red-500/10 px-3 py-2 text-sm text-red-600">{error}</p> : null}
              </div>
            </div>

            <div className="flex shrink-0 flex-wrap justify-end gap-2 border-t border-edge-subtle px-6 py-4">
              <Button variant="secondary" disabled={!row.id.trim() || testing} onClick={() => void runTest()}>
                {testing ? <Loader2 className="size-4 animate-spin" /> : <PlugZap className="size-4" />}
                {t.testConnection}
              </Button>
              <Dialog.Close asChild>
                <Button variant="secondary">{cs.modalCancel}</Button>
              </Dialog.Close>
              <Button variant="primary" disabled={!canSave || saving} onClick={() => void save()}>
                {saving ? <Loader2 className="size-4 animate-spin" /> : <CheckCircle2 className="size-4" />}
                {saving ? t.saving : cs.modalSave}
              </Button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      {toolsDialog ? (
        <McpToolsListDialog
          open
          onOpenChange={(next) => {
            if (!next) setToolsDialog(null);
          }}
          serverId={row.id}
          title={t.toolsDialogTitle}
          subtitle={t.toolsDialogSubtitle}
          searchPlaceholder={t.toolsDialogSearchPlaceholder}
          searchEmptyLabel={t.toolsDialogSearchEmpty}
          emptyLabel={t.toolsEmpty}
          closeLabel={t.toolsDialogClose}
          tools={toolsDialog}
          stripPrefix={`${row.id.trim()}__`}
        />
      ) : null}
    </>
  );
}
