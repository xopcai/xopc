import * as Dialog from '@radix-ui/react-dialog';
import { ChevronRight, X } from 'lucide-react';
import { type ReactElement, type ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/cn';

export function MediaGenerationCard({ children, className }: { children: ReactNode; className?: string }) {
  return <article className={cn('min-w-0 w-full max-w-lg space-y-2.5 rounded-xl bg-surface-inset p-3 sm:p-4', className)}>
    {children}
  </article>;
}

export function MediaGenerationPreview({ kind, language, title, trigger, children }: {
  kind: 'image' | 'music' | 'video';
  language: 'zh' | 'en';
  title: string;
  trigger: ReactElement;
  children: ReactNode;
}) {
  return <Dialog.Root>
    <Dialog.Trigger asChild>{trigger}</Dialog.Trigger>
    <Dialog.Portal>
      <Dialog.Overlay className="fixed inset-0 z-[80] bg-scrim" />
      <Dialog.Content aria-describedby={undefined} className={cn(
        'fixed top-1/2 left-1/2 z-[81] flex w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-2xl border border-edge bg-surface-panel text-fg shadow-float outline-none',
        kind === 'music' ? 'h-[min(26rem,calc(100dvh-2rem))] max-w-md' : 'h-[min(42rem,calc(100dvh-2rem))] max-w-4xl',
      )}>
        <header className="flex min-w-0 shrink-0 items-center justify-between gap-2 border-b border-edge py-1 pe-1 ps-4">
          <Dialog.Title className="line-clamp-2 wrap-anywhere text-sm font-semibold" title={title}>{title}</Dialog.Title>
          <Dialog.Close asChild>
            <Button variant="ghost" className="size-11 shrink-0 p-0" aria-label={language === 'zh' ? '关闭预览' : 'Close preview'}>
              <X size={18} aria-hidden />
            </Button>
          </Dialog.Close>
        </header>
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">{children}</div>
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>;
}

export function MediaGenerationDetails({ label, children }: { label: string; children: ReactNode }) {
  return <details className="group text-xs text-fg-muted">
    <summary className="flex w-fit cursor-pointer list-none items-center gap-1 rounded-sm py-1 hover:text-fg focus-visible:outline-2 focus-visible:outline-accent [&::-webkit-details-marker]:hidden">
      <ChevronRight size={14} aria-hidden className="group-open:rotate-90" />
      {label}
    </summary>
    {children}
  </details>;
}
