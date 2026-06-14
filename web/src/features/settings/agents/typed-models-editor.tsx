import { Plus, Trash2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { ModelSelector } from '@/features/chat/model/model-selector';
import type { ChatMessages } from '@/i18n/messages';

import { inputClassName } from './defaults-field-styles';
import type { AgentTypedModelRow } from './typed-models-lib';

export function TypedModelsEditor(props: {
  rows: AgentTypedModelRow[];
  onChange: (rows: AgentTypedModelRow[]) => void;
  disabled?: boolean;
  chat: ChatMessages;
  labels: {
    id: string;
    description: string;
    add: string;
    remove: string;
    idPlaceholder: string;
    descriptionPlaceholder: string;
  };
}) {
  const { rows, onChange, disabled, chat, labels } = props;

  const updateRow = (index: number, patch: Partial<AgentTypedModelRow>) => {
    const next = rows.map((row, i) => (i === index ? { ...row, ...patch } : row));
    onChange(next);
  };

  return (
    <div className="flex flex-col gap-3">
      {rows.map((row, idx) => (
        <div
          key={row.id || `typed-model-${row.model}-${row.description}`}
          className="grid gap-2 rounded-xl border border-edge-subtle bg-surface-panel/40 p-3 sm:grid-cols-[minmax(0,8rem)_minmax(0,1.2fr)_minmax(0,1fr)_auto] sm:items-start dark:border-edge-subtle"
        >
          <input
            type="text"
            className={inputClassName()}
            value={row.id}
            disabled={disabled}
            placeholder={labels.idPlaceholder}
            aria-label={labels.id}
            onChange={(e) => updateRow(idx, { id: e.target.value.toLowerCase() })}
          />
          <ModelSelector
            value={row.model}
            disabled={disabled}
            placeholder={chat.modelPlaceholder}
            searchPlaceholder={chat.modelSearchPlaceholder}
            noMatches={chat.modelNoMatches}
            onChange={(modelId) => updateRow(idx, { model: modelId })}
          />
          <input
            type="text"
            className={inputClassName()}
            value={row.description}
            disabled={disabled}
            placeholder={labels.descriptionPlaceholder}
            aria-label={labels.description}
            onChange={(e) => updateRow(idx, { description: e.target.value })}
          />
          <Button
            type="button"
            variant="secondary"
            className="shrink-0 sm:mt-0"
            disabled={disabled}
            aria-label={labels.remove}
            onClick={() => onChange(rows.filter((_, j) => j !== idx))}
          >
            <Trash2 className="size-4" strokeWidth={1.75} />
          </Button>
        </div>
      ))}
      <Button
        type="button"
        variant="secondary"
        className="w-fit gap-1.5"
        disabled={disabled}
        onClick={() => onChange([...rows, { id: '', description: '', model: '' }])}
      >
        <Plus className="size-4 shrink-0" strokeWidth={1.75} />
        {labels.add}
      </Button>
    </div>
  );
}
