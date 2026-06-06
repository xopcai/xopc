import * as Dialog from '@radix-ui/react-dialog';
import { ChevronDown } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/cn';
import { messages } from '@/i18n/messages';
import type { StoredLanguage } from '@/lib/storage';

import type { WorkflowDefinition } from './workflow-api';
import {
  applyWorkflowExamplePrompt,
  resolveWorkflowLocalizedCopy,
} from './workflow-meta-locale';
import { WORKFLOW_ARG_FIELDS } from './workflow-page.constants';
import { buildWorkflowInput, interpolate } from './workflow-page.utils';

type WorkflowsMessages = ReturnType<typeof messages>['workflows'];

function ExamplePromptList({
  examples,
  labels,
  onSelect,
}: {
  examples: Array<{ field: string; text: string }>;
  labels: WorkflowsMessages;
  onSelect: (example: { field: string; text: string }) => void;
}) {
  if (examples.length === 0) return null;
  return (
    <div>
      <div className="text-xs font-medium text-fg-muted">{labels.examplePrompts}</div>
      <div className="mt-2 flex flex-col gap-1.5">
        {examples.map((example) => (
          <button
            key={`${example.field}:${example.text}`}
            type="button"
            onClick={() => onSelect(example)}
            className="rounded-lg border border-edge bg-surface-base/50 px-3 py-2 text-left text-xs text-fg-muted hover:bg-surface-hover"
          >
            {example.text}
          </button>
        ))}
      </div>
    </div>
  );
}

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
  const [goal, setGoal] = useState('');
  const [argValues, setArgValues] = useState<Record<string, string>>({});
  const [concurrency, setConcurrency] = useState('');
  const [maxSubagents, setMaxSubagents] = useState('');
  const [advancedOpen, setAdvancedOpen] = useState(false);

  const localized = useMemo(
    () => (definition ? resolveWorkflowLocalizedCopy(definition, language) : null),
    [definition, language],
  );

  const argFields = useMemo(
    () => (definition ? WORKFLOW_ARG_FIELDS[definition.name] ?? [] : []),
    [definition],
  );

  const examples = localized?.examplePrompts ?? [];
  const hasArgFields = argFields.length > 0;

  useEffect(() => {
    if (!open || !definition) return;
    setGoal('');
    setArgValues({});
    setConcurrency('');
    setMaxSubagents('');
    setAdvancedOpen(false);
  }, [open, definition?.id]);

  if (!definition || !localized) return null;

  const applyExample = (example: { field: string; text: string }) => {
    applyWorkflowExamplePrompt(example, setGoal, setArgValues);
  };

  const submit = () => {
    const input = buildWorkflowInput(argValues);
    onStart({
      goal: goal.trim() || localized.description,
      input,
      concurrency: concurrency.trim() ? Number(concurrency) : undefined,
      maxSubagents: maxSubagents.trim() ? Number(maxSubagents) : undefined,
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
            {argFields.map((field) => (
              <label key={field.key} className="block">
                <span className="text-xs font-medium text-fg">
                  {resolveArgLabel(labels, field.labelKey)}
                  {field.required ? ' *' : ''}
                </span>
                {field.multiline ? (
                  <textarea
                    value={argValues[field.key] ?? ''}
                    onChange={(event) =>
                      setArgValues((prev) => ({ ...prev, [field.key]: event.target.value }))
                    }
                    placeholder={resolveArgLabel(labels, field.placeholderKey)}
                    className="mt-1.5 min-h-20 w-full resize-y rounded-xl border border-edge bg-surface-base px-3 py-2 text-sm text-fg outline-none placeholder:text-fg-subtle focus:border-accent focus:ring-2 focus:ring-accent/20"
                  />
                ) : (
                  <input
                    value={argValues[field.key] ?? ''}
                    onChange={(event) =>
                      setArgValues((prev) => ({ ...prev, [field.key]: event.target.value }))
                    }
                    placeholder={resolveArgLabel(labels, field.placeholderKey)}
                    className="mt-1.5 w-full rounded-xl border border-edge bg-surface-base px-3 py-2 text-sm text-fg outline-none placeholder:text-fg-subtle focus:border-accent focus:ring-2 focus:ring-accent/20"
                  />
                )}
              </label>
            ))}

            {hasArgFields ? (
              <ExamplePromptList examples={examples} labels={labels} onSelect={applyExample} />
            ) : null}

            <label className="block">
              <span className="text-xs font-medium text-fg">{labels.goalLabel}</span>
              <textarea
                value={goal}
                onChange={(event) => setGoal(event.target.value)}
                placeholder={labels.goalPlaceholder}
                className="mt-1.5 min-h-24 w-full resize-y rounded-xl border border-edge bg-surface-base px-3 py-2 text-sm text-fg outline-none placeholder:text-fg-subtle focus:border-accent focus:ring-2 focus:ring-accent/20"
              />
            </label>

            {!hasArgFields ? (
              <ExamplePromptList examples={examples} labels={labels} onSelect={applyExample} />
            ) : null}

            <div className="rounded-xl border border-edge">
              <button
                type="button"
                className="flex w-full items-center justify-between px-3 py-2.5 text-left text-sm text-fg"
                onClick={() => setAdvancedOpen((value) => !value)}
              >
                {labels.advancedSettings}
                <ChevronDown className={cn('size-4 transition-transform', advancedOpen && 'rotate-180')} />
              </button>
              {advancedOpen ? (
                <div className="grid gap-3 border-t border-edge px-3 pb-3 pt-3 sm:grid-cols-2">
                  <input
                    value={concurrency}
                    onChange={(event) => setConcurrency(event.target.value)}
                    placeholder={interpolate(labels.concurrencyPlaceholder, {
                      default: definition.defaults.concurrency,
                    })}
                    inputMode="numeric"
                    className="rounded-xl border border-edge bg-surface-base px-3 py-2 text-sm text-fg outline-none placeholder:text-fg-subtle focus:border-accent focus:ring-2 focus:ring-accent/20"
                  />
                  <input
                    value={maxSubagents}
                    onChange={(event) => setMaxSubagents(event.target.value)}
                    placeholder={interpolate(labels.maxSubagentsPlaceholder, {
                      default: definition.defaults.maxSubagents,
                    })}
                    inputMode="numeric"
                    className="rounded-xl border border-edge bg-surface-base px-3 py-2 text-sm text-fg outline-none placeholder:text-fg-subtle focus:border-accent focus:ring-2 focus:ring-accent/20"
                  />
                </div>
              ) : null}
            </div>
          </div>

          <div className="flex justify-end gap-2 border-t border-edge px-5 py-4">
            <Button variant="secondary" onClick={onClose} disabled={starting}>
              {labels.cancelDialog}
            </Button>
            <Button variant="primary" onClick={submit} disabled={starting}>
              {starting ? labels.starting : labels.start}
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function resolveArgLabel(labels: WorkflowsMessages, key: string): string {
  const args = labels.args as Record<string, string>;
  return args[key] ?? key;
}
