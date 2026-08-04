import { ChevronDown, Plus, Trash2 } from 'lucide-react';
import { useRef } from 'react';

import { Button } from '@/components/ui/button';
import { PopoverSelect } from '@/components/ui/popover-select';
import { ModelSelector } from '@/features/chat/model/model-selector';
import { inputClassName } from '@/features/settings/agents/defaults-field-styles';
import type { AgentTypedModelRow } from '@/features/settings/agents/typed-models-lib';
import type { ChatMessages } from '@/i18n/messages';

const recommendedRoleIds = ['deep', 'fast', 'cheap', 'code', 'review'] as const;
type RecommendedRoleId = (typeof recommendedRoleIds)[number];

function isRecommendedRoleId(id: string): id is RecommendedRoleId {
  return (recommendedRoleIds as readonly string[]).includes(id);
}

type PresetModelsEditorLabels = {
  defaultTitle: string;
  defaultHint: string;
  defaultBadge: string;
  roleId: string;
  description: string;
  descriptionPlaceholder: string;
  primaryModel: string;
  fallbackModels: string;
  addFallback: string;
  removeFallback: string;
  fallbackPlaceholder: string;
  fallbackEmptyHint: string;
  moreSettings: string;
  otherRolesTitle: string;
  otherRolesHint: string;
  otherRolesEmpty: string;
  addTaskModel: string;
  customRole: string;
  removeRole: string;
  roleIdPlaceholder: string;
  roleNames: Record<RecommendedRoleId, string>;
  roleDescriptions: Record<RecommendedRoleId, string>;
};

export function PresetModelsEditor(props: {
  rows: AgentTypedModelRow[];
  onChange: (rows: AgentTypedModelRow[]) => void;
  disabled?: boolean;
  defaultRole?: string;
  chat: ChatMessages;
  labels: PresetModelsEditorLabels;
}) {
  const { rows, onChange, disabled, defaultRole, chat, labels } = props;
  const rowKeysRef = useRef<string[]>([]);
  const rowKeyCounterRef = useRef(0);

  while (rowKeysRef.current.length < rows.length) {
    rowKeysRef.current.push(`preset-model-row-${rowKeyCounterRef.current++}`);
  }
  if (rowKeysRef.current.length > rows.length) {
    rowKeysRef.current.length = rows.length;
  }

  const inferredDefaultRole = defaultRole
    ?? (rows.some((row) => row.id === 'deep') ? 'deep' : rows[0]?.id)
    ?? 'deep';
  const defaultIndex = rows.findIndex((row) => row.id === inferredDefaultRole);
  const defaultRow = defaultIndex >= 0 ? rows[defaultIndex] : undefined;
  const otherRows = rows
    .map((row, index) => ({ row, index }))
    .filter(({ index }) => index !== defaultIndex);

  const updateRow = (index: number, patch: Partial<AgentTypedModelRow>) => {
    onChange(rows.map((row, rowIndex) => rowIndex === index ? { ...row, ...patch } : row));
  };

  const setDefaultModel = (model: string) => {
    if (defaultIndex >= 0) {
      updateRow(defaultIndex, { model });
      return;
    }
    rowKeysRef.current.unshift(`preset-model-row-${rowKeyCounterRef.current++}`);
    onChange([
      {
        id: inferredDefaultRole,
        model,
        fallbacks: [],
        description: isRecommendedRoleId(inferredDefaultRole)
          ? labels.roleDescriptions[inferredDefaultRole]
          : '',
      },
      ...rows,
    ]);
  };

  const addFallback = (rowIndex: number) => {
    const row = rows[rowIndex];
    if (!row) return;
    updateRow(rowIndex, { fallbacks: [...(row.fallbacks ?? []), ''] });
  };

  const updateFallback = (rowIndex: number, fallbackIndex: number, model: string) => {
    const row = rows[rowIndex];
    if (!row) return;
    const fallbacks = [...(row.fallbacks ?? [])];
    fallbacks[fallbackIndex] = model;
    updateRow(rowIndex, { fallbacks });
  };

  const removeFallback = (rowIndex: number, fallbackIndex: number) => {
    const row = rows[rowIndex];
    if (!row) return;
    updateRow(rowIndex, {
      fallbacks: (row.fallbacks ?? []).filter((_, index) => index !== fallbackIndex),
    });
  };

  const removeRow = (index: number) => {
    rowKeysRef.current.splice(index, 1);
    onChange(rows.filter((_, rowIndex) => rowIndex !== index));
  };

  const addRole = (id: string) => {
    if (!id) return;
    const roleId = id === '__custom__' ? '' : id;
    rowKeysRef.current.push(`preset-model-row-${rowKeyCounterRef.current++}`);
    onChange([
      ...rows,
      {
        id: roleId,
        model: '',
        fallbacks: [],
        description: isRecommendedRoleId(roleId) ? labels.roleDescriptions[roleId] : '',
      },
    ]);
  };

  const missingRoleOptions = recommendedRoleIds
    .filter((id) => id !== inferredDefaultRole && !rows.some((row) => row.id === id))
    .map((id) => ({ value: id, label: labels.roleNames[id] }));
  const addRoleOptions = [
    ...missingRoleOptions,
    { value: '__custom__', label: labels.customRole },
  ];

  const renderFallbackSettings = (row: AgentTypedModelRow, rowIndex: number) => (
    <div className="grid gap-3 border-t border-edge-subtle pt-3 dark:border-edge">
      <div className="grid gap-1.5">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-medium text-fg-muted">{labels.fallbackModels}</span>
          <Button
            type="button"
            variant="secondary"
            className="h-7 gap-1 px-2 text-xs"
            disabled={disabled}
            onClick={() => addFallback(rowIndex)}
          >
            <Plus className="size-3.5" aria-hidden />
            {labels.addFallback}
          </Button>
        </div>
        {(row.fallbacks ?? []).length > 0 ? (
          <div className="grid gap-1.5">
            {(row.fallbacks ?? []).map((fallback, fallbackIndex) => (
              <div key={`${rowKeysRef.current[rowIndex]}-fallback-${fallbackIndex}`} className="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
                <ModelSelector
                  value={fallback}
                  disabled={disabled}
                  placeholder={labels.fallbackPlaceholder}
                  searchPlaceholder={chat.modelSearchPlaceholder}
                  noMatches={chat.modelNoMatches}
                  className="w-full max-w-none"
                  contentAlign="start"
                  onChange={(model) => updateFallback(rowIndex, fallbackIndex, model)}
                />
                <Button
                  type="button"
                  variant="secondary"
                  className="shrink-0 px-2"
                  disabled={disabled}
                  aria-label={labels.removeFallback}
                  onClick={() => removeFallback(rowIndex, fallbackIndex)}
                >
                  <Trash2 className="size-4" aria-hidden />
                </Button>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs leading-relaxed text-fg-subtle">{labels.fallbackEmptyHint}</p>
        )}
      </div>
      <label className="grid gap-1.5 text-xs font-medium text-fg-muted">
        {labels.description}
        <input
          type="text"
          className={inputClassName()}
          value={row.description}
          disabled={disabled}
          placeholder={labels.descriptionPlaceholder}
          onChange={(event) => updateRow(rowIndex, { description: event.target.value })}
        />
      </label>
    </div>
  );

  return (
    <div className="grid gap-5">
      <div className="rounded-xl border border-edge bg-surface-base p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h4 className="text-sm font-semibold text-fg">{labels.defaultTitle}</h4>
              <span className="rounded-full bg-accent/10 px-2 py-0.5 text-[11px] font-medium text-accent">
                {labels.defaultBadge}
              </span>
            </div>
            <p className="mt-1 text-xs leading-relaxed text-fg-muted">{labels.defaultHint}</p>
          </div>
          <span className="rounded-md bg-surface-panel px-2 py-1 font-mono text-[11px] text-fg-subtle">
            {labels.roleId}: {inferredDefaultRole}
          </span>
        </div>
        <div className="mt-4 grid gap-1.5">
          <span className="text-xs font-medium text-fg-muted">{labels.primaryModel}</span>
          <ModelSelector
            value={defaultRow?.model ?? ''}
            disabled={disabled}
            placeholder={chat.modelPlaceholder}
            searchPlaceholder={chat.modelSearchPlaceholder}
            noMatches={chat.modelNoMatches}
            className="w-full max-w-none"
            contentAlign="start"
            onChange={setDefaultModel}
          />
        </div>
        {defaultRow ? (
          <details className="group mt-3">
            <summary className="flex w-fit cursor-pointer list-none items-center gap-1.5 rounded-md text-xs font-medium text-fg-muted hover:text-fg">
              {labels.moreSettings}
              <ChevronDown className="size-3.5 transition-transform group-open:rotate-180" aria-hidden />
            </summary>
            <div className="mt-3">{renderFallbackSettings(defaultRow, defaultIndex)}</div>
          </details>
        ) : null}
      </div>

      <section>
        <div>
          <h4 className="text-sm font-semibold text-fg">{labels.otherRolesTitle}</h4>
          <p className="mt-1 text-xs leading-relaxed text-fg-muted">{labels.otherRolesHint}</p>
        </div>
        {otherRows.length > 0 ? (
          <div className="mt-3 grid gap-2">
            {otherRows.map(({ row, index }) => {
              const recommendedRoleId = isRecommendedRoleId(row.id) ? row.id : undefined;
              const roleName = recommendedRoleId ? labels.roleNames[recommendedRoleId] : labels.customRole;
              return (
                <div key={rowKeysRef.current[index]} className="rounded-lg border border-edge-subtle bg-surface-panel/60 p-3 dark:border-edge">
                  <div className="grid gap-3 md:grid-cols-[minmax(8rem,12rem)_minmax(0,1fr)] md:items-end">
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-fg">{roleName}</div>
                      {recommendedRoleId ? (
                        <div className="mt-1 font-mono text-[11px] text-fg-subtle">{row.id}</div>
                      ) : (
                        <label className="mt-1 grid gap-1 text-[11px] text-fg-muted">
                          {labels.roleId}
                          <input
                            type="text"
                            className={inputClassName()}
                            value={row.id}
                            disabled={disabled}
                            placeholder={labels.roleIdPlaceholder}
                            onChange={(event) => updateRow(index, { id: event.target.value.toLowerCase() })}
                          />
                        </label>
                      )}
                    </div>
                    <label className="grid min-w-0 gap-1.5 text-xs font-medium text-fg-muted">
                      {labels.primaryModel}
                      <ModelSelector
                        value={row.model}
                        disabled={disabled}
                        placeholder={chat.modelPlaceholder}
                        searchPlaceholder={chat.modelSearchPlaceholder}
                        noMatches={chat.modelNoMatches}
                        className="w-full max-w-none"
                        contentAlign="start"
                        onChange={(model) => updateRow(index, { model })}
                      />
                    </label>
                  </div>
                  <details className="group mt-3">
                    <summary className="flex w-fit cursor-pointer list-none items-center gap-1.5 text-xs font-medium text-fg-muted hover:text-fg">
                      {labels.moreSettings}
                      <ChevronDown className="size-3.5 transition-transform group-open:rotate-180" aria-hidden />
                    </summary>
                    <div className="mt-3">
                      {renderFallbackSettings(row, index)}
                      <div className="mt-3 flex justify-end">
                        <Button type="button" variant="secondary" disabled={disabled} onClick={() => removeRow(index)}>
                          <Trash2 className="size-4" aria-hidden />
                          {labels.removeRole}
                        </Button>
                      </div>
                    </div>
                  </details>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="mt-3 rounded-lg bg-surface-panel/60 px-3 py-2 text-sm text-fg-muted shadow-surface">
            {labels.otherRolesEmpty}
          </p>
        )}
        <PopoverSelect
          value=""
          options={addRoleOptions}
          placeholder={labels.addTaskModel}
          allowEmpty={false}
          disabled={disabled}
          triggerClassName="mt-3 w-fit"
          onChange={addRole}
        />
      </section>
    </div>
  );
}
