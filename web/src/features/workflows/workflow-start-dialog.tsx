import * as Dialog from '@radix-ui/react-dialog';
import { useEffect, useMemo, useState } from 'react';

import { Button } from '@/components/ui/button';
import { messages } from '@/i18n/messages';
import type { StoredLanguage } from '@/lib/storage';

import type { WorkflowDefinition } from './workflow-api';
import { resolveWorkflowLocalizedCopy } from './workflow-meta-locale';
import {
  resolveWorkflowInputPayload,
  validateWorkflowInputEditorValue,
} from './workflow-input-editor';
import { WorkflowRunSetupPanel, type WorkflowRunSetupValue } from './workflow-run-setup-panel';

export function WorkflowStartDialog({
  open,
  definition,
  language,
  starting,
  onClose,
  onStart,
}: {
  open: boolean;
  definition: WorkflowDefinition | null;
  language: StoredLanguage;
  starting: boolean;
  onClose: () => void;
  onStart: (payload: { goal: string; input?: unknown; concurrency?: number; maxSubagents?: number }) => void;
}) {
  const labels = messages(language).workflows;
  const [inputValue, setInputValue] = useState<WorkflowRunSetupValue>({
    goal: '',
    argValues: {},
    schemaInput: {},
    concurrency: '',
    maxSubagents: '',
  });

  const localized = useMemo(
    () => (definition ? resolveWorkflowLocalizedCopy(definition, language) : null),
    [definition, language],
  );
  const inputValidity = useMemo(
    () => validateWorkflowInputEditorValue(definition, inputValue),
    [definition, inputValue],
  );
  const numericValuesValid = useMemo(() => {
    const values = [inputValue.concurrency, inputValue.maxSubagents];
    return values.every((value) => {
      const trimmed = value.trim();
      if (!trimmed) return true;
      const parsed = Number(trimmed);
      return Number.isInteger(parsed) && parsed > 0;
    });
  }, [inputValue.concurrency, inputValue.maxSubagents]);
  const canStart = inputValidity.valid && numericValuesValid && !starting;

  useEffect(() => {
    if (!open || !definition) return;
    setInputValue({ goal: '', argValues: {}, schemaInput: {}, concurrency: '', maxSubagents: '' });
  }, [open, definition?.id]);

  if (!definition || !localized) return null;

  const submit = () => {
    if (!canStart) return;
    const input = resolveWorkflowInputPayload(definition, inputValue);
    onStart({
      goal: inputValue.goal.trim() || localized.description,
      input,
      concurrency: inputValue.concurrency.trim() ? Number(inputValue.concurrency) : undefined,
      maxSubagents: inputValue.maxSubagents.trim() ? Number(inputValue.maxSubagents) : undefined,
    });
  };

  return (
    <Dialog.Root open={open} onOpenChange={(next) => !next && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="xopc-dialog-overlay fixed inset-0 z-65 bg-scrim backdrop-blur-[1px]" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-66 flex max-h-[min(85vh,40rem)] w-[min(100%-2rem,32rem)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-2xl border border-edge bg-surface-panel shadow-popover outline-none">
          <div className="border-b border-edge px-5 py-4">
            <Dialog.Title className="text-base font-semibold text-fg">
              {labels.startTitle} · {definition.title}
            </Dialog.Title>
            <Dialog.Description className="mt-1 text-sm text-fg-muted">{localized.description}</Dialog.Description>
          </div>

          <div className="min-h-0 flex-1 space-y-4 overflow-auto px-5 py-4">
            <WorkflowRunSetupPanel
              definition={definition}
              language={language}
              value={inputValue}
              onChange={setInputValue}
              mode="manual"
              badgeLabel={labels.readyToStart}
              aiAssist={{
                context: {
                  surface: 'workflow-start',
                  workflowId: definition.id,
                  workflowName: definition.name,
                  workflowTitle: definition.title,
                  workflowDescription: localized.description,
                },
              }}
            />
          </div>

          <div className="flex justify-end gap-2 border-t border-edge px-5 py-4">
            {!canStart ? (
              <div className="mr-auto self-center text-xs text-fg-subtle">
                {labels.inputRequiredHint}
              </div>
            ) : null}
            <Button variant="secondary" onClick={onClose} disabled={starting}>
              {labels.cancelDialog}
            </Button>
            <Button variant="primary" onClick={submit} disabled={!canStart}>
              {starting ? labels.starting : labels.start}
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
