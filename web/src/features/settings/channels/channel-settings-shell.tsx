import * as Dialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import type { ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/cn';
import { SETTINGS_SHELL_CONTENT_Z, SETTINGS_SHELL_OVERLAY_Z } from '@/lib/settings-shell-dialog-layer';

export type ChannelSettingsPresentation = 'modal' | 'drawer';

export function channelSettingsShellContentClass(
  presentation: ChannelSettingsPresentation,
  wide = false,
): string {
  if (presentation === 'drawer') {
    return cn(
      'xopc-drawer-right fixed right-0 top-0 flex size-full flex-col overflow-hidden border-l border-edge bg-surface-panel shadow-popover outline-none dark:border-edge',
      wide ? 'max-w-[36rem]' : 'max-w-xl',
      SETTINGS_SHELL_CONTENT_Z,
    );
  }
  return cn(
    'fixed left-1/2 top-1/2 flex max-h-[min(90vh,52rem)] w-[min(calc(100%-2rem),36rem)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden',
    wide && 'max-h-[min(90vh,48rem)] w-[min(calc(100%-2rem),40rem)]',
    SETTINGS_SHELL_CONTENT_Z,
    'rounded-2xl border border-edge bg-surface-panel shadow-popover outline-none dark:border-edge',
  );
}

export function ChannelSettingsShell({
  presentation,
  open,
  onOpenChange,
  title,
  description,
  srTitle,
  srDescription,
  closeAriaLabel,
  children,
  footer,
  wide = false,
  headerExtra,
}: {
  presentation: ChannelSettingsPresentation;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title?: ReactNode;
  description?: ReactNode;
  srTitle?: string;
  srDescription?: string;
  closeAriaLabel: string;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
  headerExtra?: ReactNode;
}) {
  const isDrawer = presentation === 'drawer';

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
          className={channelSettingsShellContentClass(presentation, wide)}
          onOpenAutoFocus={(e) => e.preventDefault()}
        >
          {srTitle ? <Dialog.Title className="sr-only">{srTitle}</Dialog.Title> : null}
          {srDescription ? <Dialog.Description className="sr-only">{srDescription}</Dialog.Description> : null}

          {isDrawer ? (
            <div className="flex shrink-0 items-start justify-between gap-3 border-b border-edge px-4 py-3">
              <div className="min-w-0 flex-1">
                {title ? <div className="text-base font-semibold text-fg">{title}</div> : null}
                {description ? <p className="mt-1 text-sm text-fg-muted">{description}</p> : null}
              </div>
              <Dialog.Close asChild>
                <Button type="button" variant="ghost" className="size-9 shrink-0 p-0" aria-label={closeAriaLabel}>
                  <X className="size-5" strokeWidth={1.75} />
                </Button>
              </Dialog.Close>
            </div>
          ) : (
            <>
              <Dialog.Close asChild>
                <button
                  type="button"
                  className="absolute right-3 top-3 z-20 rounded-lg p-1.5 text-fg-muted hover:bg-surface-hover hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
                  aria-label={closeAriaLabel}
                >
                  <X className="size-4" />
                </button>
              </Dialog.Close>
              {headerExtra}
            </>
          )}

          <div className={cn('min-h-0 flex-1 overflow-y-auto', isDrawer ? 'px-4 py-4' : 'p-6')}>{children}</div>
          {footer}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
