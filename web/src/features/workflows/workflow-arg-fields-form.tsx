import { messages } from '@/i18n/messages';
import type { StoredLanguage } from '@/lib/storage';
import { cn } from '@/lib/cn';

import type { WorkflowDefinitionExamplePrompt } from './workflow-api';
import { applyWorkflowExamplePrompt } from './workflow-meta-locale';
import { WORKFLOW_ARG_FIELDS } from './workflow-page.constants';
import { resolveWorkflowArgLabel } from './workflow-input.utils';

type WorkflowsMessages = ReturnType<typeof messages>['workflows'];

function ExamplePromptList({
  examples,
  labels,
  onSelect,
}: {
  examples: WorkflowDefinitionExamplePrompt[];
  labels: WorkflowsMessages;
  onSelect: (example: WorkflowDefinitionExamplePrompt) => void;
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

export function WorkflowArgFieldsForm({
  workflowName,
  language,
  argValues,
  onArgValuesChange,
  goal,
  onGoalChange,
  examplePrompts = [],
  showGoal = true,
  inputClassName,
}: {
  workflowName: string;
  language: StoredLanguage;
  argValues: Record<string, string>;
  onArgValuesChange: (values: Record<string, string>) => void;
  goal: string;
  onGoalChange: (value: string) => void;
  examplePrompts?: WorkflowDefinitionExamplePrompt[];
  showGoal?: boolean;
  inputClassName?: string;
}) {
  const labels = messages(language).workflows;
  const argFields = WORKFLOW_ARG_FIELDS[workflowName] ?? [];
  const hasArgFields = argFields.length > 0;
  const fieldClass = cn(
    'mt-1.5 w-full rounded-xl border border-edge bg-surface-base px-3 py-2 text-sm text-fg outline-none placeholder:text-fg-subtle focus:border-accent focus:ring-2 focus:ring-accent/20',
    inputClassName,
  );

  const applyExample = (example: WorkflowDefinitionExamplePrompt) => {
    applyWorkflowExamplePrompt(example, onGoalChange, (updater) => {
      onArgValuesChange(updater(argValues));
    });
  };

  return (
    <div className="flex flex-col gap-3">
      {argFields.map((field) => (
        <label key={field.key} className="flex flex-col gap-1">
          <span className="text-xs font-medium text-fg-muted">
            {resolveWorkflowArgLabel(labels.args as Record<string, string>, field.labelKey)}
            {field.required ? ' *' : ''}
          </span>
          {field.multiline ? (
            <textarea
              value={argValues[field.key] ?? ''}
              onChange={(event) =>
                onArgValuesChange({ ...argValues, [field.key]: event.target.value })
              }
              placeholder={resolveWorkflowArgLabel(
                labels.args as Record<string, string>,
                field.placeholderKey,
              )}
              className={cn(fieldClass, 'min-h-20 resize-y')}
            />
          ) : (
            <input
              value={argValues[field.key] ?? ''}
              onChange={(event) =>
                onArgValuesChange({ ...argValues, [field.key]: event.target.value })
              }
              placeholder={resolveWorkflowArgLabel(
                labels.args as Record<string, string>,
                field.placeholderKey,
              )}
              className={fieldClass}
            />
          )}
        </label>
      ))}

      {hasArgFields && examplePrompts.length > 0 ? (
        <ExamplePromptList examples={examplePrompts} labels={labels} onSelect={applyExample} />
      ) : null}

      {showGoal ? (
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-fg-muted">{labels.goalLabel}</span>
          <textarea
            value={goal}
            onChange={(event) => onGoalChange(event.target.value)}
            placeholder={labels.goalPlaceholder}
            className={cn(fieldClass, 'min-h-20 resize-y')}
          />
        </label>
      ) : null}

      {!hasArgFields && examplePrompts.length > 0 ? (
        <ExamplePromptList examples={examplePrompts} labels={labels} onSelect={applyExample} />
      ) : null}
    </div>
  );
}
