import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';

import { Button } from '@/components/ui/button';

import type { CapabilityPresetRow } from './capability-presets-api';

export type PresetAdvancedJsonFields = {
  mcp: string;
  workflows: string;
  boundaries: string;
  runtime: string;
  locks: string;
};

export type PresetAdvancedFieldKey = keyof PresetAdvancedJsonFields;

export function PresetAdvancedPolicyEditor(props: {
  extendsIds: string[];
  onExtendsChange: (ids: string[]) => void;
  presetOptions: CapabilityPresetRow[];
  jsonFields: PresetAdvancedJsonFields;
  onJsonFieldsChange: (fields: PresetAdvancedJsonFields) => void;
  disabled?: boolean;
  labels: {
    inheritanceTitle: string;
    inheritanceHint: string;
    inheritanceEmpty: string;
    inheritanceApplied: string;
    inheritanceAvailable: string;
    inheritanceAdd: string;
    inheritanceRemove: string;
    inheritanceMoveUp: string;
    inheritanceMoveDown: string;
    jsonTitle: string;
    jsonHint: string;
    fieldLabels: Record<PresetAdvancedFieldKey, string>;
    fieldHints: Record<PresetAdvancedFieldKey, string>;
  };
}) {
  const { extendsIds, onExtendsChange, presetOptions, jsonFields, onJsonFieldsChange, disabled, labels } = props;
  const fields = Object.keys(jsonFields) as PresetAdvancedFieldKey[];
  const presetById = new Map(presetOptions.map((preset) => [preset.id, preset]));
  const availablePresets = presetOptions.filter((preset) => !extendsIds.includes(preset.id));

  return (
    <div className="flex flex-col gap-6">
      <section>
        <h4 className="text-sm font-semibold text-fg">{labels.inheritanceTitle}</h4>
        <p className="mt-1 text-xs leading-relaxed text-fg-muted">{labels.inheritanceHint}</p>
        {extendsIds.length > 0 ? (
          <div className="mt-3">
            <div className="mb-2 text-xs font-medium text-fg-muted">{labels.inheritanceApplied}</div>
            <div className="grid gap-2">
              {extendsIds.map((presetId, index) => {
                const preset = presetById.get(presetId);
                return (
                  <div key={presetId} className="flex items-center gap-2 rounded-lg bg-surface-panel/70 px-3 py-2.5 shadow-surface">
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium text-fg">{preset?.name ?? presetId}</div>
                      <div className="mt-0.5 font-mono text-[11px] text-fg-subtle">{presetId}</div>
                    </div>
                    <Button
                      type="button"
                      variant="secondary"
                      className="size-8 p-0"
                      disabled={disabled || index === 0}
                      aria-label={labels.inheritanceMoveUp}
                      onClick={() => {
                        const next = [...extendsIds];
                        [next[index - 1], next[index]] = [next[index], next[index - 1]];
                        onExtendsChange(next);
                      }}
                    >
                      <ArrowUp className="size-3.5" aria-hidden />
                    </Button>
                    <Button
                      type="button"
                      variant="secondary"
                      className="size-8 p-0"
                      disabled={disabled || index === extendsIds.length - 1}
                      aria-label={labels.inheritanceMoveDown}
                      onClick={() => {
                        const next = [...extendsIds];
                        [next[index], next[index + 1]] = [next[index + 1], next[index]];
                        onExtendsChange(next);
                      }}
                    >
                      <ArrowDown className="size-3.5" aria-hidden />
                    </Button>
                    <Button
                      type="button"
                      variant="secondary"
                      className="size-8 p-0"
                      disabled={disabled}
                      aria-label={labels.inheritanceRemove}
                      onClick={() => onExtendsChange(extendsIds.filter((id) => id !== presetId))}
                    >
                      <Trash2 className="size-3.5" aria-hidden />
                    </Button>
                  </div>
                );
              })}
            </div>
          </div>
        ) : null}
        {availablePresets.length > 0 ? (
          <div className="mt-3">
            <div className="mb-2 text-xs font-medium text-fg-muted">{labels.inheritanceAvailable}</div>
            <div className="grid gap-2 sm:grid-cols-2">
              {availablePresets.map((preset) => (
                <div key={preset.id} className="flex items-center gap-2 rounded-lg bg-surface-panel/70 px-3 py-2.5 shadow-surface">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium text-fg">{preset.name}</div>
                    <div className="mt-0.5 font-mono text-[11px] text-fg-subtle">{preset.id}</div>
                  </div>
                  <Button
                    type="button"
                    variant="secondary"
                    className="size-8 p-0"
                    disabled={disabled}
                    aria-label={labels.inheritanceAdd}
                    onClick={() => onExtendsChange([...extendsIds, preset.id])}
                  >
                    <Plus className="size-3.5" aria-hidden />
                  </Button>
                </div>
              ))}
            </div>
          </div>
        ) : extendsIds.length === 0 ? (
          <p className="mt-3 text-sm text-fg-muted">{labels.inheritanceEmpty}</p>
        ) : null}
      </section>

      <section>
        <h4 className="text-sm font-semibold text-fg">{labels.jsonTitle}</h4>
        <p className="mt-1 text-xs leading-relaxed text-fg-muted">{labels.jsonHint}</p>
        <div className="mt-3 grid gap-4 lg:grid-cols-2">
          {fields.map((field) => (
            <label key={field} className="flex min-w-0 flex-col gap-1.5">
              <span className="text-sm font-medium text-fg">{labels.fieldLabels[field]}</span>
              <span className="min-h-8 text-xs leading-relaxed text-fg-muted">{labels.fieldHints[field]}</span>
              <textarea
                className="min-h-36 resize-y rounded-lg border border-edge bg-surface-base px-3 py-2 font-mono text-xs leading-relaxed text-fg placeholder:text-fg-subtle focus:border-edge-strong focus:outline-none"
                value={jsonFields[field]}
                disabled={disabled}
                spellCheck={false}
                placeholder="{}"
                onChange={(event) => onJsonFieldsChange({ ...jsonFields, [field]: event.target.value })}
              />
            </label>
          ))}
        </div>
      </section>
    </div>
  );
}
