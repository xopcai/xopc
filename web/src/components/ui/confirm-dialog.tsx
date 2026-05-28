import * as Dialog from '@radix-ui/react-dialog';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/cn';
import { SETTINGS_SHELL_CONTENT_Z, SETTINGS_SHELL_OVERLAY_Z } from '@/lib/settings-shell-dialog-layer';

export type ConfirmDialogProps = {
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  cancelLabel: string;
  /** Red/destructive styling for the confirm action (e.g. remove/delete). */
  destructive?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
};

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  cancelLabel,
  destructive,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => {
        if (!next) onCancel();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay
          className={cn(
            'xopc-dialog-overlay fixed inset-0 bg-scrim backdrop-blur-[1px]',
            SETTINGS_SHELL_OVERLAY_Z,
          )}
        />
        <Dialog.Content
          className={cn(
            'fixed left-1/2 top-1/2 w-[min(100%-2rem,28rem)] -translate-x-1/2 -translate-y-1/2',
            SETTINGS_SHELL_CONTENT_Z,
            'rounded-2xl border border-edge bg-surface-panel p-6 shadow-popover outline-none dark:border-edge',
          )}
          onOpenAutoFocus={(e) => e.preventDefault()}
        >
          <Dialog.Title className="text-base font-semibold text-fg">{title}</Dialog.Title>
          <Dialog.Description className="mt-2 max-h-[min(50vh,16rem)] overflow-y-auto text-sm text-fg-muted whitespace-pre-wrap break-all">
            {description}
          </Dialog.Description>
          <div className="mt-6 flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={onCancel}>
              {cancelLabel}
            </Button>
            <Button
              type="button"
              variant="secondary"
              className={cn(
                destructive &&
                  'border-danger/40 bg-danger text-white hover:bg-danger/90 dark:border-danger/40',
              )}
              onClick={onConfirm}
            >
              {confirmLabel}
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
