import * as Dialog from '@radix-ui/react-dialog';
import { useEffect, useState } from 'react';
import { LocalAppResourceScopesSchema, type LocalAppResourceScopes } from '@xopcai/gateway-contract';

import { messages } from '@/i18n/messages';
import { useLocaleStore } from '@/stores/locale-store';

import { describePermission } from './extension-permission-grants';
import { LocalAppResourceFields } from './local-app-resource-fields';

type ExtensionPermissionDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  extensionId: string;
  extensionName: string;
  permissions: string[];
  onConfirm: (scopes?: LocalAppResourceScopes) => void;
  confirmDisabled?: boolean;
  localApp?: boolean;
  resourceScopes?: LocalAppResourceScopes;
  error?: string | null;
};

export function ExtensionPermissionDialog({
  open,
  onOpenChange,
  extensionId,
  extensionName,
  permissions,
  onConfirm,
  confirmDisabled,
  localApp,
  resourceScopes,
  error,
}: ExtensionPermissionDialogProps) {
  const language = useLocaleStore((s) => s.language);
  const t = messages(language).extensionUi;
  const [scopes, setScopes] = useState(() => LocalAppResourceScopesSchema.parse(resourceScopes ?? {}));
  useEffect(() => setScopes(LocalAppResourceScopesSchema.parse(resourceScopes ?? {})), [resourceScopes, extensionId]);

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="xopc-dialog-overlay fixed inset-0 z-[130] bg-scrim" />
        <Dialog.Content
          className="xopc-dialog-content fixed left-1/2 top-1/2 z-[131] flex h-[min(720px,calc(100vh-32px))] w-[min(32rem,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-xl border border-edge bg-surface-overlay p-5"
          onOpenAutoFocus={(e) => e.preventDefault()}
        >
          <Dialog.Title className="text-base font-semibold text-fg">
            {t.permissionTitle.replace('{{name}}', extensionName)}
          </Dialog.Title>
          <p className="mt-2 text-sm text-fg-muted">
            {t.permissionSubtitle}{' '}
            <span className="font-mono text-xs text-fg-muted" title={extensionId}>
              ({extensionId})
            </span>
          </p>
          <div className="min-h-0 flex-1 overflow-y-auto">
          {permissions.length === 0 ? (
            <p className="mt-4 text-sm text-fg-muted">{t.permissionsNone}</p>
          ) : (
            <ul className="mt-4 max-h-48 list-inside list-disc space-y-1 overflow-y-auto text-sm text-fg">
              {permissions.map((p) => (
                <li key={p}>{describePermission(p, language)}</li>
              ))}
            </ul>
          )}
          {localApp ? <LocalAppResourceFields extensionId={extensionId} permissions={permissions} value={scopes} onChange={setScopes} zh={language === 'zh'} /> : null}
          </div>
          {error ? <p role="alert" className="mt-2 text-xs text-danger">{error}</p> : null}
          <div className="mt-6 flex justify-end gap-2">
            <Dialog.Close asChild>
              <button
                type="button"
                className="rounded-lg border border-edge px-3 py-2 text-sm text-fg hover:bg-surface-inset"
              >
                {t.deny}
              </button>
            </Dialog.Close>
            <button
              type="button"
              disabled={confirmDisabled}
              className="rounded-lg bg-accent px-3 py-2 text-sm font-medium text-on-accent hover:opacity-90"
              onClick={() => {
                onConfirm(localApp ? scopes : undefined);
              }}
            >
              {t.allow}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
