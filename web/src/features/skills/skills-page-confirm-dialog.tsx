import * as Dialog from '@radix-ui/react-dialog';

import { Button } from '@/components/ui/button';
import { interpolate } from '@/features/skills/skills-page.utils';
import type { SkillsPageVm } from '@/features/skills/use-skills-page';

type Props = Pick<
  SkillsPageVm,
  'sk' | 'confirmOpen' | 'setConfirmOpen' | 'confirmId' | 'setConfirmId' | 'runDelete'
>;

export function SkillsPageConfirmDialog({
  sk,
  confirmOpen,
  setConfirmOpen,
  confirmId,
  setConfirmId,
  runDelete,
}: Props) {
  return (
    <Dialog.Root
      open={confirmOpen}
      onOpenChange={(open) => {
        setConfirmOpen(open);
        if (!open) setConfirmId(null);
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="xopc-dialog-overlay fixed inset-0 z-[60] bg-scrim" />
        <Dialog.Content className="xopc-dialog-content fixed left-1/2 top-1/2 z-[60] w-[min(100%-2rem,24rem)] -translate-x-1/2 -translate-y-1/2 rounded-xl border border-edge bg-surface-panel p-4 shadow-popover dark:border-edge">
          <Dialog.Title className="text-base font-semibold text-fg">{sk.deleteTitle}</Dialog.Title>
          <p className="mt-2 text-sm text-fg-muted">
            {confirmId ? interpolate(sk.deleteMessage, { id: confirmId }) : ''}
          </p>
          <div className="mt-4 flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setConfirmOpen(false)}>
              {sk.cancel}
            </Button>
            <Button
              type="button"
              variant="primary"
              className="bg-red-600 hover:bg-red-700"
              onClick={() => void runDelete()}
            >
              {sk.deleteConfirm}
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
