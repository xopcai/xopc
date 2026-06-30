import { BookOpen } from 'lucide-react';
import { useMemo } from 'react';

import { Button } from '@/components/ui/button';
import { agentDefaultsQuickActionButtonClass } from '@/features/settings/agents/defaults-field-styles';
import type { SkillCatalogRow } from '@/features/settings/types/agent-gateway';
import { cn } from '@/lib/cn';

export type PresetSkillMode = 'inherit' | 'all' | 'allowlist' | 'denylist' | 'off';

type PresetSkillsPolicyEditorLabels = {
  modeLabel: string;
  modeInherit: string;
  modeAll: string;
  modeAllowlist: string;
  modeDenylist: string;
  modeOff: string;
  quickActionsLabel: string;
  quickSelectAll: string;
  quickClear: string;
  catalogLoading: string;
  emptyCatalog: string;
  noDescription: string;
  overrideSummaryTitle: string;
  inheritSummary: string;
  allSummary: string;
  offSummary: string;
  allowSummary: string;
  denySummary: string;
};

function skillId(row: SkillCatalogRow): string {
  return row.name || row.directoryId;
}

export function PresetSkillsPolicyEditor(props: {
  mode: PresetSkillMode;
  selected: Set<string>;
  catalog: SkillCatalogRow[];
  loading: boolean;
  disabled?: boolean;
  onModeChange: (mode: PresetSkillMode) => void;
  onSelectedChange: (next: Set<string>) => void;
  labels: PresetSkillsPolicyEditorLabels;
}) {
  const { mode, selected, catalog, loading, disabled, onModeChange, onSelectedChange, labels } = props;
  const selectable = mode === 'allowlist' || mode === 'denylist';
  const catalogIds = useMemo(() => catalog.map(skillId).filter(Boolean), [catalog]);

  const summary = (() => {
    if (mode === 'inherit') return labels.inheritSummary;
    if (mode === 'all') return labels.allSummary;
    if (mode === 'off') return labels.offSummary;
    const template = mode === 'allowlist' ? labels.allowSummary : labels.denySummary;
    return template.replace('{{count}}', String(selected.size));
  })();

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-lg border border-edge-subtle bg-surface-panel/50 px-3 py-2">
        <div className="flex items-center gap-2 text-xs font-medium text-fg-muted">
          <BookOpen className="size-3.5" aria-hidden />
          {labels.overrideSummaryTitle}
        </div>
        <p className="mt-1 text-sm text-fg">{summary}</p>
      </div>

      <div className="flex flex-col gap-1.5">
        <p className="text-xs font-medium text-fg-muted">{labels.modeLabel}</p>
        <div className="flex flex-wrap gap-2">
          {([
            ['inherit', labels.modeInherit],
            ['all', labels.modeAll],
            ['allowlist', labels.modeAllowlist],
            ['denylist', labels.modeDenylist],
            ['off', labels.modeOff],
          ] as const).map(([nextMode, label]) => (
            <button
              key={nextMode}
              type="button"
              className={cn(
                'rounded-lg border px-3 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
                mode === nextMode
                  ? 'border-accent/35 bg-accent-soft text-accent-fg'
                  : 'border-edge-subtle bg-surface-panel text-fg hover:border-edge hover:bg-surface-hover/55',
              )}
              disabled={disabled}
              onClick={() => onModeChange(nextMode)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {selectable ? (
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <p className="text-xs font-medium text-fg-muted">{labels.quickActionsLabel}</p>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="secondary"
                className={agentDefaultsQuickActionButtonClass}
                disabled={disabled || loading || catalogIds.length === 0}
                onClick={() => onSelectedChange(new Set(catalogIds))}
              >
                {labels.quickSelectAll}
              </Button>
              <Button
                type="button"
                variant="secondary"
                className={agentDefaultsQuickActionButtonClass}
                disabled={disabled || loading || selected.size === 0}
                onClick={() => onSelectedChange(new Set())}
              >
                {labels.quickClear}
              </Button>
            </div>
          </div>

          {loading ? (
            <p className="text-sm text-fg-muted">{labels.catalogLoading}</p>
          ) : catalog.length === 0 ? (
            <p className="text-sm text-fg-muted">{labels.emptyCatalog}</p>
          ) : (
            <ul className="flex flex-col gap-2.5 text-sm">
              {catalog.map((row) => {
                const id = skillId(row);
                const on = selected.has(id);
                const desc = typeof row.description === 'string' ? row.description.trim() : '';
                const descLine = desc || labels.noDescription;
                return (
                  <li
                    key={id}
                    className="h-16 shrink-0 overflow-hidden rounded-xl border border-edge-subtle bg-surface-panel/60 px-3 dark:border-edge-subtle"
                  >
                    <label className="flex h-full cursor-pointer items-center gap-3 text-sm">
                      <input
                        type="checkbox"
                        className="shrink-0 rounded border-edge"
                        checked={on}
                        disabled={disabled}
                        onChange={() => {
                          const next = new Set(selected);
                          if (on) {
                            next.delete(id);
                          } else {
                            next.add(id);
                          }
                          onSelectedChange(next);
                        }}
                        aria-label={id}
                      />
                      <div className="min-w-0 flex-1 overflow-hidden">
                        <div className="truncate font-mono text-xs font-medium text-fg" title={id}>
                          {id}
                        </div>
                        <p
                          className={cn(
                            'mt-0.5 truncate text-xs leading-tight text-fg-muted',
                            !desc && 'italic text-fg-subtle',
                          )}
                          title={descLine}
                        >
                          {descLine}
                        </p>
                      </div>
                    </label>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}
