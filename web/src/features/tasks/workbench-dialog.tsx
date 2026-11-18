import * as Dialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { useRef, type ReactElement, type ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/cn';
import { useLocaleStore } from '@/stores/locale-store';

const sizes = {
  compact: 'h-[min(22rem,calc(100dvh-1.5rem))] w-[min(32rem,calc(100vw-1.5rem))]',
  default: 'h-[min(36rem,calc(100dvh-1.5rem))] w-[min(42rem,calc(100vw-1.5rem))]',
  wide: 'h-[min(46rem,calc(100dvh-1.5rem))] w-[min(56rem,calc(100vw-1.5rem))]',
};

export function WorkbenchDialog({ title, subtitle, trigger, open, onOpenChange, children, footer, size = 'default', busy, restoreFocus }: {
  title: string;
  subtitle?: string;
  trigger?: ReactElement;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  children: ReactNode;
  footer?: ReactNode;
  size?: keyof typeof sizes;
  busy?: boolean;
  restoreFocus?: (() => void) | false;
}) {
  const language = useLocaleStore((state) => state.language);
  const previousFocus = useRef<HTMLElement | null>(null);

  return (
    <Dialog.Root open={open} onOpenChange={(next) => { if (next || !busy) onOpenChange?.(next); }}>
      {trigger ? <Dialog.Trigger asChild>{trigger}</Dialog.Trigger> : null}
      <Dialog.Portal>
        {/* A newly opened dialog places its overlay above previous dialog content. */}
        <Dialog.Overlay className="xopc-dialog-overlay fixed inset-0 z-[90] bg-scrim" />
        <Dialog.Content
          className={cn('xopc-dialog-content fixed left-1/2 top-1/2 z-[90] flex -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-xl border border-edge bg-surface-overlay shadow-float outline-none', sizes[size])}
          aria-describedby={undefined}
          aria-busy={busy}
          onOpenAutoFocus={() => {
            previousFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
          }}
          onCloseAutoFocus={(event) => {
            if (trigger && restoreFocus === undefined) return;
            event.preventDefault();
            if (restoreFocus === false) return;
            if (restoreFocus) restoreFocus();
            else if (previousFocus.current?.isConnected) previousFocus.current.focus({ preventScroll: true });
          }}
          onEscapeKeyDown={(event) => { if (busy) event.preventDefault(); }}
          onPointerDownOutside={(event) => { if (busy) event.preventDefault(); }}
        >
          <header className="flex shrink-0 items-center justify-between gap-3 border-b border-edge px-4 py-3 sm:px-5">
            <div className="min-w-0">
              <Dialog.Title className="break-words text-base font-semibold text-fg">{title}</Dialog.Title>
              {subtitle ? <p className="mt-0.5 truncate text-xs text-fg-muted" title={subtitle}>{subtitle}</p> : null}
            </div>
            <Dialog.Close asChild>
              <Button type="button" variant="ghost" className="size-9 shrink-0 p-0" disabled={busy} aria-label={language === 'zh' ? '关闭' : 'Close'}>
                <X className="size-4" aria-hidden />
              </Button>
            </Dialog.Close>
          </header>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4 sm:px-5">
            {children}
          </div>
          {footer ? <footer className="shrink-0 border-t border-edge px-4 py-3 sm:px-5">{footer}</footer> : null}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
