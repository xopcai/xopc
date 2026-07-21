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
    jsonTitle: string;
    jsonHint: string;
    fieldLabels: Record<PresetAdvancedFieldKey, string>;
    fieldHints: Record<PresetAdvancedFieldKey, string>;
  };
}) {
  const { extendsIds, onExtendsChange, presetOptions, jsonFields, onJsonFieldsChange, disabled, labels } = props;
  const fields = Object.keys(jsonFields) as PresetAdvancedFieldKey[];

  return (
    <div className="flex flex-col gap-6">
      <section>
        <h4 className="text-sm font-semibold text-fg">{labels.inheritanceTitle}</h4>
        <p className="mt-1 text-xs leading-relaxed text-fg-muted">{labels.inheritanceHint}</p>
        {presetOptions.length > 0 ? (
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {presetOptions.map((preset) => {
              const checked = extendsIds.includes(preset.id);
              return (
                <label
                  key={preset.id}
                  className="flex cursor-pointer items-start gap-2 rounded-lg bg-surface-panel/70 px-3 py-2.5 shadow-surface"
                >
                  <input
                    type="checkbox"
                    className="mt-0.5 shrink-0 rounded border-edge"
                    checked={checked}
                    disabled={disabled}
                    onChange={() =>
                      onExtendsChange(
                        checked ? extendsIds.filter((id) => id !== preset.id) : [...extendsIds, preset.id],
                      )
                    }
                  />
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium text-fg">{preset.name}</span>
                    <span className="mt-0.5 block font-mono text-[11px] text-fg-subtle">{preset.id}</span>
                  </span>
                </label>
              );
            })}
          </div>
        ) : (
          <p className="mt-3 text-sm text-fg-muted">{labels.inheritanceEmpty}</p>
        )}
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
