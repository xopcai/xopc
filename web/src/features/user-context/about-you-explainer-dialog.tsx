import * as Dialog from '@radix-ui/react-dialog';
import { Brain, Database, ShieldCheck, Users, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { type messages } from '@/i18n/messages';
import { cn } from '@/lib/cn';
import { SETTINGS_SHELL_CONTENT_Z, SETTINGS_SHELL_OVERLAY_Z } from '@/lib/settings-shell-dialog-layer';

type YouMessages = ReturnType<typeof messages>['you'];

type AboutYouExplainerDialogProps = {
  open: boolean;
  t: YouMessages;
  onOpenChange: (open: boolean) => void;
  onNavigate: (view: 'sources' | 'controls') => void;
};

export function AboutYouExplainerDialog({
  open,
  t,
  onOpenChange,
  onNavigate,
}: AboutYouExplainerDialogProps) {
  const sections = [
    { icon: Brain, title: t.helpLearningTitle, body: t.helpLearningBody },
    { icon: Users, title: t.helpSharingTitle, body: t.helpSharingBody },
    { icon: Database, title: t.helpSourcesTitle, body: t.helpSourcesBody },
    { icon: ShieldCheck, title: t.helpControlTitle, body: t.helpControlBody },
  ];

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
            'fixed right-3 top-1/2 flex h-[min(44rem,calc(100dvh-1.5rem))] w-[min(30rem,calc(100vw-1.5rem))] -translate-y-1/2 flex-col overflow-hidden',
            SETTINGS_SHELL_CONTENT_Z,
            'rounded-2xl border border-edge bg-surface-panel shadow-popover outline-none',
          )}
        >
          <header className="flex shrink-0 items-start justify-between gap-4 border-b border-edge px-5 py-4">
            <div className="min-w-0">
              <Dialog.Title className="text-base font-semibold text-fg">{t.helpTitle}</Dialog.Title>
              <Dialog.Description className="mt-1 text-sm leading-6 text-fg-muted">
                {t.helpSubtitle}
              </Dialog.Description>
            </div>
            <Dialog.Close asChild>
              <Button type="button" variant="ghost" className="size-9 shrink-0 p-0" aria-label={t.close}>
                <X className="size-4" aria-hidden />
              </Button>
            </Dialog.Close>
          </header>

          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-2">
            {sections.map(({ icon: Icon, title, body }) => (
              <section key={title} className="flex gap-3 border-b border-edge-subtle py-4 last:border-b-0">
                <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-surface-muted text-fg-muted">
                  <Icon className="size-4" aria-hidden />
                </span>
                <div className="min-w-0">
                  <h3 className="text-sm font-semibold text-fg">{title}</h3>
                  <p className="mt-1 text-sm leading-6 text-fg-muted">{body}</p>
                </div>
              </section>
            ))}
          </div>

          <footer className="flex shrink-0 flex-wrap justify-end gap-2 border-t border-edge px-5 py-4">
            <Button type="button" variant="ghost" onClick={() => { onOpenChange(false); onNavigate('sources'); }}>
              {t.tabs.sources}
            </Button>
            <Button type="button" variant="secondary" onClick={() => { onOpenChange(false); onNavigate('controls'); }}>
              {t.openPrivacyControls}
            </Button>
          </footer>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
