import * as Dialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import type { ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/cn';
import type { AgentsSettingsMessages } from '@/i18n/messages';

import { AgentsEditorSidebar } from './agents-editor-sidebar';
import type { AgentPanel } from './utils';

export function AgentsEditorModal(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  a: AgentsSettingsMessages;
  title: string;
  subtitle: string;
  panel: AgentPanel;
  onPanelChange: (p: AgentPanel) => void;
  onFooterSave: () => void;
  footerSaveDisabled: boolean;
  /** Brief "Saved" flash after a successful save. */
  footerSavedFlash?: boolean;
  busy: boolean;
  children: ReactNode;
}) {
  const {
    open,
    onOpenChange,
    a,
    title,
    subtitle,
    panel,
    onPanelChange,
    onFooterSave,
    footerSaveDisabled,
    footerSavedFlash,
    busy,
    children,
  } = props;

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="xopc-dialog-overlay fixed inset-0 z-[60] bg-scrim" />
        <Dialog.Content
          className={cn(
            'xopc-dialog-content fixed z-[60] flex flex-col overflow-hidden rounded-xl border border-edge bg-surface-panel shadow-popover dark:border-edge',
            /* Desktop: roomy editor; inner panels scroll. Small viewports stay inset. */
            'inset-4 h-[calc(100dvh-2rem)] max-h-[calc(100dvh-2rem)] min-h-0',
            'sm:inset-auto sm:left-1/2 sm:top-1/2 sm:h-[min(88vh,48rem)] sm:max-h-[min(88vh,48rem)] sm:min-h-[32rem] sm:w-[min(100%-2rem,58rem)] sm:-translate-x-1/2 sm:-translate-y-1/2',
          )}
          onOpenAutoFocus={(e) => e.preventDefault()}
        >
          <div className="flex shrink-0 items-start justify-between gap-2 border-b border-edge-subtle px-4 pb-3 pt-4 dark:border-edge">
            <div className="min-w-0 pr-2">
              <Dialog.Title className="text-base font-semibold leading-snug text-fg">{title}</Dialog.Title>
              <Dialog.Description className="mt-1 font-mono text-xs text-fg-muted">{subtitle}</Dialog.Description>
            </div>
            <Dialog.Close asChild>
              <button
                type="button"
                className="shrink-0 rounded-lg p-1.5 text-fg-muted hover:bg-surface-base hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
                aria-label={a.closeDialogAria}
              >
                <X className="size-4" aria-hidden />
              </button>
            </Dialog.Close>
          </div>

          <div className="flex min-h-0 flex-1 flex-col sm:flex-row sm:overflow-hidden">
            <div className="shrink-0 border-b border-edge-subtle px-4 py-3 dark:border-edge sm:flex sm:w-56 sm:shrink-0 sm:flex-col sm:overflow-y-auto sm:border-b-0 sm:border-r sm:px-0 sm:py-4 sm:pl-4 sm:pr-3">
              <AgentsEditorSidebar a={a} panel={panel} onPanelChange={onPanelChange} />
            </div>

            <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
              {/* Flex column + min-h-0 lets Tools/Skills lists fill remaining height and scroll inside */}
              <div className="flex min-h-0 flex-1 flex-col overflow-hidden px-4 py-4 sm:pl-2 sm:pr-5">
                {children}
              </div>
              <div className="flex shrink-0 flex-col gap-1 border-t border-edge-subtle px-4 py-3 dark:border-edge sm:flex-row sm:items-center sm:justify-end sm:gap-3">
                {footerSavedFlash ? (
                  <p className="order-2 text-center text-xs font-medium text-green-600 sm:order-1 sm:mr-auto sm:text-left dark:text-green-400">
                    ✓ {a.personaSaved}
                  </p>
                ) : footerSaveDisabled ? (
                  <p className="order-2 text-center text-xs text-fg-muted sm:order-1 sm:mr-auto sm:text-left">
                    {a.footerSaveNotApplicable}
                  </p>
                ) : null}
                <Button
                  type="button"
                  className="order-1 w-full sm:order-2 sm:w-auto"
                  disabled={busy || footerSaveDisabled}
                  onClick={() => void onFooterSave()}
                >
                  {a.save}
                </Button>
              </div>
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
