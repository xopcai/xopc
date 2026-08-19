import * as Dialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';

import { BrandLogo } from '@/components/shell/brand-logo';
import { Button } from '@/components/ui/button';
import { messages } from '@/i18n/messages';
import { useLocaleStore } from '@/stores/locale-store';

import { useUnderstandingActivityStore } from './understanding-activity-store';
import { WorkDiscoveryPage } from './work-discovery-page';

const EXIT_DURATION_MS = 180;

export function WorkDiscoveryOverlay({
  requestedOpen,
  onExited,
}: {
  requestedOpen: boolean;
  onExited: () => void;
}) {
  const language = useLocaleStore((state) => state.language);
  const running = useUnderstandingActivityStore((state) => state.status === 'running');
  const [open, setOpen] = useState(true);
  const closingRef = useRef(false);
  const exitTimerRef = useRef<number | null>(null);
  const copy = messages(language).onboarding.workDiscovery;
  const closeLabel = running
    ? (language === 'zh' ? '在后台继续' : 'Continue in background')
    : (language === 'zh' ? '稍后再说' : 'Maybe later');

  const requestClose = useCallback(() => {
    if (closingRef.current) return;
    closingRef.current = true;
    setOpen(false);
    const exitDuration = window.matchMedia('(prefers-reduced-motion: reduce)').matches
      ? 0
      : EXIT_DURATION_MS;
    exitTimerRef.current = window.setTimeout(onExited, exitDuration);
  }, [onExited]);

  useEffect(() => {
    if (!requestedOpen) requestClose();
  }, [requestClose, requestedOpen]);

  useEffect(() => () => {
    if (exitTimerRef.current !== null) window.clearTimeout(exitTimerRef.current);
  }, []);

  return (
    <Dialog.Root open={open} onOpenChange={(nextOpen) => { if (!nextOpen) requestClose(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="xopc-dialog-overlay fixed inset-0 z-[75] bg-scrim backdrop-blur-[1px]" />
        <Dialog.Content
          className="xopc-work-discovery-dialog pointer-events-none fixed inset-0 z-[76] flex items-center justify-center p-3 outline-none sm:p-6"
        >
          <section className="xopc-work-discovery-panel pointer-events-auto flex h-[min(47.5rem,calc(100dvh-1.5rem))] w-[min(45rem,calc(100vw-1.5rem))] flex-col overflow-hidden rounded-2xl border border-edge bg-surface-base shadow-float sm:h-[min(47.5rem,calc(100dvh-3rem))] sm:w-[min(45rem,calc(100vw-3rem))]">
            <header className="flex h-14 shrink-0 items-center justify-between gap-4 border-b border-edge bg-surface-panel px-4 sm:px-5">
              <div className="flex min-w-0 items-center gap-2.5">
                <BrandLogo className="size-7 shrink-0" aria-hidden />
                <Dialog.Title className="truncate text-sm font-semibold text-fg">{copy.title}</Dialog.Title>
                <Dialog.Description className="sr-only">{copy.subtitle}</Dialog.Description>
              </div>
              <Button
                type="button"
                variant="ghost"
                className="h-9 shrink-0 gap-1.5 px-2.5 text-fg-muted"
                title={closeLabel}
                aria-label={closeLabel}
                onClick={requestClose}
              >
                <span className="hidden text-xs sm:inline">{closeLabel}</span>
                <X className="size-4" aria-hidden />
              </Button>
            </header>
            <div className="min-h-0 flex-1 overflow-hidden">
              <WorkDiscoveryPage embedded onRequestClose={requestClose} />
            </div>
          </section>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
