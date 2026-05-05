import * as Dialog from '@radix-ui/react-dialog';

import { Button } from '@/components/ui/button';
import type { MessageBundle } from '@/i18n/messages';

type CronCopy = MessageBundle['cron'];

export type CronConfirmActionDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  action: 'delete' | 'run' | null;
  c: CronCopy;
  onDismiss: () => void;
  onConfirm: () => void;
};

export function CronConfirmActionDialog({
  open,
  onOpenChange,
  action,
  c,
  onDismiss,
  onConfirm,
}: CronConfirmActionDialogProps) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="xopc-dialog-overlay fixed inset-0 z-[70] bg-scrim" />
        <div className="fixed inset-0 z-[70] flex items-center justify-center p-4 pointer-events-none">
          <Dialog.Content className="xopc-dialog-content-pane pointer-events-auto relative w-full max-w-md rounded-xl border border-edge bg-surface-panel p-4 shadow-popover dark:border-edge">
            <Dialog.Title className="text-base font-semibold text-fg">
              {action === 'delete' ? c.delete : c.runNow}
            </Dialog.Title>
            <p className="mt-2 text-sm text-fg-muted">
              {action === 'delete' ? c.confirmDelete : c.confirmRun}
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={onDismiss}>
                {c.cancel}
              </Button>
              <Button
                type="button"
                variant="primary"
                className={action === 'delete' ? 'bg-red-600 hover:bg-red-700' : undefined}
                onClick={() => void onConfirm()}
              >
                {action === 'delete' ? c.delete : c.runNow}
              </Button>
            </div>
          </Dialog.Content>
        </div>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
