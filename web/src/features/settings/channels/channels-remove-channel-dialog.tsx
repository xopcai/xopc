import * as Dialog from '@radix-ui/react-dialog';

import { Button } from '@/components/ui/button';
import type { ChannelsSettingsMessages } from '@/i18n/messages';
import { cn } from '@/lib/cn';
import { SETTINGS_SHELL_CONTENT_Z, SETTINGS_SHELL_OVERLAY_Z } from '@/lib/settings-shell-dialog-layer';

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
  removeTarget: 'weixin' | 'telegram' | 'feishu' | 'dingtalk' | null;
  onCancel: () => void;
  saving: boolean;
  onConfirmRemove: () => void;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
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
          <Dialog.Title className="text-base font-semibold text-fg">{ch.removeChannelTitle}</Dialog.Title>
          <Dialog.Description className="mt-2 text-sm text-fg-muted">
            {removeTarget
              ? ch.removeChannelConfirm.replace(
                  '{{name}}',
                  removeTarget === 'weixin'
                    ? ch.weixinTitle
                    : removeTarget === 'telegram'
                      ? ch.telegramTitle
                      : removeTarget === 'feishu'
                        ? ch.feishuTitle
                        : ch.dingtalkTitle,
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
