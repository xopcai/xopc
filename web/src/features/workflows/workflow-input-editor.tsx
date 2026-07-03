import { useMemo, useState } from 'react';

import { AiTextAssistButton } from '@/features/ai-assist/ai-text-assist-button';
import type { TextAssistScenario } from '@/features/ai-assist/ai-text-assist-api';
import { messages } from '@/i18n/messages';
import type { StoredLanguage } from '@/lib/storage';
import { cn } from '@/lib/cn';

import type { WorkflowDefinition, WorkflowDefinitionExamplePrompt } from './workflow-api';
import { resolveWorkflowLocalizedCopy } from './workflow-meta-locale';
import { WORKFLOW_ARG_FIELDS } from './workflow-page.constants';
import { buildWorkflowInput } from './workflow-page.utils';
import { WorkflowArgFieldsForm } from './workflow-arg-fields-form';
import {
  supportsWorkflowSchemaForm,
  validateWorkflowSchemaInput,
  WorkflowSchemaInputForm,
  type SchemaInputValue,
} from './workflow-schema-input-form';

type WorkflowsMessages = ReturnType<typeof messages>['workflows'];

export interface WorkflowInputEditorValue {
  goal: string;
  argValues: Record<string, string>;
  schemaInput: SchemaInputValue;
}

export interface WorkflowInputEditorValidity {
  valid: boolean;
  reason?: 'schema-required' | 'raw-json';
}

export interface WorkflowInputEditorAiAssistConfig {
  disabled?: boolean;
  context?: Record<string, unknown>;
  inputScenario?: TextAssistScenario;
  goalScenario?: TextAssistScenario;
}

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

export function resolveWorkflowInputPayload(
  definition: WorkflowDefinition | null | undefined,
  value: WorkflowInputEditorValue,
): unknown {
  if (!definition) return undefined;
  if (supportsWorkflowSchemaForm(definition.inputSchema)) {
    return Object.keys(value.schemaInput).length > 0 ? value.schemaInput : undefined;
  }
  return buildWorkflowInput(value.argValues);
}

export function summarizeWorkflowInput(
  definition: WorkflowDefinition | null | undefined,
  language: StoredLanguage,
  value: WorkflowInputEditorValue,
): string {
  const labels = messages(language).workflows;
  if (!definition) return labels.noInputSummary;
  const localized = resolveWorkflowLocalizedCopy(definition, language);
  const hasSchemaForm = supportsWorkflowSchemaForm(definition.inputSchema);
  if (hasSchemaForm && Object.keys(value.schemaInput).length > 0) {
    return Object.entries(value.schemaInput).map(([key, item]) => `${key}: ${String(item)}`).join(' · ');
  }
  const parts = Object.values(value.argValues)
    .map((item) => item.trim())
    .filter(Boolean);
  const resolvedGoal = value.goal.trim() || localized.description;
  if (resolvedGoal) parts.unshift(resolvedGoal);
  return parts.length > 0 ? parts.join(' · ') : labels.noInputSummary;
}

export function validateWorkflowInputEditorValue(
  definition: WorkflowDefinition | null | undefined,
  value: WorkflowInputEditorValue,
  rawJsonValid = true,
): WorkflowInputEditorValidity {
  if (!definition) return { valid: false };
  if (!rawJsonValid) return { valid: false, reason: 'raw-json' };
  if (supportsWorkflowSchemaForm(definition.inputSchema)) {
    return validateWorkflowSchemaInput(definition.inputSchema, value.schemaInput)
      ? { valid: true }
      : { valid: false, reason: 'schema-required' };
  }
  const fields = WORKFLOW_ARG_FIELDS[definition.name] ?? [];
  const valid = fields.every((field) => !field.required || Boolean(value.argValues[field.key]?.trim()));
  return { valid };
}

export function WorkflowInputEditor({
  definition,
  language,
  value,
  onChange,
  aiAssist,
  inputClassName,
  onValidityChange,
}: {
  definition: WorkflowDefinition;
  language: StoredLanguage;
  value: WorkflowInputEditorValue;
  onChange: (next: WorkflowInputEditorValue) => void;
  aiAssist?: WorkflowInputEditorAiAssistConfig;
  inputClassName?: string;
  onValidityChange?: (validity: WorkflowInputEditorValidity) => void;
}) {
  const labels = messages(language).workflows;
  const localized = useMemo(
    () => resolveWorkflowLocalizedCopy(definition, language),
    [definition, language],
  );
  const [rawJsonValid, setRawJsonValid] = useState(true);
  const examples = localized.examplePrompts ?? [];
  const hasSchemaForm = supportsWorkflowSchemaForm(definition.inputSchema);
  const fieldClass = cn(
    'mt-1.5 w-full rounded-xl border border-edge bg-surface-base px-3 py-2 text-sm text-fg outline-none placeholder:text-fg-subtle focus:border-accent focus:ring-2 focus:ring-accent/20',
    inputClassName,
  );

  const emitChange = (next: WorkflowInputEditorValue, nextRawJsonValid = rawJsonValid) => {
    onChange(next);
    onValidityChange?.(validateWorkflowInputEditorValue(definition, next, nextRawJsonValid));
  };

  const setGoal = (goal: string) => emitChange({ ...value, goal });
  const setSchemaInput = (schemaInput: SchemaInputValue) => emitChange({ ...value, schemaInput });
  const setArgValues = (argValues: Record<string, string>) => emitChange({ ...value, argValues });

  const applySchemaExample = (example: WorkflowDefinitionExamplePrompt) => {
    if (example.field === 'goal') {
      setGoal(example.text);
      return;
    }
    setSchemaInput({ ...value.schemaInput, [example.field]: example.text });
  };

  if (!hasSchemaForm) {
    return (
      <WorkflowArgFieldsForm
        workflowName={definition.name}
        language={language}
        argValues={value.argValues}
        onArgValuesChange={setArgValues}
        goal={value.goal}
        onGoalChange={setGoal}
        examplePrompts={examples}
        inputClassName={inputClassName}
        aiAssist={aiAssist ? {
          disabled: aiAssist.disabled,
          argScenario: aiAssist.inputScenario ?? 'workflow.arg',
          goalScenario: aiAssist.goalScenario ?? 'workflow.goal',
          context: {
            ...aiAssist.context,
            workflowId: definition.id,
            workflowName: definition.name,
            workflowTitle: definition.title,
            workflowDescription: localized.description,
          },
        } : undefined}
      />
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {definition.inputSchema ? (
        <WorkflowSchemaInputForm
          schema={definition.inputSchema}
          value={value.schemaInput}
          onChange={setSchemaInput}
          onValidChange={(valid, nextSchemaInput) => {
            setRawJsonValid(valid);
            onValidityChange?.(validateWorkflowInputEditorValue(
              definition,
              nextSchemaInput ? { ...value, schemaInput: nextSchemaInput } : value,
              valid,
            ));
          }}
          aiAssist={aiAssist ? {
            locale: language,
            disabled: aiAssist.disabled,
            scenario: aiAssist.inputScenario ?? 'workflow.arg',
            context: {
              ...aiAssist.context,
              workflowId: definition.id,
              workflowName: definition.name,
              workflowTitle: definition.title,
              workflowDescription: localized.description,
            },
          } : undefined}
          labels={{
            inputSchemaHeading: labels.inputSchemaHeading,
            rawJson: labels.rawJson,
            rawJsonInvalid: labels.rawJsonInvalid,
            booleanTrue: labels.booleanTrue,
            booleanFalse: labels.booleanFalse,
          }}
        />
      ) : null}

      <div className="flex flex-col gap-1">
        <span className="flex items-center justify-between gap-2">
          <span className="text-xs font-medium text-fg-muted">{labels.goalLabel}</span>
          {aiAssist ? (
            <AiTextAssistButton
              value={value.goal}
              onApply={setGoal}
              fieldId="workflow.goal"
              fieldLabel={labels.goalLabel}
              scenario={aiAssist.goalScenario ?? 'workflow.goal'}
              locale={language}
              context={{
                ...aiAssist.context,
                workflowId: definition.id,
                workflowName: definition.name,
                workflowTitle: definition.title,
                workflowDescription: localized.description,
                workflowInput: value.schemaInput,
              }}
              disabled={aiAssist.disabled}
              showLabel={false}
            />
          ) : null}
        </span>
        <textarea
          value={value.goal}
          onChange={(event) => setGoal(event.target.value)}
          placeholder={labels.goalPlaceholder}
          className={cn(fieldClass, 'min-h-20 resize-y')}
        />
      </div>

      <ExamplePromptList examples={examples} labels={labels} onSelect={applySchemaExample} />
    </div>
  );
}
