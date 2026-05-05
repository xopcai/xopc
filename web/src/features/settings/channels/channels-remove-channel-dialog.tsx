import * as Dialog from '@radix-ui/react-dialog';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/cn';
import type { ChannelsSettingsMessages } from '@/i18n/messages';

export function ChannelsRemoveChannelDialog({
  open,
  onOpenChange,
  ch,
  removeTarget,
  onCancel,
  saving,
  onConfirmRemove,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  ch: ChannelsSettingsMessages;
  removeTarget: 'weixin' | 'telegram' | 'feishu' | null;
  onCancel: () => void;
  saving: boolean;
  onConfirmRemove: () => void;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="xopc-dialog-overlay fixed inset-0 z-[70] bg-scrim backdrop-blur-[1px]" />
        <Dialog.Content
          className={cn(
            'fixed left-1/2 top-1/2 z-[70] w-[min(100%-2rem,28rem)] -translate-x-1/2 -translate-y-1/2',
            'rounded-2xl border border-edge bg-surface-panel p-6 shadow-popover outline-none dark:border-edge',
          )}
          onOpenAutoFocus={(e) => e.preventDefault()}
        >
          <Dialog.Title className="text-base font-semibold text-fg">{ch.removeChannelTitle}</Dialog.Title>
          <Dialog.Description className="mt-2 text-sm text-fg-muted">
            {removeTarget
              ? ch.removeChannelConfirm.replace(
                  '{{name}}',
                  removeTarget === 'weixin'
                    ? ch.weixinTitle
                    : removeTarget === 'telegram'
                      ? ch.telegramTitle
                      : ch.feishuTitle,
                )
              : '\u00a0'}
          </Dialog.Description>
          <div className="mt-6 flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={onCancel}>
              {ch.modalCancel}
            </Button>
            <Button
              type="button"
              variant="secondary"
              className="border-danger/40 bg-danger text-white hover:bg-danger/90 dark:border-danger/40"
              disabled={saving}
              onClick={onConfirmRemove}
            >
              {saving ? ch.saving : ch.removeChannelAction}
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
