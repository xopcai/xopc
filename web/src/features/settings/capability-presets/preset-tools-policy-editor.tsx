import { useCallback, useMemo } from 'react';

import { Button } from '@/components/ui/button';
import {
  BUILTIN_TOOL_UI_GROUPS,
  miscBuiltinToolIds,
  type BuiltinToolUiGroupKey,
} from '@/features/settings/agents/builtin-tool-disable-groups';
import { agentDefaultsQuickActionButtonClass } from '@/features/settings/agents/defaults-field-styles';
import { cn } from '@/lib/cn';

export type PresetToolMode = 'allow' | 'deny';
export type PresetToolModes = Record<string, PresetToolMode>;

type PresetToolPolicyEditorLabels = {
  quickActionsLabel: string;
  quickClearOverrides: string;
  quickReadOnlyWorkspace: string;
  quickHighRiskOff: string;
  quickNoOutbound: string;
  quickResearchMode: string;
  quickCodingMode: string;
  emptyBuiltin: string;
  overrideSummaryTitle: string;
  noOverrides: string;
  inheritedMode: string;
  modeAllow: string;
  modeDeny: string;
};

const READ_ONLY_WORKSPACE_DENY = ['write_file', 'edit_file', 'shell', 'execute_code'] as const;
const HIGH_RISK_DENY = ['shell', 'execute_code', 'cronjob', 'extensions', 'bundle-mcp', 'skill_manage'] as const;
const NO_OUTBOUND_DENY = ['send_message', 'send_media', 'text_to_speech', 'create_share'] as const;
const RESEARCH_ALLOW = ['read_file', 'list_dir', 'grep', 'find', 'web_search', 'web_fetch', 'web_extract'] as const;
const RESEARCH_DENY = [...READ_ONLY_WORKSPACE_DENY, ...NO_OUTBOUND_DENY] as const;
const CODING_ALLOW = ['read_file', 'write_file', 'edit_file', 'list_dir', 'grep', 'find', 'web_search', 'web_fetch'] as const;
const CODING_DENY = ['send_message', 'send_media'] as const;

function applyModes(
  builtinSet: Set<string>,
  changes: ReadonlyArray<readonly [readonly string[], PresetToolMode]>,
): PresetToolModes {
  const next: PresetToolModes = {};
  for (const [ids, mode] of changes) {
    for (const id of ids) {
      if (builtinSet.has(id)) {
        next[id] = mode;
      }
    }
  }
  return next;
}

export function PresetToolsPolicyEditor(props: {
  builtinToolIds: string[];
  toolModes: PresetToolModes;
  onChange: (next: PresetToolModes) => void;
  disabled?: boolean;
  getToolDescription: (toolId: string) => string;
  getGroupTitle: (groupKey: BuiltinToolUiGroupKey) => string;
  labels: PresetToolPolicyEditorLabels;
}) {
  const { builtinToolIds, toolModes, onChange, disabled, getToolDescription, getGroupTitle, labels } = props;
  const allowedBuiltin = useMemo(() => new Set(builtinToolIds), [builtinToolIds]);
  const overriddenEntries = useMemo(
    () =>
      Object.entries(toolModes)
        .filter(([id]) => allowedBuiltin.has(id))
        .toSorted(([a], [b]) => a.localeCompare(b)),
    [allowedBuiltin, toolModes],
  );

  const groupsContent = useMemo(() => {
    const sections: { key: BuiltinToolUiGroupKey; ids: string[] }[] = [];
    for (const group of BUILTIN_TOOL_UI_GROUPS) {
      const ids = group.toolIds.filter((id) => allowedBuiltin.has(id));
      if (ids.length > 0) {
        sections.push({ key: group.key, ids: [...ids] });
      }
    }
    const misc = miscBuiltinToolIds(builtinToolIds);
    if (misc.length > 0) {
      sections.push({ key: 'misc', ids: misc });
    }
    return sections;
  }, [allowedBuiltin, builtinToolIds]);

  const setToolMode = useCallback(
    (toolId: string, mode: PresetToolMode | 'inherit') => {
      const next = { ...toolModes };
      if (mode === 'inherit') {
        delete next[toolId];
      } else {
        next[toolId] = mode;
      }
      onChange(next);
    },
    [onChange, toolModes],
  );

  const applyPreset = useCallback(
    (changes: ReadonlyArray<readonly [readonly string[], PresetToolMode]>) => {
      onChange(applyModes(allowedBuiltin, changes));
    },
    [allowedBuiltin, onChange],
  );

  if (builtinToolIds.length === 0) {
    return <p className="text-sm text-fg-muted">{labels.emptyBuiltin}</p>;
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <p className="text-xs font-medium text-fg-muted">{labels.quickActionsLabel}</p>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="secondary"
            className={agentDefaultsQuickActionButtonClass}
            disabled={disabled}
            onClick={() => onChange({})}
          >
            {labels.quickClearOverrides}
          </Button>
          <Button
            type="button"
            variant="secondary"
            className={agentDefaultsQuickActionButtonClass}
            disabled={disabled}
            onClick={() => applyPreset([[READ_ONLY_WORKSPACE_DENY, 'deny']])}
          >
            {labels.quickReadOnlyWorkspace}
          </Button>
          <Button
            type="button"
            variant="secondary"
            className={agentDefaultsQuickActionButtonClass}
            disabled={disabled}
            onClick={() => applyPreset([[HIGH_RISK_DENY, 'deny']])}
          >
            {labels.quickHighRiskOff}
          </Button>
          <Button
            type="button"
            variant="secondary"
            className={agentDefaultsQuickActionButtonClass}
            disabled={disabled}
            onClick={() => applyPreset([[NO_OUTBOUND_DENY, 'deny']])}
          >
            {labels.quickNoOutbound}
          </Button>
          <Button
            type="button"
            variant="secondary"
            className={agentDefaultsQuickActionButtonClass}
            disabled={disabled}
            onClick={() =>
              applyPreset([
                [RESEARCH_ALLOW, 'allow'],
                [RESEARCH_DENY, 'deny'],
              ])
            }
          >
            {labels.quickResearchMode}
          </Button>
          <Button
            type="button"
            variant="secondary"
            className={agentDefaultsQuickActionButtonClass}
            disabled={disabled}
            onClick={() =>
              applyPreset([
                [CODING_ALLOW, 'allow'],
                [CODING_DENY, 'deny'],
              ])
            }
          >
            {labels.quickCodingMode}
          </Button>
        </div>
      </div>

      <div className="rounded-lg border border-edge-subtle bg-surface-panel/50 px-3 py-2">
        <div className="text-xs font-medium text-fg-muted">{labels.overrideSummaryTitle}</div>
        {overriddenEntries.length > 0 ? (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {overriddenEntries.map(([id, mode]) => (
              <span
                key={id}
                className={cn(
                  'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-mono text-[11px]',
                  mode === 'deny' && 'border-red-500/25 bg-red-500/10 text-red-700 dark:text-red-300',
                  mode === 'allow' && 'border-accent/25 bg-accent/10 text-accent',
                )}
              >
                {id}
                <span className="font-sans opacity-80">
                  {mode === 'allow' ? labels.modeAllow : labels.modeDeny}
                </span>
              </span>
            ))}
          </div>
        ) : (
          <p className="mt-1 text-sm text-fg-muted">{labels.noOverrides}</p>
        )}
      </div>

      <div className="flex flex-col gap-5">
        {groupsContent.map(({ key: groupKey, ids }) => (
          <div key={groupKey}>
            <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-fg-muted">
              {getGroupTitle(groupKey)}
            </h4>
            <ul className="flex flex-col gap-2.5">
              {ids.map((toolId) => {
                const desc = getToolDescription(toolId);
                const mode: PresetToolMode | 'inherit' = Object.prototype.hasOwnProperty.call(toolModes, toolId)
                  ? toolModes[toolId]
                  : 'inherit';
                return (
                  <li
                    key={toolId}
                    className={cn(
                      'rounded-xl border px-3 py-2.5 transition-colors dark:border-edge-subtle',
                      mode === 'inherit'
                        ? 'border-edge-subtle bg-surface-panel/40'
                        : 'border-edge bg-surface-panel',
                    )}
                  >
                    <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
                      <div className="min-w-0">
                        <div className="font-mono text-xs font-medium text-fg">{toolId}</div>
                        {desc ? <p className="mt-1 text-xs leading-relaxed text-fg-muted">{desc}</p> : null}
                      </div>
                      <div className="inline-flex w-fit rounded-lg border border-edge-subtle bg-surface-base p-0.5">
                        {(['inherit', 'allow', 'deny'] as const).map((nextMode) => (
                          <button
                            key={nextMode}
                            type="button"
                            className={cn(
                              'rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
                              mode === nextMode ? 'bg-surface-panel text-fg shadow-surface' : 'text-fg-muted hover:text-fg',
                            )}
                            disabled={disabled}
                            onClick={() => setToolMode(toolId, nextMode)}
                          >
                            {nextMode === 'inherit'
                              ? labels.inheritedMode
                              : nextMode === 'allow'
                                ? labels.modeAllow
                                : labels.modeDeny}
                          </button>
                        ))}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}
