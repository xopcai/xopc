import * as Dialog from '@radix-ui/react-dialog';

import { Button } from '@/components/ui/button';
import { messages } from '@/i18n/messages';
import type { StoredLanguage } from '@/lib/storage';

import type { WorkflowDefinition } from './workflow-api';
import { resolveWorkflowLocalizedCopy } from './workflow-meta-locale';

export function WorkflowDefinitionDetailDialog({
  open,
  definition,
  language,
  onClose,
  onRun,
}: {
  open: boolean;
  definition: WorkflowDefinition | null;
  language: StoredLanguage;
  onClose: () => void;
  onRun: () => void;
}) {
  const labels = messages(language).workflows;
  if (!definition) return null;

  const localized = resolveWorkflowLocalizedCopy(definition, language);
  const script = definition.runtime?.source ?? '';

  return (
    <Dialog.Root open={open} onOpenChange={(next) => !next && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="xopc-dialog-overlay fixed inset-0 z-65 bg-scrim backdrop-blur-[1px]" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-66 flex max-h-[min(85vh,44rem)] w-[min(100%-2rem,48rem)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-2xl border border-edge bg-surface-panel shadow-popover outline-none">
          <div className="border-b border-edge px-5 py-4">
            <Dialog.Title className="text-base font-semibold text-fg">{definition.title}</Dialog.Title>
            <Dialog.Description className="mt-1 text-sm text-fg-muted">{localized.description}</Dialog.Description>
          </div>

          <div className="min-h-0 flex-1 space-y-4 overflow-auto px-5 py-4">
            {localized.whenToUse ? (
              <section>
                <h3 className="text-xs font-semibold uppercase tracking-wide text-fg-subtle">{labels.whenToUseHeading}</h3>
                <p className="mt-2 text-sm leading-6 text-fg-muted">{localized.whenToUse}</p>
              </section>
            ) : null}

            {definition.phases.length > 0 ? (
              <section>
                <h3 className="text-xs font-semibold uppercase tracking-wide text-fg-subtle">{labels.phasesHeading}</h3>
                <ol className="mt-2 space-y-2">
                  {definition.phases.map((phase, index) => (
                    <li key={phase.id} className="rounded-xl border border-edge bg-surface-base/40 px-3 py-2">
                      <div className="text-sm font-medium text-fg">
                        {index + 1}. {phase.title}
                      </div>
                      {phase.description ? (
                        <p className="mt-1 text-xs leading-5 text-fg-muted">{phase.description}</p>
                      ) : null}
                    </li>
                  ))}
                </ol>
              </section>
            ) : null}

            {script ? (
              <section>
                <h3 className="text-xs font-semibold uppercase tracking-wide text-fg-subtle">{labels.scriptHeading}</h3>
                <pre className="mt-2 max-h-64 overflow-auto rounded-xl border border-edge bg-surface-base/50 p-3 font-mono text-xs leading-5 text-fg-muted">
                  {script}
                </pre>
              </section>
            ) : null}
          </div>

          <div className="flex justify-end gap-2 border-t border-edge px-5 py-4">
            <Button variant="secondary" onClick={onClose}>
              {labels.closeResult}
            </Button>
            <Button variant="primary" onClick={onRun}>
              {labels.runWorkflow}
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
