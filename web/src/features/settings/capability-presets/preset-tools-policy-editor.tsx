import { useCallback, useMemo } from 'react';

import { Button } from '@/components/ui/button';
import { Select, SelectOption } from '@/components/ui/popover-select';
import type { CapabilityPresetToolPolicy } from '@/features/settings/capability-presets/capability-presets-api';
import {
  BUILTIN_TOOL_UI_GROUPS,
  miscBuiltinToolIds,
  type BuiltinToolUiGroupKey,
} from '@/features/settings/agents/builtin-tool-disable-groups';
import { agentDefaultsQuickActionButtonClass } from '@/features/settings/agents/defaults-field-styles';
import { cn } from '@/lib/cn';

export type PresetToolMode = 'allow' | 'confirm' | 'deny';
export type PresetToolPolicies = Record<string, CapabilityPresetToolPolicy>;

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
  modeConfirm: string;
  modeDeny: string;
  scopeLabel: string;
  scopeInherit: string;
  scopeReadonly: string;
  scopeWorkspace: string;
  scopeUnrestricted: string;
  maxCallsLabel: string;
  timeoutLabel: string;
};

const READ_ONLY_WORKSPACE_DENY = ['write_file', 'apply_patch', 'exec_command', 'execute_code'] as const;
const HIGH_RISK_DENY = ['exec_command', 'execute_code', 'automation', 'extensions', 'bundle-mcp', 'skill_manage'] as const;
const NO_OUTBOUND_DENY = ['send_message', 'send_media', 'text_to_speech', 'create_share'] as const;
const RESEARCH_ALLOW = ['read_file', 'list_dir', 'grep', 'find', 'web_search', 'web_fetch', 'web_extract'] as const;
const RESEARCH_DENY = [...READ_ONLY_WORKSPACE_DENY, ...NO_OUTBOUND_DENY] as const;
const CODING_ALLOW = ['read_file', 'write_file', 'apply_patch', 'list_dir', 'grep', 'find', 'web_search', 'web_fetch'] as const;
const CODING_DENY = ['send_message', 'send_media'] as const;

function applyModes(
  builtinSet: Set<string>,
  changes: ReadonlyArray<readonly [readonly string[], PresetToolMode]>,
): PresetToolPolicies {
  const next: PresetToolPolicies = {};
  for (const [ids, mode] of changes) {
    for (const id of ids) {
      if (builtinSet.has(id)) {
        next[id] = { mode };
      }
    }
  }
  return next;
}

export function PresetToolsPolicyEditor(props: {
  builtinToolIds: string[];
  toolPolicies: PresetToolPolicies;
  onChange: (next: PresetToolPolicies) => void;
  disabled?: boolean;
  getToolDescription: (toolId: string) => string;
  getGroupTitle: (groupKey: BuiltinToolUiGroupKey) => string;
  labels: PresetToolPolicyEditorLabels;
}) {
  const { builtinToolIds, toolPolicies, onChange, disabled, getToolDescription, getGroupTitle, labels } = props;
  const allowedBuiltin = useMemo(() => new Set(builtinToolIds), [builtinToolIds]);
  const overriddenEntries = useMemo(
    () =>
      Object.entries(toolPolicies)
        .filter(([id]) => allowedBuiltin.has(id))
        .toSorted(([a], [b]) => a.localeCompare(b)),
    [allowedBuiltin, toolPolicies],
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
      const next = { ...toolPolicies };
      if (mode === 'inherit') {
        delete next[toolId];
      } else {
        next[toolId] = { ...next[toolId], mode };
      }
      onChange(next);
    },
    [onChange, toolPolicies],
  );

  const updateToolPolicy = useCallback(
    (toolId: string, update: (current: CapabilityPresetToolPolicy) => CapabilityPresetToolPolicy) => {
      const current = toolPolicies[toolId];
      if (!current) return;
      onChange({ ...toolPolicies, [toolId]: update(current) });
    },
    [onChange, toolPolicies],
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

      <div className="rounded-lg bg-surface-panel/70 px-3 py-2 shadow-surface">
        <div className="text-xs font-medium text-fg-muted">{labels.overrideSummaryTitle}</div>
        {overriddenEntries.length > 0 ? (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {overriddenEntries.map(([id, policy]) => (
              <span
                key={id}
                className={cn(
                  'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-mono text-[11px]',
                  policy.mode === 'deny' && 'border-red-500/25 bg-red-500/10 text-red-700 dark:text-red-300',
                  policy.mode === 'confirm' && 'border-amber-500/25 bg-amber-500/10 text-amber-700 dark:text-amber-300',
                  policy.mode === 'allow' && 'border-accent/25 bg-accent/10 text-accent',
                )}
              >
                {id}
                <span className="font-sans opacity-80">
                  {policy.mode === 'allow' ? labels.modeAllow : policy.mode === 'confirm' ? labels.modeConfirm : labels.modeDeny}
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
                const policy = toolPolicies[toolId];
                const mode: PresetToolMode | 'inherit' = policy
                  ? policy.mode
                  : 'inherit';
                return (
                  <li
                    key={toolId}
                    className={cn(
                      'rounded-xl px-3 py-2.5 shadow-surface transition-colors',
                      mode === 'inherit'
                        ? 'bg-surface-panel/50'
                        : 'bg-surface-panel',
                    )}
                  >
                    <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
                      <div className="min-w-0">
                        <div className="font-mono text-xs font-medium text-fg">{toolId}</div>
                        {desc ? <p className="mt-1 text-xs leading-relaxed text-fg-muted">{desc}</p> : null}
                      </div>
                      <div className="inline-flex w-fit rounded-lg border border-edge-subtle bg-surface-base p-0.5">
                        {(['inherit', 'allow', 'confirm', 'deny'] as const).map((nextMode) => (
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
                                : nextMode === 'confirm'
                                  ? labels.modeConfirm
                                  : labels.modeDeny}
                          </button>
                        ))}
                      </div>
                    </div>
                    {policy ? (
                      <div className="mt-3 grid gap-2 border-t border-edge-subtle pt-3 sm:grid-cols-3 dark:border-edge">
                        <label className="flex flex-col gap-1 text-xs text-fg-muted">
                          {labels.scopeLabel}
                          <Select
                            value={policy.scope ?? ''}
                            disabled={disabled}
                            onChange={(event) => updateToolPolicy(toolId, (current) => {
                              const scope = event.target.value as CapabilityPresetToolPolicy['scope'] | '';
                              if (!scope) {
                                const { scope: _scope, ...rest } = current;
                                return rest;
                              }
                              return { ...current, scope };
                            })}
                          >
                            <SelectOption value="">{labels.scopeInherit}</SelectOption>
                            <SelectOption value="readonly">{labels.scopeReadonly}</SelectOption>
                            <SelectOption value="workspace">{labels.scopeWorkspace}</SelectOption>
                            <SelectOption value="unrestricted">{labels.scopeUnrestricted}</SelectOption>
                          </Select>
                        </label>
                        <PolicyNumberInput
                          label={labels.maxCallsLabel}
                          value={policy.limits?.maxCallsPerTurn}
                          disabled={disabled}
                          onChange={(value) => updateToolPolicy(toolId, (current) => withLimit(current, 'maxCallsPerTurn', value))}
                        />
                        <PolicyNumberInput
                          label={labels.timeoutLabel}
                          value={policy.limits?.timeoutMs}
                          disabled={disabled}
                          onChange={(value) => updateToolPolicy(toolId, (current) => withLimit(current, 'timeoutMs', value))}
                        />
                      </div>
                    ) : null}
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

function withLimit(
  policy: CapabilityPresetToolPolicy,
  key: 'maxCallsPerTurn' | 'timeoutMs',
  value: number | undefined,
): CapabilityPresetToolPolicy {
  const limits = { ...policy.limits };
  if (value === undefined) delete limits[key];
  else limits[key] = value;
  if (Object.keys(limits).length === 0) {
    const { limits: _limits, ...rest } = policy;
    return rest;
  }
  return { ...policy, limits };
}

function PolicyNumberInput(props: {
  label: string;
  value?: number;
  disabled?: boolean;
  onChange: (value: number | undefined) => void;
}) {
  return (
    <label className="flex flex-col gap-1 text-xs text-fg-muted">
      {props.label}
      <input
        type="number"
        min={1}
        step={1}
        className="rounded-lg border border-edge bg-surface-panel px-3 py-2 text-sm text-fg focus:border-edge-strong focus:outline-none"
        value={props.value ?? ''}
        disabled={props.disabled}
        onChange={(event) => {
          const value = event.target.value.trim();
          props.onChange(value ? Number(value) : undefined);
        }}
      />
    </label>
  );
}
