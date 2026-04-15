import * as Dialog from '@radix-ui/react-dialog';
import { useTranslation } from 'react-i18next';

import { useLocaleStore } from '@/stores/locale-store';

import { describePermission } from './extension-permission-grants';

type ExtensionPermissionDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  extensionId: string;
  extensionName: string;
  permissions: string[];
  onConfirm: () => void;
};

export function ExtensionPermissionDialog({
  open,
  onOpenChange,
  extensionId,
  extensionName,
  permissions,
  onConfirm,
}: ExtensionPermissionDialogProps) {
  const { t } = useTranslation();
  const language = useLocaleStore((s) => s.language);

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="xopc-dialog-overlay fixed inset-0 z-[130] bg-scrim" />
        <Dialog.Content
          className="fixed left-1/2 top-1/2 z-[131] w-[min(28rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 rounded-xl border border-edge bg-surface-panel p-5 shadow-elevated"
          onOpenAutoFocus={(e) => e.preventDefault()}
        >
          <Dialog.Title className="text-base font-semibold text-fg">
            {t('extensionUi.permissionTitle', { name: extensionName })}
          </Dialog.Title>
          <p className="mt-2 text-sm text-fg-muted">
            {t('extensionUi.permissionSubtitle')}{' '}
            <span className="font-mono text-xs text-fg-muted" title={extensionId}>
              ({extensionId})
            </span>
          </p>
          {permissions.length === 0 ? (
            <p className="mt-4 text-sm text-fg-muted">{t('extensionUi.permissionsNone')}</p>
          ) : (
            <ul className="mt-4 max-h-48 list-inside list-disc space-y-1 overflow-y-auto text-sm text-fg">
              {permissions.map((p) => (
                <li key={p}>{describePermission(p, language)}</li>
              ))}
            </ul>
          )}
          <div className="mt-6 flex justify-end gap-2">
            <Dialog.Close asChild>
              <button
                type="button"
                className="rounded-lg border border-edge px-3 py-2 text-sm text-fg hover:bg-surface-muted"
              >
                {t('extensionUi.deny')}
              </button>
            </Dialog.Close>
            <button
              type="button"
              className="rounded-lg bg-accent px-3 py-2 text-sm font-medium text-white hover:opacity-90"
              onClick={() => {
                onConfirm();
                onOpenChange(false);
              }}
            >
              {t('extensionUi.allow')}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
