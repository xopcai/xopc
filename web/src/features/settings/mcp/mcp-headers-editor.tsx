import { ClipboardPaste, Trash2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { settingsInputFocusClass } from '@/lib/form-field-width';
import { cn } from '@/lib/cn';

export type McpHeaderEntry = {
  key: string;
  value: string;
};

type Props = {
  label: string;
  optionalLabel?: string;
  addLabel: string;
  removeHeaderAria: string;
  pasteLabel: string;
  pasteFailed: string;
  keyPlaceholder: string;
  valuePlaceholder: string;
  headers: McpHeaderEntry[];
  onChange: (headers: McpHeaderEntry[]) => void;
};

function inputClassName(): string {
  return cn(
    'w-full rounded-lg border border-edge bg-surface-panel px-3 py-2 text-sm text-fg',
    'placeholder:text-fg-subtle',
    settingsInputFocusClass,
  );
}

export function parseHeadersPaste(text: string): McpHeaderEntry[] | null {
  const trimmed = text.trim();
  if (!trimmed) return null;

  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return Object.entries(parsed as Record<string, unknown>).map(([key, value]) => ({
        key,
        value: value == null ? '' : String(value),
      }));
    }
  } catch {
    // fall through to line parsing
  }

  const rows: McpHeaderEntry[] = [];
  for (const line of trimmed.split(/\r?\n/)) {
    const row = line.trim();
    if (!row) continue;
    const colon = row.indexOf(':');
    if (colon > 0) {
      rows.push({
        key: row.slice(0, colon).trim(),
        value: row.slice(colon + 1).trim(),
      });
      continue;
    }
    const eq = row.indexOf('=');
    if (eq > 0) {
      rows.push({
        key: row.slice(0, eq).trim(),
        value: row.slice(eq + 1).trim(),
      });
    }
  }
  return rows.length > 0 ? rows : null;
}

export function headersToRecord(headers: McpHeaderEntry[]): Record<string, string> | undefined {
  const out: Record<string, string> = {};
  for (const row of headers) {
    const key = row.key.trim();
    if (!key) continue;
    out[key] = row.value;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

export function recordToHeaders(record: Record<string, unknown> | undefined): McpHeaderEntry[] {
  if (!record || typeof record !== 'object') {
    return [{ key: '', value: '' }];
  }
  const rows = Object.entries(record).map(([key, value]) => ({
    key,
    value: value == null ? '' : String(value),
  }));
  return rows.length > 0 ? rows : [{ key: '', value: '' }];
}

export function McpHeadersEditor({
  label,
  optionalLabel,
  addLabel,
  removeHeaderAria,
  pasteLabel,
  pasteFailed,
  keyPlaceholder,
  valuePlaceholder,
  headers,
  onChange,
}: Props) {
  const updateRow = (index: number, patch: Partial<McpHeaderEntry>) => {
    onChange(headers.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  };

  const addRow = () => {
    onChange([...headers, { key: '', value: '' }]);
  };

  const removeRow = (index: number) => {
    const next = headers.filter((_, i) => i !== index);
    onChange(next.length > 0 ? next : [{ key: '', value: '' }]);
  };

  const pasteFromClipboard = async () => {
    try {
      const text = await navigator.clipboard.readText();
      const parsed = parseHeadersPaste(text);
      if (!parsed?.length) {
        window.alert(pasteFailed);
        return;
      }
      onChange(parsed);
    } catch {
      window.alert(pasteFailed);
    }
  };

  return (
    <div className="flex flex-col gap-2 md:col-span-2">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-sm font-medium text-fg">
          <span>{label}</span>
          {optionalLabel ? <span className="font-normal text-fg-subtle">{optionalLabel}</span> : null}
        </div>
        <Button type="button" variant="ghost" className="h-8 gap-1.5 px-2 text-xs" onClick={() => void pasteFromClipboard()}>
          <ClipboardPaste className="size-3.5" aria-hidden />
          {pasteLabel}
        </Button>
      </div>

      <div className="flex flex-col gap-2">
        {headers.map((row, index) => (
          <div key={`header-${index}`} className="flex items-center gap-2">
            <input
              className={cn(inputClassName(), 'min-w-0 flex-1 font-mono text-xs')}
              value={row.key}
              placeholder={keyPlaceholder}
              onChange={(e) => updateRow(index, { key: e.target.value })}
            />
            <input
              className={cn(inputClassName(), 'min-w-0 flex-[1.4] font-mono text-xs')}
              value={row.value}
              placeholder={valuePlaceholder}
              onChange={(e) => updateRow(index, { value: e.target.value })}
            />
            <Button
              type="button"
              variant="ghost"
              className="size-9 shrink-0 px-0"
              disabled={headers.length <= 1 && !row.key && !row.value}
              onClick={() => removeRow(index)}
              aria-label={removeHeaderAria}
            >
              <Trash2 className="size-4 text-fg-subtle" aria-hidden />
            </Button>
          </div>
        ))}
      </div>

      <button
        type="button"
        className="self-start text-sm text-accent hover:underline"
        onClick={addRow}
      >
        + {addLabel}
      </button>
    </div>
  );
}
