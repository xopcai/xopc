import * as Dialog from '@radix-ui/react-dialog';
import { useState } from 'react';

import { messages } from '@/i18n/messages';
import { useGatewayStore } from '@/stores/gateway-store';
import { useLocaleStore } from '@/stores/locale-store';
import { cn } from '@/lib/cn';
import { Button } from '@/components/ui/button';

export function TokenDialog() {
  const open = useGatewayStore((s) => s.tokenDialogOpen);
  const baseUrl = useGatewayStore((s) => s.baseUrl);
  const tokenExpired = useGatewayStore((s) => s.tokenExpired);
  const setGatewayToken = useGatewayStore((s) => s.setGatewayToken);
  const closeTokenDialog = useGatewayStore((s) => s.closeTokenDialog);
  const storedToken = useGatewayStore((s) => s.token);

  const language = useLocaleStore((s) => s.language);
  const t = messages(language).token;

  const [value, setValue] = useState('');
  const [show, setShow] = useState(false);
  const [error, setError] = useState('');

  const canDismiss = Boolean(storedToken) && !tokenExpired;

  function handleSave() {
    const trimmed = value.trim();
    if (!trimmed) {
      setError(language === 'zh' ? '请输入 Token' : 'Please enter a token');
      return;
    }
    setGatewayToken(trimmed);
    setValue('');
  }

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => {
        if (!next && !canDismiss) return;
        if (!next) closeTokenDialog();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-[2px]" />
        <Dialog.Content
          className={cn(
            'fixed left-1/2 top-1/2 z-50 w-[min(100%-2rem,28rem)] -translate-x-1/2 -translate-y-1/2 rounded-lg border border-edge bg-surface-panel p-4 shadow-popover',
            'dark:border-edge',
          )}
          onOpenAutoFocus={(e) => e.preventDefault()}
        >
          <Dialog.Title className="text-base font-semibold text-fg">{t.title}</Dialog.Title>
          <Dialog.Description className="mt-1 text-sm text-fg-muted">{t.description}</Dialog.Description>

          <div className="mt-4 flex flex-col gap-3">
            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-fg-muted">{t.gatewayUrl}</span>
              <input
                readOnly
                className="rounded-md border border-edge bg-surface-hover px-3 py-2 text-sm text-fg-muted"
                value={baseUrl}
              />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-fg-muted">{t.tokenLabel}</span>
              <div className="flex gap-2">
                <input
                  type={show ? 'text' : 'password'}
                  autoComplete="off"
                  className="min-w-0 flex-1 rounded-md border border-edge bg-surface-panel px-3 py-2 text-sm text-fg placeholder:text-fg-disabled focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                  placeholder={t.placeholder}
                  value={value}
                  onChange={(e) => {
                    setValue(e.target.value);
                    setError('');
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleSave();
                  }}
                />
                <Button type="button" variant="secondary" className="shrink-0 px-2" onClick={() => setShow((s) => !s)}>
                  {show ? t.hide : t.show}
                </Button>
              </div>
              {error ? <p className="text-xs text-danger">{error}</p> : null}
            </label>
          </div>

          <div className="mt-4 flex justify-end gap-2">
            {canDismiss ? (
              <Button type="button" variant="ghost" onClick={() => closeTokenDialog()}>
                {language === 'zh' ? '取消' : 'Cancel'}
              </Button>
            ) : null}
            <Button type="button" variant="primary" onClick={handleSave}>
              {t.save}
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
