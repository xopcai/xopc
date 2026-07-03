import { useMemo, useState } from 'react';

import { AiTextAssistButton } from '@/features/ai-assist/ai-text-assist-button';
import type { TextAssistScenario } from '@/features/ai-assist/ai-text-assist-api';
import { cn } from '@/lib/cn';

import type { JsonSchema } from './workflow-api';

export type SchemaInputValue = Record<string, unknown>;

export interface SchemaField {
  key: string;
  schema: JsonSchema;
  required: boolean;
}

export interface WorkflowSchemaAiAssistConfig {
  locale: string;
  disabled?: boolean;
  context?: Record<string, unknown>;
  scenario?: TextAssistScenario;
}

const inputClass =
  'mt-1.5 w-full rounded-xl border border-edge bg-surface-base px-3 py-2 text-sm text-fg outline-none placeholder:text-fg-subtle focus:border-accent focus:ring-2 focus:ring-accent/20';

export function supportsWorkflowSchemaForm(schema: JsonSchema | undefined): boolean {
  return Boolean(schema && schema.type === 'object' && schema.properties && !Array.isArray(schema.properties));
}

export function WorkflowSchemaInputForm({
  schema,
  value,
  onChange,
  labels,
  aiAssist,
  onValidChange,
}: {
  schema: JsonSchema;
  value: SchemaInputValue;
  onChange: (next: SchemaInputValue) => void;
  labels: {
    inputSchemaHeading: string;
    rawJson: string;
    rawJsonInvalid: string;
    booleanTrue: string;
    booleanFalse: string;
  };
  aiAssist?: WorkflowSchemaAiAssistConfig;
  onValidChange?: (valid: boolean, nextValue?: SchemaInputValue) => void;
}) {
  const fields = useMemo(() => schemaToFields(schema), [schema]);
  const [rawOpen, setRawOpen] = useState(false);
  const [rawText, setRawText] = useState(() => JSON.stringify(value, null, 2));
  const [rawError, setRawError] = useState<string | null>(null);

  if (fields.length === 0) return null;

  const setField = (key: string, next: unknown) => {
    const updated = { ...value, [key]: next };
    if (next === '' || next === undefined) delete updated[key];
    onChange(updated);
    if (rawOpen) setRawText(JSON.stringify(updated, null, 2));
  };

  const applyRawJson = (text: string) => {
    setRawText(text);
    try {
      const parsed = text.trim() ? JSON.parse(text) : {};
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        setRawError(labels.rawJsonInvalid);
        onValidChange?.(false);
        return;
      }
      setRawError(null);
      onChange(parsed as SchemaInputValue);
      onValidChange?.(true, parsed as SchemaInputValue);
    } catch {
      setRawError(labels.rawJsonInvalid);
      onValidChange?.(false);
    }
  };

  return (
    <section className="rounded-2xl border border-edge-subtle bg-surface-base/35 p-4">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold text-fg">{labels.inputSchemaHeading}</h3>
        <button
          type="button"
          className="text-xs font-medium text-accent-fg hover:underline"
          onClick={() => {
            const next = !rawOpen;
            setRawOpen(next);
            if (next) {
              setRawText(JSON.stringify(value, null, 2));
              setRawError(null);
              onValidChange?.(true);
            }
          }}
        >
          {labels.rawJson}
        </button>
      </div>

      {rawOpen ? (
        <div className="mt-3">
          <textarea
            value={rawText}
            onChange={(event) => applyRawJson(event.target.value)}
            spellCheck={false}
            className={cn(inputClass, 'min-h-40 font-mono text-xs leading-5')}
          />
          {rawError ? <p className="mt-1 text-xs text-red-600 dark:text-red-300">{rawError}</p> : null}
        </div>
      ) : (
        <div className="mt-3 grid gap-3">
          {fields.map((field) => (
            <SchemaFieldInput
              key={field.key}
              field={field}
              value={value[field.key]}
              labels={labels}
              aiAssist={aiAssist}
              allValues={value}
              onChange={(next) => setField(field.key, next)}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function SchemaFieldInput({
  field,
  value,
  labels,
  aiAssist,
  allValues,
  onChange,
}: {
  field: SchemaField;
  value: unknown;
  labels: { booleanTrue: string; booleanFalse: string };
  aiAssist?: WorkflowSchemaAiAssistConfig;
  allValues: SchemaInputValue;
  onChange: (next: unknown) => void;
}) {
  const title = field.schema.title || field.key;
  const description = typeof field.schema.description === 'string' ? field.schema.description : undefined;
  const type = Array.isArray(field.schema.type) ? field.schema.type[0] : field.schema.type;
  const enumValues = Array.isArray(field.schema.enum) ? field.schema.enum : [];
  const showAiAssist = Boolean(aiAssist) && !enumValues.length && (type === 'string' || !type);

  return (
    <div className="block">
      <span className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-fg">
          {String(title)}{field.required ? ' *' : ''}
        </span>
        {showAiAssist && aiAssist ? (
          <AiTextAssistButton
            value={typeof value === 'string' ? value : value == null ? '' : String(value)}
            onApply={onChange}
            fieldId={`workflow.schema.${field.key}`}
            fieldLabel={String(title)}
            scenario={aiAssist.scenario ?? 'workflow.arg'}
            locale={aiAssist.locale}
            context={{
              ...aiAssist.context,
              fieldKey: field.key,
              fieldSchema: field.schema,
              inputValues: allValues,
            }}
            disabled={aiAssist.disabled}
            showLabel={false}
          />
        ) : null}
      </span>
      {description ? <p className="mt-0.5 text-xs leading-5 text-fg-subtle">{description}</p> : null}
      {enumValues.length > 0 ? (
        <select value={value == null ? '' : String(value)} onChange={(event) => onChange(event.target.value)} className={inputClass}>
          <option value="" />
          {enumValues.map((item) => (
            <option key={String(item)} value={String(item)}>{String(item)}</option>
          ))}
        </select>
      ) : type === 'boolean' ? (
        <select
          value={typeof value === 'boolean' ? String(value) : ''}
          onChange={(event) => onChange(event.target.value === '' ? undefined : event.target.value === 'true')}
          className={inputClass}
        >
          <option value="" />
          <option value="true">{labels.booleanTrue}</option>
          <option value="false">{labels.booleanFalse}</option>
        </select>
      ) : type === 'number' || type === 'integer' ? (
        <input
          type="number"
          value={typeof value === 'number' || typeof value === 'string' ? String(value) : ''}
          onChange={(event) => onChange(event.target.value === '' ? undefined : Number(event.target.value))}
          className={inputClass}
        />
      ) : (
        <textarea
          value={typeof value === 'string' ? value : value == null ? '' : String(value)}
          onChange={(event) => onChange(event.target.value)}
          className={cn(inputClass, description && description.length > 80 ? 'min-h-20 resize-y' : 'min-h-10 resize-y')}
        />
      )}
    </div>
  );
}

export function schemaToFields(schema: JsonSchema): SchemaField[] {
  const properties = schema.properties ?? {};
  const required = new Set(schema.required ?? []);
  return Object.entries(properties).map(([key, fieldSchema]) => ({
    key,
    schema: fieldSchema,
    required: required.has(key),
  }));
}

export function validateWorkflowSchemaInput(schema: JsonSchema | undefined, value: SchemaInputValue): boolean {
  if (!supportsWorkflowSchemaForm(schema) || !schema) return true;
  return schemaToFields(schema).every((field) => {
    if (!field.required) return true;
    const raw = value[field.key];
    if (raw === undefined || raw === null) return false;
    return typeof raw === 'string' ? raw.trim().length > 0 : true;
  });
}
