import { useCallback, useMemo } from 'react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/cn';

import { BUILTIN_TOOL_UI_GROUPS, miscBuiltinToolIds, type BuiltinToolUiGroupKey } from './builtin-tool-disable-groups';
import { agentDefaultsQuickActionButtonClass } from './defaults-field-styles';

/** Preset ids are filtered against the live built-in list from the gateway. */
const PRESET_READ_ONLY_WORKSPACE = ['write_file', 'edit_file', 'shell'] as const;
const PRESET_HIGH_RISK = ['shell', 'image_generate', 'extensions'] as const;
const PRESET_NO_OUTBOUND = ['send_message', 'send_media'] as const;

export type BuiltinToolsDisableUiMode = 'defaults' | 'agentEntry';

export type BuiltinToolsDisableUiLabels = {
  loadingBuiltin: string;
  emptyBuiltin: string;
  quickActionsLabel: string;
  quickEnableAll: string;
  quickDisableAll: string;
  quickReadOnlyWorkspace: string;
  quickHighRiskOff: string;
  quickNoOutbound: string;
  notInBuiltin: string;
  lockedByDefaults: string;
};

export type BuiltinToolsDisableUiProps = {
  mode: BuiltinToolsDisableUiMode;
  builtinToolIds: string[];
  loading: boolean;
  /** Disabled tool ids for this config scope (defaults or agents.list entry). */
  disableSet: Set<string>;
  onDisableSetChange: (next: Set<string>) => void;
  /** For `agentEntry`: tools disabled in `agents.defaults` — cannot be enabled from the entry editor. */
  defaultsDisableSet?: Set<string>;
  /** Extra disable ids not in `builtinToolIds` (defaults editor only). */
  unknownDisabledIds?: string[];
  getToolDescription: (toolId: string) => string;
  getGroupTitle: (groupKey: BuiltinToolUiGroupKey) => string;
  labels: BuiltinToolsDisableUiLabels;
  quickActionsDisabled?: boolean;
};

export function BuiltinToolsDisableUi(props: BuiltinToolsDisableUiProps) {
  const {
    mode,
    builtinToolIds,
    loading,
    disableSet,
    onDisableSetChange,
    defaultsDisableSet,
    unknownDisabledIds = [],
    getToolDescription,
    getGroupTitle,
    labels,
    quickActionsDisabled = false,
  } = props;

  const allowedBuiltin = useMemo(() => new Set(builtinToolIds), [builtinToolIds]);
  const defaultsLock = defaultsDisableSet ?? new Set<string>();

  const setToolEnabled = useCallback(
    (tid: string, enabled: boolean) => {
      if (mode === 'agentEntry' && enabled && defaultsLock.has(tid)) {
        return;
      }
      const next = new Set(disableSet);
      if (enabled) {
        next.delete(tid);
      } else {
        next.add(tid);
      }
      onDisableSetChange(next);
    },
    [defaultsLock, disableSet, mode, onDisableSetChange],
  );

  const applyDisableExactly = useCallback(
    (ids: readonly string[]) => {
      const next = new Set<string>();
      for (const id of ids) {
        if (allowedBuiltin.has(id)) {
          next.add(id);
        }
      }
      onDisableSetChange(next);
    },
    [allowedBuiltin, onDisableSetChange],
  );

  const enableAllTools = useCallback(() => {
    onDisableSetChange(new Set());
  }, [onDisableSetChange]);

  const disableAllListed = useCallback(() => {
    const next = new Set<string>([...builtinToolIds, ...unknownDisabledIds]);
    onDisableSetChange(next);
  }, [builtinToolIds, unknownDisabledIds, onDisableSetChange]);

  const groupsContent = useMemo(() => {
    const misc = miscBuiltinToolIds(builtinToolIds);
    const sections: { key: BuiltinToolUiGroupKey; ids: string[] }[] = [];
    if (mode === 'defaults' && unknownDisabledIds.length > 0) {
      sections.push({ key: 'unknown', ids: unknownDisabledIds.toSorted((x, y) => x.localeCompare(y)) });
    }
    for (const g of BUILTIN_TOOL_UI_GROUPS) {
      const ids = g.toolIds.filter((id) => allowedBuiltin.has(id));
      if (ids.length > 0) {
        sections.push({ key: g.key, ids: [...ids] });
      }
    }
    if (misc.length > 0) {
      sections.push({ key: 'misc', ids: misc });
    }
    return sections;
  }, [allowedBuiltin, builtinToolIds, mode, unknownDisabledIds]);

  const hasRows = groupsContent.some((s) => s.ids.length > 0);
  const qaBusy = quickActionsDisabled || loading;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <p className="text-xs font-medium text-fg-muted">{labels.quickActionsLabel}</p>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="secondary"
            className={agentDefaultsQuickActionButtonClass}
            disabled={qaBusy || (builtinToolIds.length === 0 && unknownDisabledIds.length === 0)}
            onClick={enableAllTools}
          >
            {labels.quickEnableAll}
          </Button>
          <Button
            type="button"
            variant="secondary"
            className={agentDefaultsQuickActionButtonClass}
            disabled={qaBusy || (builtinToolIds.length === 0 && unknownDisabledIds.length === 0)}
            onClick={disableAllListed}
          >
            {labels.quickDisableAll}
          </Button>
          <Button
            type="button"
            variant="secondary"
            className={agentDefaultsQuickActionButtonClass}
            disabled={qaBusy || builtinToolIds.length === 0}
            onClick={() => applyDisableExactly(PRESET_READ_ONLY_WORKSPACE)}
          >
            {labels.quickReadOnlyWorkspace}
          </Button>
          <Button
            type="button"
            variant="secondary"
            className={agentDefaultsQuickActionButtonClass}
            disabled={qaBusy || builtinToolIds.length === 0}
            onClick={() => applyDisableExactly(PRESET_HIGH_RISK)}
          >
            {labels.quickHighRiskOff}
          </Button>
          <Button
            type="button"
            variant="secondary"
            className={agentDefaultsQuickActionButtonClass}
            disabled={qaBusy || builtinToolIds.length === 0}
            onClick={() => applyDisableExactly(PRESET_NO_OUTBOUND)}
          >
            {labels.quickNoOutbound}
          </Button>
        </div>
      </div>
      {loading ? (
        <p className="text-sm text-fg-muted">{labels.loadingBuiltin}</p>
      ) : !hasRows ? (
        <p className="text-sm text-fg-muted">{labels.emptyBuiltin}</p>
      ) : (
        <div className="max-h-[min(50vh,22rem)] overflow-y-auto overscroll-contain pr-0.5">
          <div className="flex flex-col gap-5 pr-1">
            {groupsContent.map(({ key: groupKey, ids }) => (
              <div key={groupKey}>
                <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-fg-muted">
                  {getGroupTitle(groupKey)}
                </h4>
                <ul className="flex flex-col gap-2.5">
                  {ids.map((tid) => {
                    const unknown = mode === 'defaults' && groupKey === 'unknown';
                    const lockedByDefault = mode === 'agentEntry' && defaultsLock.has(tid);
                    const disabledByScope = disableSet.has(tid);
                    const checked = lockedByDefault ? false : !disabledByScope;
                    const desc = getToolDescription(tid);
                    return (
                      <li
                        key={tid}
                        className={cn(
                          'rounded-xl border border-edge-subtle bg-surface-panel/60 px-3 py-2.5 dark:border-edge-subtle',
                          unknown && 'border-dashed',
                          lockedByDefault && 'opacity-60',
                        )}
                      >
                        <label
                          className={cn(
                            'flex gap-3 text-sm',
                            lockedByDefault ? 'cursor-not-allowed' : 'cursor-pointer',
                          )}
                        >
                          <input
                            type="checkbox"
                            className="mt-1 shrink-0 rounded border-edge"
                            checked={checked}
                            disabled={lockedByDefault || qaBusy}
                            onChange={() => setToolEnabled(tid, !checked)}
                          />
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                              <span className="font-mono text-xs font-medium text-fg">{tid}</span>
                              {unknown ? (
                                <span className="text-xs text-fg-muted">({labels.notInBuiltin})</span>
                              ) : null}
                              {lockedByDefault ? (
                                <span className="text-xs text-fg-muted">({labels.lockedByDefaults})</span>
                              ) : null}
                            </div>
                            {desc ? (
                              <p className="mt-1 text-xs leading-relaxed text-fg-muted">{desc}</p>
                            ) : null}
                          </div>
                        </label>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
