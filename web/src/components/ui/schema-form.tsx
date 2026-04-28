import { useCallback, useMemo } from 'react';

import { cn } from '@/lib/cn';

export type JsonSchema = Record<string, unknown>;

type SchemaFormProps = {
  schema: JsonSchema;
  values: Record<string, unknown>;
  onChange: (values: Record<string, unknown>) => void;
  disabled?: boolean;
  className?: string;
};

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}

type FieldDef = {
  key: string;
  sub: JsonSchema;
  order: number;
  group: string;
  hidden: boolean;
};

function getXOrder(s: JsonSchema): number {
  const v = s['x-order'];
  return typeof v === 'number' && !Number.isNaN(v) ? v : 999;
}

function getXGroup(s: JsonSchema): string {
  const v = s['x-group'];
  return typeof v === 'string' && v.length > 0 ? v : '';
}

function isHidden(s: JsonSchema): boolean {
  return s['x-hidden'] === true;
}

function sortedFields(schema: JsonSchema): FieldDef[] {
  const props = schema.properties;
  if (!isRecord(props)) return [];
  const out: FieldDef[] = [];
  for (const [key, sub] of Object.entries(props)) {
    if (!isRecord(sub)) continue;
    if (isHidden(sub)) continue;
    out.push({
      key,
      sub: sub,
      order: getXOrder(sub),
      group: getXGroup(sub),
      hidden: false,
    });
  }
  out.sort((a, b) => a.order - b.order || a.key.localeCompare(b.key));
  return out;
}

function groupFields(fields: FieldDef[]): Map<string, FieldDef[]> {
  const m = new Map<string, FieldDef[]>();
  for (const f of fields) {
    const g = f.group;
    if (!m.has(g)) m.set(g, []);
    m.get(g)!.push(f);
  }
  return m;
}

function StringField({
  name,
  s,
  value,
  onChange,
  disabled,
}: {
  name: string;
  s: JsonSchema;
  value: string;
  onChange: (v: string) => void;
  disabled: boolean;
}) {
  const desc = typeof s.description === 'string' ? s.description : undefined;
  const placeholder =
    (typeof s['x-placeholder'] === 'string' ? s['x-placeholder'] : null) || desc;
  const fmt = s.format;
  if (Array.isArray(s.enum) && s.enum.every((x) => typeof x === 'string')) {
    return (
      <div className="flex flex-col gap-1.5">
        {desc ? <label className="text-xs text-fg-muted">{desc}</label> : null}
        <select
          name={name}
          className="ui-input h-9 rounded-md border border-edge bg-surface-base px-2 text-sm text-fg"
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
        >
          {(s.enum).map((op) => (
            <option key={op} value={op}>
              {op}
            </option>
          ))}
        </select>
      </div>
    );
  }
  const inputType = fmt === 'password' ? 'password' : 'text';
  return (
    <div className="flex flex-col gap-1.5">
      {desc ? <label className="text-xs text-fg-muted">{desc}</label> : null}
      <input
        name={name}
        type={inputType}
        className="ui-input h-9 rounded-md border border-edge bg-surface-base px-2.5 text-sm text-fg placeholder:text-fg-muted/70"
        value={value}
        placeholder={placeholder}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}

function NumberField({
  s,
  value,
  onChange,
  disabled,
}: {
  s: JsonSchema;
  value: number;
  onChange: (v: number) => void;
  disabled: boolean;
}) {
  const desc = typeof s.description === 'string' ? s.description : undefined;
  return (
    <div className="flex flex-col gap-1.5">
      {desc ? <label className="text-xs text-fg-muted">{desc}</label> : null}
      <input
        type="number"
        className="ui-input h-9 rounded-md border border-edge bg-surface-base px-2.5 text-sm text-fg"
        value={Number.isFinite(value) ? value : 0}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </div>
  );
}

function BooleanField({
  s,
  value,
  onChange,
  disabled,
}: {
  s: JsonSchema;
  value: boolean;
  onChange: (v: boolean) => void;
  disabled: boolean;
}) {
  const desc = typeof s.description === 'string' ? s.description : undefined;
  const labelText =
    desc ?? (typeof s.title === 'string' && s.title.length > 0 ? s.title : 'Enable');
  return (
    <label className="flex items-center gap-2 text-sm text-fg">
      <input
        type="checkbox"
        className="h-4 w-4 rounded border border-edge"
        checked={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span>{labelText}</span>
    </label>
  );
}

function ArrayStringField({
  s,
  value,
  onChange,
  disabled,
}: {
  s: JsonSchema;
  value: string[];
  onChange: (v: string[]) => void;
  disabled: boolean;
}) {
  const desc = typeof s.description === 'string' ? s.description : undefined;
  const items = s.items;
  const isStringItems = isRecord(items) && items.type === 'string';
  if (!isStringItems) {
    return <p className="text-xs text-fg-muted">Unsupported array type</p>;
  }
  const add = (t: string) => {
    const n = t.trim();
    if (!n || value.includes(n)) return;
    onChange([...value, n]);
  };
  return (
    <div className="flex flex-col gap-1.5">
      {desc ? <label className="text-xs text-fg-muted">{desc}</label> : null}
      <div className="flex flex-wrap gap-1">
        {value.map((t) => (
          <span
            key={t}
            className="inline-flex items-center gap-1 rounded-md border border-edge bg-surface-panel px-2 py-0.5 text-sm"
          >
            {t}
            <button
              type="button"
              className="text-fg-muted hover:text-fg"
              disabled={disabled}
              onClick={() => onChange(value.filter((x) => x !== t))}
            >
              ×
            </button>
          </span>
        ))}
      </div>
      <input
        className="ui-input h-9 rounded-md border border-edge bg-surface-base px-2.5 text-sm"
        disabled={disabled}
        placeholder="Add and press Enter"
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            add((e.target as HTMLInputElement).value);
            (e.target as HTMLInputElement).value = '';
          }
        }}
      />
    </div>
  );
}

function FieldRow({
  k,
  sub,
  value,
  onValue,
  disabled,
}: {
  k: string;
  sub: JsonSchema;
  value: unknown;
  onValue: (next: unknown) => void;
  disabled: boolean;
}) {
  const t = sub.type;
  const title =
    (typeof sub.title === 'string' && sub.title.length > 0 ? sub.title : null) ?? k;
  if (t === 'boolean') {
    return (
      <div className="space-y-1.5">
        <p className="text-sm font-medium text-fg">{title}</p>
        <BooleanField
          s={sub}
          value={value === true}
          disabled={disabled}
          onChange={(b) => onValue(b)}
        />
      </div>
    );
  }
  if (t === 'number' || t === 'integer') {
    return (
      <div className="space-y-1.5">
        <p className="text-sm font-medium text-fg">{title}</p>
        <NumberField
          s={sub}
          value={typeof value === 'number' ? value : 0}
          disabled={disabled}
          onChange={onValue}
        />
      </div>
    );
  }
  if (t === 'string') {
    return (
      <div className="space-y-1.5">
        <p className="text-sm font-medium text-fg">{title}</p>
        <StringField
          name={k}
          s={sub}
          value={typeof value === 'string' ? value : ''}
          disabled={disabled}
          onChange={onValue}
        />
      </div>
    );
  }
  if (t === 'array') {
    const items = sub.items;
    if (isRecord(items) && items.type === 'string') {
      return (
        <div className="space-y-1.5">
          <p className="text-sm font-medium text-fg">{title}</p>
          <ArrayStringField
            s={sub}
            value={Array.isArray(value) && value.every((x) => typeof x === 'string') ? value : []}
            disabled={disabled}
            onChange={onValue}
          />
        </div>
      );
    }
  }
  return (
    <p className="text-xs text-fg-muted">
      {title}: unsupported field type
      {typeof t === 'string' ? ` (${t})` : ''}
    </p>
  );
}

/**
 * Renders a JSON Schema (type: object) as a form using Gateway Console design tokens.
 */
export function SchemaForm({ schema, values, onChange, disabled = false, className }: SchemaFormProps) {
  const fields = useMemo(() => {
    if (schema.type !== 'object') return [];
    return sortedFields(schema);
  }, [schema]);

  const grouped = useMemo(() => {
    if (fields.length === 0) return new Map<string, FieldDef[]>();
    return groupFields(fields);
  }, [fields]);

  const setKey = useCallback(
    (key: string, next: unknown) => {
      onChange({ ...values, [key]: next });
    },
    [onChange, values],
  );

  if (schema.type !== 'object' || !isRecord(schema.properties) || fields.length === 0) {
    return null;
  }

  const groupKeys = Array.from(grouped.keys()).sort((a, b) => {
    if (a === '') return -1;
    if (b === '') return 1;
    return a.localeCompare(b);
  });

  return (
    <div className={cn('flex flex-col gap-4', className)}>
      {groupKeys.map((gk) => {
        const list = grouped.get(gk) ?? [];
        const block = list.map((f) => (
          <FieldRow
            key={f.key}
            k={f.key}
            sub={f.sub}
            value={values[f.key]}
            onValue={(v) => setKey(f.key, v)}
            disabled={disabled}
          />
        ));
        if (gk === '') {
          return <div key="default">{block}</div>;
        }
        return (
          <details
            key={gk}
            className="group rounded-lg border border-edge bg-surface-panel/40 open:bg-surface-base"
            open
          >
            <summary className="cursor-pointer select-none px-3 py-2 text-sm font-medium text-fg group-open:rounded-b-none">
              {gk}
            </summary>
            <div className="space-y-4 border-t border-edge p-3">{block}</div>
          </details>
        );
      })}
    </div>
  );
}

/** Extract per-key defaults from a JSON object schema for "Reset" actions. */
export function extractObjectDefaults(
  schema: JsonSchema,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (schema.type !== 'object' || !isRecord(schema.properties)) {
    return out;
  }
  for (const [k, sub] of Object.entries(schema.properties)) {
    if (!isRecord(sub)) continue;
    if (Object.prototype.hasOwnProperty.call(sub, 'default')) {
      out[k] = sub.default;
    }
  }
  return out;
}
