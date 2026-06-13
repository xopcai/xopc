import * as Dialog from '@radix-ui/react-dialog';
import { useRef } from 'react';

import { GatewayTokenForm } from '@/components/shell/gateway-token-form';
import { Button } from '@/components/ui/button';
import { messages } from '@/i18n/messages';
import { cn } from '@/lib/cn';
import { SETTINGS_SHELL_CONTENT_Z, SETTINGS_SHELL_OVERLAY_Z } from '@/lib/settings-shell-dialog-layer';
import { useGatewayStore } from '@/stores/gateway-store';
import { useLocaleStore } from '@/stores/locale-store';

export function TokenDialog() {
  const tokenInputRef = useRef<HTMLInputElement>(null);
  const open = useGatewayStore((s) => s.tokenDialogOpen);
  const baseUrl = useGatewayStore((s) => s.baseUrl);
  const tokenExpired = useGatewayStore((s) => s.tokenExpired);
  const setGatewayToken = useGatewayStore((s) => s.setGatewayToken);
  const closeTokenDialog = useGatewayStore((s) => s.closeTokenDialog);
  const storedToken = useGatewayStore((s) => s.token);

  const language = useLocaleStore((s) => s.language);
  const t = messages(language).token;

  const canDismiss = Boolean(storedToken) && !tokenExpired;

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => {
        if (!next && !canDismiss) return;
        if (!next) closeTokenDialog();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay
          className={cn('fixed inset-0 bg-scrim backdrop-blur-[2px]', SETTINGS_SHELL_OVERLAY_Z)}
        />
        <Dialog.Content
          className={cn(
            'fixed left-1/2 top-1/2 w-[min(100%-2rem,28rem)] -translate-x-1/2 -translate-y-1/2 rounded-xl border border-edge bg-surface-panel p-4 shadow-popover',
            SETTINGS_SHELL_CONTENT_Z,
            'dark:border-edge',
          )}
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            tokenInputRef.current?.focus();
          }}
        >
          <Dialog.Title className="text-base font-semibold text-fg">{t.title}</Dialog.Title>
          <Dialog.Description className="mt-1 text-sm text-fg-muted">{t.description}</Dialog.Description>

          <GatewayTokenForm
            className="mt-4"
            baseUrl={baseUrl}
            tokenInputRef={tokenInputRef}
            onSubmit={setGatewayToken}
            footerLeft={
              canDismiss ? (
                <Button type="button" variant="ghost" onClick={() => closeTokenDialog()}>
                  {language === 'zh' ? '取消' : 'Cancel'}
                </Button>
              ) : undefined
            }
          />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
