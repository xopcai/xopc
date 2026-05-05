import * as Dialog from '@radix-ui/react-dialog';

import { Button } from '@/components/ui/button';
import type { GatewayAgentRow } from '@/features/settings/agents-admin-api';
import type { AgentsSettingsMessages } from '@/i18n/messages';
import { cn } from '@/lib/cn';

export type AgentDeleteConfirmDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  busy: boolean;
  deletePurge: boolean;
  deleteTarget: GatewayAgentRow | null;
  deleteConfirmText: string;
  onDeleteConfirmTextChange: (value: string) => void;
  onConfirm: () => void;
  onCancel: () => void;
  a: Pick<
    AgentsSettingsMessages,
    | 'purgeDisk'
    | 'removeFromConfig'
    | 'confirmDeletePurge'
    | 'confirmDelete'
    | 'purgeConfirmLabel'
    | 'purgeConfirmPlaceholder'
    | 'purgeConfirmHint'
    | 'createModalCancel'
  >;
};

export function AgentDeleteConfirmDialog({
  open,
  onOpenChange,
  busy,
  deletePurge,
  deleteTarget,
  deleteConfirmText,
  onDeleteConfirmTextChange,
  onConfirm,
  onCancel,
  a,
}: AgentDeleteConfirmDialogProps) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[80] bg-scrim backdrop-blur-[2px]" />
        <Dialog.Content
          className={cn(
            'fixed left-1/2 top-1/2 z-[81] w-[min(100%-2rem,28rem)] -translate-x-1/2 -translate-y-1/2 rounded-xl border border-edge bg-surface-panel p-4 shadow-popover',
            'dark:border-edge',
          )}
          onOpenAutoFocus={(e) => e.preventDefault()}
        >
          <Dialog.Title className="text-base font-semibold text-fg">
            {deletePurge ? a.purgeDisk : a.removeFromConfig}
          </Dialog.Title>
          <Dialog.Description className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-fg-muted">
            {deletePurge ? a.confirmDeletePurge : a.confirmDelete}
          </Dialog.Description>

          {deletePurge && deleteTarget ? (
            <div className="mt-3 space-y-3">
              <label className="mb-2 block text-sm font-medium text-fg" htmlFor="agent-delete-confirm">
                {a.purgeConfirmLabel}
              </label>
              <input
                id="agent-delete-confirm"
                type="text"
                autoComplete="off"
                spellCheck={false}
                className={cn(
                  'w-full rounded-md border border-edge bg-surface-panel px-3 py-1.5 font-mono text-xs text-fg',
                  'placeholder:text-fg-subtle',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface-panel',
                  'dark:border-edge',
                )}
                placeholder={a.purgeConfirmPlaceholder.replace('{{agentId}}', deleteTarget.id)}
                value={deleteConfirmText}
                onChange={(e) => onDeleteConfirmTextChange(e.target.value)}
              />
              <p className="pt-0.5 text-xs text-fg-muted">
                {a.purgeConfirmHint.replace('{{agentId}}', deleteTarget.id)}
              </p>
            </div>
          ) : null}

          <div className="mt-4 flex flex-wrap items-center justify-end gap-2 border-t border-edge-subtle/60 pt-3">
            <Button type="button" variant="ghost" disabled={busy} onClick={onCancel}>
              {a.createModalCancel}
            </Button>
            <Button
              type="button"
              variant="secondary"
              className={
                deletePurge
                  ? 'border-red-200 text-red-700 hover:bg-red-50 dark:border-red-900/60 dark:text-red-300 dark:hover:bg-red-950/40'
                  : undefined
              }
              disabled={
                busy ||
                !deleteTarget ||
                (deletePurge && deleteConfirmText.trim().toLowerCase() !== deleteTarget.id.toLowerCase())
              }
              onClick={onConfirm}
            >
              {deletePurge ? a.purgeDisk : a.removeFromConfig}
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
