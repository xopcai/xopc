import { Plus, Trash2 } from 'lucide-react';
import { useRef } from 'react';

import { Button } from '@/components/ui/button';
import { ModelSelector } from '@/features/chat/model/model-selector';
import type { ChatMessages } from '@/i18n/messages';

import { inputClassName } from './defaults-field-styles';
import type { AgentTypedModelRow } from './typed-models-lib';

const recommendedRoleIds = ['deep', 'fast', 'cheap', 'code', 'review'] as const;
type RecommendedRoleId = (typeof recommendedRoleIds)[number];

function isRecommendedRoleId(id: string): id is RecommendedRoleId {
  return (recommendedRoleIds as readonly string[]).includes(id);
}

export function TypedModelsEditor(props: {
  rows: AgentTypedModelRow[];
  onChange: (rows: AgentTypedModelRow[]) => void;
  disabled?: boolean;
  defaultRole?: string;
  chat: ChatMessages;
  labels: {
    id: string;
    description: string;
    add: string;
    remove: string;
    recommendedTitle: string;
    customTitle: string;
    defaultBadge: string;
    addPurpose: string;
    noCustomRoles: string;
    idPlaceholder: string;
    descriptionPlaceholder: string;
    roleNames: Record<RecommendedRoleId, string>;
    roleDescriptions: Record<RecommendedRoleId, string>;
  };
}) {
  const { rows, onChange, disabled, defaultRole, chat, labels } = props;
  const rowKeysRef = useRef<string[]>([]);
  const rowKeyCounterRef = useRef(0);

  while (rowKeysRef.current.length < rows.length) {
    rowKeysRef.current.push(`typed-model-row-${rowKeyCounterRef.current++}`);
  }
  if (rowKeysRef.current.length > rows.length) {
    rowKeysRef.current.length = rows.length;
  }

  const updateRow = (index: number, patch: Partial<AgentTypedModelRow>) => {
    const next = rows.map((row, i) => (i === index ? { ...row, ...patch } : row));
    onChange(next);
  };

  const removeRow = (index: number) => {
    rowKeysRef.current.splice(index, 1);
    onChange(rows.filter((_, j) => j !== index));
  };

  const addRow = (row: AgentTypedModelRow) => {
    rowKeysRef.current.push(`typed-model-row-${rowKeyCounterRef.current++}`);
    onChange([...rows, row]);
  };

  const firstConfiguredModel = rows.find((row) => row.model.trim())?.model ?? '';
  const annotatedRows = rows.map((row, index) => ({ row, index }));
  const recommendedRows = recommendedRoleIds
    .map((id) => annotatedRows.find((item) => item.row.id === id))
    .filter((item): item is { row: AgentTypedModelRow; index: number } => Boolean(item));
  const customRows = annotatedRows.filter((item) => !isRecommendedRoleId(item.row.id));
  const missingRecommendedRoleIds = recommendedRoleIds.filter(
    (id) => !rows.some((row) => row.id === id),
  );

  const renderRow = (
    item: { row: AgentTypedModelRow; index: number },
    options: { recommended: boolean },
  ) => {
    const { row, index } = item;
    const isDefault = row.id === defaultRole;
    const roleName = isRecommendedRoleId(row.id) ? labels.roleNames[row.id] : labels.id;
    const roleDescription = isRecommendedRoleId(row.id) ? labels.roleDescriptions[row.id] : '';

    return (
      <div
        key={rowKeysRef.current[index] ?? `typed-model-row-${index}`}
        className="grid gap-3 rounded-lg border border-edge-subtle bg-surface-panel/40 p-3 sm:grid-cols-[minmax(0,11rem)_minmax(0,1fr)_auto] sm:items-start dark:border-edge-subtle"
      >
        {options.recommended ? (
          <div className="min-w-0">
            <div className="flex min-w-0 items-center gap-2">
              <span className="truncate text-sm font-medium text-fg">{roleName}</span>
              {isDefault ? (
                <span className="shrink-0 rounded-full border border-accent/25 bg-accent/10 px-2 py-0.5 text-[11px] font-medium text-accent">
                  {labels.defaultBadge}
                </span>
              ) : null}
            </div>
            <div className="mt-1 truncate font-mono text-[11px] text-fg-subtle">{row.id}</div>
            {roleDescription ? (
              <div className="mt-1 line-clamp-2 text-xs text-fg-muted">{roleDescription}</div>
            ) : null}
          </div>
        ) : (
          <div className="min-w-0">
            <div className="mb-1 text-xs font-medium text-fg-muted">{labels.id}</div>
            <input
              type="text"
              className={inputClassName()}
              value={row.id}
              disabled={disabled}
              placeholder={labels.idPlaceholder}
              aria-label={labels.id}
              onChange={(e) => updateRow(index, { id: e.target.value.toLowerCase() })}
            />
          </div>
        )}
        <div className="grid min-w-0 gap-2">
          <ModelSelector
            value={row.model}
            disabled={disabled}
            placeholder={chat.modelPlaceholder}
            searchPlaceholder={chat.modelSearchPlaceholder}
            noMatches={chat.modelNoMatches}
            className="w-full max-w-none"
            contentAlign="start"
            onChange={(modelId) => updateRow(index, { model: modelId })}
          />
          <input
            type="text"
            className={inputClassName()}
            value={row.description}
            disabled={disabled}
            placeholder={labels.descriptionPlaceholder}
            aria-label={labels.description}
            onChange={(e) => updateRow(index, { description: e.target.value })}
          />
        </div>
        <Button
          type="button"
          variant="secondary"
          className="shrink-0 sm:mt-0"
          disabled={disabled || isDefault}
          aria-label={labels.remove}
          onClick={() => removeRow(index)}
        >
          <Trash2 className="size-4" strokeWidth={1.75} />
        </Button>
      </div>
    );
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <div className="text-xs font-medium uppercase tracking-wide text-fg-muted">
          {labels.recommendedTitle}
        </div>
        {recommendedRows.map((item) => renderRow(item, { recommended: true }))}
        {missingRecommendedRoleIds.length > 0 ? (
          <div className="flex flex-wrap gap-2 pt-1">
            {missingRecommendedRoleIds.map((id) => (
              <Button
                key={id}
                type="button"
                variant="secondary"
                className="h-8 gap-1.5 rounded-lg px-2.5 text-xs"
                disabled={disabled}
                onClick={() =>
                  addRow({
                    id,
                    description: labels.roleDescriptions[id],
                    model: firstConfiguredModel,
                  })
                }
              >
                <Plus className="size-3.5 shrink-0" strokeWidth={1.75} />
                {labels.addPurpose.replace('{name}', labels.roleNames[id])}
              </Button>
            ))}
          </div>
        ) : null}
      </div>
      <div className="flex flex-col gap-2">
        <div className="text-xs font-medium uppercase tracking-wide text-fg-muted">
          {labels.customTitle}
        </div>
        {customRows.length > 0 ? (
          customRows.map((item) => renderRow(item, { recommended: false }))
        ) : (
          <div className="rounded-lg border border-dashed border-edge-subtle px-3 py-2 text-sm text-fg-muted">
            {labels.noCustomRoles}
          </div>
        )}
      </div>
      <Button
        type="button"
        variant="secondary"
        className="w-fit gap-1.5"
        disabled={disabled}
        onClick={() => addRow({ id: '', description: '', model: firstConfiguredModel })}
      >
        <Plus className="size-4 shrink-0" strokeWidth={1.75} />
        {labels.add}
      </Button>
    </div>
  );
}
