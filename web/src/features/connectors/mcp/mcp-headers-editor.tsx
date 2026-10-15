import { ClipboardPaste, Eye, EyeOff, Trash2 } from 'lucide-react';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { createMcpHeaderEntry, parseHeadersPaste, type McpHeaderEntry } from '@/features/connectors/mcp/mcp-headers-utils';
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
  pasteFailedTitle: string;
  dismissLabel: string;
  keyPlaceholder: string;
  valuePlaceholder: string;
  headers: McpHeaderEntry[];
  onChange: (headers: McpHeaderEntry[]) => void;
  referenceLabel?: string;
  showValueLabel?: string;
  hideValueLabel?: string;
  allowPaste?: boolean;
};

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
  pasteFailedTitle,
  dismissLabel,
  keyPlaceholder,
  valuePlaceholder,
  headers,
  onChange,
  referenceLabel = 'Existing credential reference',
  showValueLabel = 'Show value',
  hideValueLabel = 'Hide value',
  allowPaste = true,
}: Props) {
  const [visible, setVisible] = useState<ReadonlySet<string>>(new Set());
  const [pasteErrorOpen, setPasteErrorOpen] = useState(false);
  const updateRow = (index: number, patch: Partial<McpHeaderEntry>) => {
    onChange(headers.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  };

  const addRow = () => {
    onChange([...headers, createMcpHeaderEntry()]);
  };

  const removeRow = (index: number) => {
    const next = headers.filter((_, i) => i !== index);
    onChange(next.length > 0 ? next : [createMcpHeaderEntry()]);
  };

  const pasteFromClipboard = async () => {
    try {
      const text = await readTextFromClipboard();
      if (!text) {
        setPasteErrorOpen(true);
        return;
      }
      const parsed = parseHeadersPaste(text);
      if (!parsed?.length) {
        setPasteErrorOpen(true);
        return;
      }
      onChange(parsed);
    } catch {
      setPasteErrorOpen(true);
    }
  };

  return (
    <div className="flex flex-col gap-2 md:col-span-2">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-sm font-medium text-fg">
          <span>{label}</span>
          {optionalLabel ? <span className="font-normal text-fg-subtle">{optionalLabel}</span> : null}
        </div>
        {allowPaste ? <Button type="button" variant="ghost" className="h-8 gap-1.5 px-2 text-xs" onClick={() => void pasteFromClipboard()}>
          <ClipboardPaste className="size-3.5" aria-hidden />
          {pasteLabel}
        </Button> : null}
      </div>

      <div className="flex flex-col gap-2">
        {headers.map((row, index) => (
          <div key={row.clientKey} className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_auto_auto]">
            <input
              className={cn(inputClassName(), 'col-span-3 min-w-0 font-mono text-xs sm:col-span-1')}
              aria-label={`${keyPlaceholder} ${index + 1}`}
              value={row.key}
              placeholder={keyPlaceholder}
              onChange={(e) => updateRow(index, { key: e.target.value })}
            />
            <input
              className={cn(inputClassName(), 'min-w-0 font-mono text-xs')}
              type={visible.has(row.clientKey) ? 'text' : 'password'}
              autoComplete="off"
              aria-label={`${valuePlaceholder} ${index + 1}`}
              readOnly={Boolean(row.reference)}
              value={row.reference ? referenceLabel : row.value}
              placeholder={row.reference ? referenceLabel : valuePlaceholder}
              onChange={(e) => updateRow(index, { value: e.target.value })}
            />
            <Button type="button" variant="ghost" className="size-10 shrink-0 px-0"
              disabled={Boolean(row.reference)} aria-label={visible.has(row.clientKey) ? hideValueLabel : showValueLabel}
              onClick={() => setVisible(current => {
                const next = new Set(current);
                if (next.has(row.clientKey)) next.delete(row.clientKey); else next.add(row.clientKey);
                return next;
              })}>{visible.has(row.clientKey) ? <EyeOff className="size-4" aria-hidden /> : <Eye className="size-4" aria-hidden />}</Button>
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
            {row.reference ? <p className="col-span-3 break-words text-xs text-fg-muted sm:col-span-4">{referenceLabel}</p> : null}
          </div>
        ))}
      </div>

      <ConfirmDialog
        open={pasteErrorOpen}
        title={pasteFailedTitle}
        description={pasteFailed}
        confirmLabel={dismissLabel}
        onConfirm={() => setPasteErrorOpen(false)}
        onCancel={() => setPasteErrorOpen(false)}
      />

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
