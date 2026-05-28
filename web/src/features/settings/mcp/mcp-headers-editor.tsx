import { ClipboardPaste, Trash2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { parseHeadersPaste, type McpHeaderEntry } from '@/features/settings/mcp/mcp-headers-utils';
import { readTextFromClipboard } from '@/lib/copy-to-clipboard';
import { settingsInputFocusClass } from '@/lib/form-field-width';
import { cn } from '@/lib/cn';
import { interaction } from '@/lib/interaction';

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

function headerRowKey(row: McpHeaderEntry, index: number, all: McpHeaderEntry[]): string {
  const key = row.key.trim();
  if (key) return `key:${key}`;
  const value = row.value.trim();
  if (value) return `value:${value}`;
  const emptySlot = all.slice(0, index).filter((r) => !r.key.trim() && !r.value.trim()).length;
  return `empty:${emptySlot}`;
}

function inputClassName(): string {
  return cn(
    'w-full rounded-lg border border-edge bg-surface-panel px-3 py-2 text-sm text-fg',
    'placeholder:text-fg-subtle',
    settingsInputFocusClass,
  );
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
      const text = await readTextFromClipboard();
      if (!text) {
        window.alert(pasteFailed);
        return;
      }
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
          <div key={headerRowKey(row, index, headers)} className="flex items-center gap-2">
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
        className={cn('self-start text-sm text-accent hover:underline', interaction.press)}
        onClick={addRow}
      >
        + {addLabel}
      </button>
    </div>
  );
}
