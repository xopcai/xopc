import * as Dialog from '@radix-ui/react-dialog';
import { Play, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/cn';
import { interaction } from '@/lib/interaction';
import { messages } from '@/i18n/messages';
import type { StoredLanguage } from '@/lib/storage';

import type { WorkflowDefinition } from './workflow-api';
import { resolveWorkflowLocalizedCopy } from './workflow-meta-locale';

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
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/40" />
        <Dialog.Content
          className={cn(
            'fixed left-1/2 top-1/2 z-50 flex max-h-[min(85vh,720px)] w-[min(92vw,32rem)] -translate-x-1/2 -translate-y-1/2',
            'flex-col rounded-2xl border border-edge bg-surface-panel shadow-surface',
            interaction.focusRingPanel,
          )}
        >
          <div className="flex items-start justify-between gap-3 border-b border-edge-subtle px-5 py-4">
            <div>
              <Dialog.Title className="text-base font-semibold text-fg">{labels.pickStartTitle}</Dialog.Title>
              <Dialog.Description className="mt-1 text-sm text-fg-muted">{labels.pickStartHint}</Dialog.Description>
            </div>
            <Dialog.Close asChild>
              <Button variant="ghost" className="size-8 p-0" aria-label={labels.pickStartClose}>
                <X className="size-4" aria-hidden />
              </Button>
            </Dialog.Close>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto p-3">
            {definitions.length === 0 ? (
              <p className="px-2 py-8 text-center text-sm text-fg-muted">{labels.noDefinitions}</p>
            ) : (
              <ul className="flex flex-col gap-1.5">
                {definitions.map((definition) => {
                  const copy = resolveWorkflowLocalizedCopy(definition, language);
                  return (
                    <li key={definition.id}>
                      <button
                        type="button"
                        onClick={() => onPick(definition)}
                        className={cn(
                          'flex w-full items-start gap-3 rounded-xl border border-edge bg-surface-base/50 px-3 py-3 text-left',
                          'hover:border-edge-strong hover:bg-surface-hover/60',
                          interaction.focusRingPanel,
                        )}
                      >
                        <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent-fg">
                          <Play className="size-3.5" aria-hidden />
                        </span>
                        <span className="min-w-0">
                          <span className="block text-sm font-semibold text-fg">{definition.title}</span>
                          <span className="mt-0.5 block text-xs text-fg-subtle">{definition.id}</span>
                          {copy.description ? (
                            <span className="mt-1 line-clamp-2 block text-xs leading-5 text-fg-muted">
                              {copy.description}
                            </span>
                          ) : null}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
