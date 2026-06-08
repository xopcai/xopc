import * as Dialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/cn';
import { interaction } from '@/lib/interaction';
import { messages } from '@/i18n/messages';
import type { StoredLanguage } from '@/lib/storage';

import type { WorkflowDefinition } from './workflow-api';
import { WorkflowPickLibrary } from './workflow-pick-library';

export function WorkflowPickStartDialog({
  open,
  definitions,
  language,
  onClose,
  onPick,
}: {
  open: boolean;
  definitions: WorkflowDefinition[];
  language: StoredLanguage;
  onClose: () => void;
  onPick: (definition: WorkflowDefinition) => void;
}) {
  const labels = messages(language).workflows;

  return (
    <Dialog.Root open={open} onOpenChange={(next) => !next && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-scrim" />
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none">
          <Dialog.Content
            className={cn(
              'pointer-events-auto relative flex h-[min(90vh,840px)] w-full max-w-5xl flex-col',
              'rounded-2xl border border-edge bg-surface-panel shadow-popover outline-none',
              interaction.focusRingPanel,
            )}
            onOpenAutoFocus={(event) => event.preventDefault()}
          >
            <div className="flex shrink-0 items-start justify-between gap-4 border-b border-edge-subtle px-6 py-5">
              <div className="min-w-0">
                <Dialog.Title className="text-lg font-semibold text-fg">{labels.pickStartTitle}</Dialog.Title>
                <Dialog.Description className="mt-1 text-sm leading-6 text-fg-muted">
                  {labels.pickStartHint}
                </Dialog.Description>
              </div>
              <Dialog.Close asChild>
                <Button variant="ghost" className="size-9 shrink-0 p-0" aria-label={labels.pickStartClose}>
                  <X className="size-5" strokeWidth={1.75} aria-hidden />
                </Button>
              </Dialog.Close>
            </div>

            <div className="flex min-h-0 flex-1 flex-col px-6 py-5">
              <WorkflowPickLibrary definitions={definitions} language={language} onPick={onPick} />
            </div>
          </Dialog.Content>
        </div>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
