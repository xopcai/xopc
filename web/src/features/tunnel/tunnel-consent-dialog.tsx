import * as Dialog from '@radix-ui/react-dialog';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/cn';
import { SETTINGS_SHELL_CONTENT_Z, SETTINGS_SHELL_OVERLAY_Z } from '@/lib/settings-shell-dialog-layer';

export type TunnelConsentDialogProps = {
  open: boolean;
  title: string;
  intro: string;
  bullets: readonly string[];
  checkboxLabel: string;
  confirmLabel: string;
  cancelLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
};

export function TunnelConsentDialog({
  open,
  title,
  intro,
  bullets,
  checkboxLabel,
  confirmLabel,
  cancelLabel,
  onConfirm,
  onCancel,
}: TunnelConsentDialogProps) {
  const [checked, setChecked] = useState(false);

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          setChecked(false);
          onCancel();
        }
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
            'fixed left-1/2 top-1/2 max-h-[min(90vh,40rem)] w-[min(100%-2rem,32rem)] -translate-x-1/2 -translate-y-1/2',
            'overflow-y-auto rounded-2xl border border-edge bg-surface-panel p-6 shadow-popover outline-none dark:border-edge',
            SETTINGS_SHELL_CONTENT_Z,
          )}
          onOpenAutoFocus={(e) => e.preventDefault()}
        >
          <Dialog.Title className="text-base font-semibold text-fg">{title}</Dialog.Title>
          <Dialog.Description className="mt-2 text-sm text-fg-muted">{intro}</Dialog.Description>
          <ul className="mt-4 list-disc space-y-2 pl-5 text-sm text-fg-muted">
            {bullets.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
          <label className="mt-5 flex cursor-pointer items-start gap-3 text-sm text-fg">
            <input
              type="checkbox"
              className="mt-0.5 size-4 shrink-0 rounded border-edge accent-accent"
              checked={checked}
              onChange={(e) => setChecked(e.target.checked)}
            />
            <span>{checkboxLabel}</span>
          </label>
          <div className="mt-6 flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={onCancel}>
              {cancelLabel}
            </Button>
            <Button type="button" disabled={!checked} onClick={onConfirm}>
              {confirmLabel}
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
