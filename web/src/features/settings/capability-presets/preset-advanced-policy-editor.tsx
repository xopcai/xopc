import { json } from '@codemirror/lang-json';
import { ArrowDown, ArrowUp, Trash2 } from 'lucide-react';
import { useState, type ReactNode } from 'react';

import { CodeEditor } from '@/components/codemirror/code-editor';
import { Button } from '@/components/ui/button';
import { Select, SelectOption } from '@/components/ui/popover-select';

import type {
  CapabilityPresetPolicyFields,
  CapabilityPresetRow,
  CapabilityPresetToolPolicy,
} from './capability-presets-api';

type AdvancedPolicy = {
  mcp?: NonNullable<NonNullable<CapabilityPresetPolicyFields['tools']>['mcp']>;
  workflows?: CapabilityPresetPolicyFields['workflows'];
  boundaries?: CapabilityPresetPolicyFields['boundaries'];
  runtime?: CapabilityPresetPolicyFields['runtime'];
  locks?: CapabilityPresetPolicyFields['locks'];
};

type Labels = {
  inheritanceTitle: string;
  inheritanceHint: string;
  inheritanceEmpty: string;
  inheritanceAvailable: string;
  inheritanceAdd: string;
  inheritanceRemove: string;
  inheritanceMoveUp: string;
  inheritanceMoveDown: string;
  compose: string;
  inherit: string;
  cancel: string;
  mcpTitle: string;
  mcpHint: string;
  noMcp: string;
  workflowsTitle: string;
  workflowsHint: string;
  defaultWorkflow: string;
  allowedWorkflows: string;
  runtimeTitle: string;
  runtimeHint: string;
  timeoutMinutes: string;
  maxTurns: string;
  maxFailures: string;
  maxCalls: string;
  boundariesTitle: string;
  boundariesHint: string;
  confirmRules: string;
  forbiddenRules: string;
  escalationRules: string;
  onePerLine: string;
  governanceTitle: string;
  governanceHint: string;
  locksLabel: string;
  rawTitle: string;
  rawHint: string;
  rawOpen: string;
  rawApply: string;
  rawInvalid: string;
  modeAllow: string;
  modeConfirm: string;
  modeDeny: string;
  readonlyOnly: string;
};

const JSON_LANGUAGE = json();

function lines(value: string): string[] | undefined {
  const items = value.split('\n').map((item) => item.trim()).filter(Boolean);
  return items.length ? items : undefined;
}

function joinLines(value: string[] | undefined): string {
  return value?.join('\n') ?? '';
}

function sourceLabel(sources: Record<string, string>, prefix: string, fallback: string): string {
  return Object.entries(sources).find(([path]) => path === prefix || path.startsWith(`${prefix}.`))?.[1] ?? fallback;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function isDraftSafePolicy(value: unknown): value is CapabilityPresetPolicyFields {
  if (!isObject(value)) return false;
  const objectFields = ['models', 'tools', 'skills', 'workflows', 'boundaries', 'runtime'] as const;
  if (objectFields.some((key) => value[key] !== undefined && !isObject(value[key]))) return false;
  if (value.extends !== undefined && !Array.isArray(value.extends)) return false;
  if (value.locks !== undefined && !Array.isArray(value.locks)) return false;
  const skills = value.skills as Record<string, unknown> | undefined;
  if (skills && ['allow', 'deny'].some((key) => skills[key] !== undefined && !Array.isArray(skills[key]))) return false;
  const workflows = value.workflows as Record<string, unknown> | undefined;
  if (workflows && ['allowed', 'suggested'].some((key) => workflows[key] !== undefined && !Array.isArray(workflows[key]))) return false;
  const boundaries = value.boundaries as Record<string, unknown> | undefined;
  if (boundaries && ['requiresConfirmation', 'forbidden', 'escalation'].some((key) => boundaries[key] !== undefined && !Array.isArray(boundaries[key]))) return false;
  return true;
}

export function PresetAdvancedPolicyEditor(props: {
  extendsIds: string[];
  onExtendsChange: (ids: string[]) => void;
  presetOptions: CapabilityPresetRow[];
  inherited?: CapabilityPresetPolicyFields;
  inheritedSources?: Record<string, string>;
  mcpServerIds: string[];
  mcpTools: Array<{ id: string; serverId: string; name: string; description: string; readOnly: boolean }>;
  workflows: Array<{ id: string; title: string; description: string }>;
  policy: AdvancedPolicy;
  onPolicyChange: (policy: AdvancedPolicy) => void;
  rawPolicy: CapabilityPresetPolicyFields;
  onRawPolicyChange: (policy: CapabilityPresetPolicyFields) => void;
  disabled?: boolean;
  labels: Labels;
}) {
  const {
    extendsIds,
    onExtendsChange,
    presetOptions,
    inherited,
    inheritedSources = {},
    mcpServerIds,
    mcpTools,
    workflows,
    policy,
    onPolicyChange,
    rawPolicy,
    onRawPolicyChange,
    disabled,
    labels,
  } = props;
  const [compose, setCompose] = useState(extendsIds.length > 1);
  const [rawOpen, setRawOpen] = useState(false);
  const [rawText, setRawText] = useState('');
  const [rawError, setRawError] = useState('');
  const mcp = policy.mcp ?? {};
  const workflowPolicy = policy.workflows ?? {};
  const boundaries = policy.boundaries ?? {};
  const runtime = policy.runtime ?? {};
  const locks = policy.locks ?? [];
  const serverIds = [...new Set([...mcpServerIds, ...Object.keys(mcp.servers ?? {})])].sort();
  const presetById = new Map(presetOptions.map((preset) => [preset.id, preset]));
  const availablePresets = presetOptions.filter((preset) => !extendsIds.includes(preset.id));

  const setField = <K extends keyof AdvancedPolicy>(key: K, value: AdvancedPolicy[K]) => {
    onPolicyChange({ ...policy, [key]: value });
  };
  const updateMcpServer = (serverId: string, mode: CapabilityPresetToolPolicy['mode'] | '') => {
    const servers = { ...(mcp.servers ?? {}) };
    if (!mode) delete servers[serverId];
    else servers[serverId] = { ...servers[serverId], mode };
    const next = compact({
      ...mcp,
      servers: Object.keys(servers).length ? servers : undefined,
      tools: Object.keys(mcp.tools ?? {}).length ? mcp.tools : undefined,
    });
    setField('mcp', next);
  };
  const updateMcpTool = (toolId: string, policy: CapabilityPresetToolPolicy | undefined) => {
    const tools = { ...(mcp.tools ?? {}) };
    if (policy) tools[toolId] = policy;
    else delete tools[toolId];
    setField('mcp', compact({
      ...mcp,
      servers: Object.keys(mcp.servers ?? {}).length ? mcp.servers : undefined,
      tools: Object.keys(tools).length ? tools : undefined,
    }));
  };
  const openRaw = () => {
    setRawText(JSON.stringify(rawPolicy, null, 2));
    setRawError('');
    setRawOpen(true);
  };
  const applyRaw = () => {
    try {
      const value = JSON.parse(rawText) as unknown;
      if (!isDraftSafePolicy(value)) throw new Error('invalid policy');
      onRawPolicyChange(value);
      setRawError('');
      setRawOpen(false);
    } catch {
      setRawError(labels.rawInvalid);
    }
  };

  return (
    <div className="flex flex-col gap-7">
      <section>
        <h4 className="text-sm font-semibold text-fg">{labels.inheritanceTitle}</h4>
        <p className="mt-1 text-xs leading-relaxed text-fg-muted">{labels.inheritanceHint}</p>
        {!compose ? (
          <div className="mt-3 flex flex-wrap items-end gap-2">
            <label className="min-w-64 flex-1 text-xs text-fg-muted">
              {labels.inheritanceAvailable}
              <Select value={extendsIds[0] ?? ''} disabled={disabled} onChange={(event) => onExtendsChange(event.target.value ? [event.target.value] : [])}>
                <SelectOption value="">{labels.inherit}</SelectOption>
                {presetOptions.map((preset) => <SelectOption key={preset.id} value={preset.id}>{preset.name}</SelectOption>)}
              </Select>
            </label>
            <Button type="button" variant="secondary" disabled={disabled} onClick={() => setCompose(true)}>{labels.compose}</Button>
          </div>
        ) : (
          <div className="mt-3 grid gap-2">
            {extendsIds.map((presetId, index) => (
              <div key={presetId} className="flex items-center gap-2 rounded-lg bg-surface-panel/70 px-3 py-2.5 shadow-surface">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium text-fg">{presetById.get(presetId)?.name ?? presetId}</div>
                  <div className="font-mono text-[11px] text-fg-subtle">{presetId}</div>
                </div>
                <Button type="button" variant="secondary" className="size-8 p-0" disabled={disabled || index === 0} aria-label={labels.inheritanceMoveUp} onClick={() => {
                  const next = [...extendsIds];
                  [next[index - 1], next[index]] = [next[index], next[index - 1]];
                  onExtendsChange(next);
                }}><ArrowUp className="size-3.5" /></Button>
                <Button type="button" variant="secondary" className="size-8 p-0" disabled={disabled || index === extendsIds.length - 1} aria-label={labels.inheritanceMoveDown} onClick={() => {
                  const next = [...extendsIds];
                  [next[index], next[index + 1]] = [next[index + 1], next[index]];
                  onExtendsChange(next);
                }}><ArrowDown className="size-3.5" /></Button>
                <Button type="button" variant="secondary" className="size-8 p-0" disabled={disabled} aria-label={labels.inheritanceRemove} onClick={() => onExtendsChange(extendsIds.filter((id) => id !== presetId))}><Trash2 className="size-3.5" /></Button>
              </div>
            ))}
            {availablePresets.length ? (
              <label className="text-xs text-fg-muted">
                {labels.inheritanceAdd}
                <Select value="" disabled={disabled} onChange={(event) => event.target.value && onExtendsChange([...extendsIds, event.target.value])}>
                  <SelectOption value="">{labels.inheritanceAvailable}</SelectOption>
                  {availablePresets.map((preset) => <SelectOption key={preset.id} value={preset.id}>{preset.name}</SelectOption>)}
                </Select>
              </label>
            ) : null}
          </div>
        )}
        {!presetOptions.length ? <p className="mt-3 text-sm text-fg-muted">{labels.inheritanceEmpty}</p> : null}
      </section>

      <PolicySection title={labels.mcpTitle} hint={labels.mcpHint} source={sourceLabel(inheritedSources, 'tools.mcp', labels.inherit)}>
        {serverIds.length ? <div className="grid gap-2">{serverIds.map((serverId) => (
          <details key={serverId} className="rounded-lg bg-surface-panel/70 px-3 py-2 shadow-surface">
            <summary className="grid cursor-pointer items-center gap-2 sm:grid-cols-[minmax(0,1fr)_12rem]">
              <span className="truncate font-mono text-xs text-fg">{serverId}</span>
              <Select value={mcp.servers?.[serverId]?.mode ?? ''} disabled={disabled} onClick={(event) => event.stopPropagation()} onChange={(event) => updateMcpServer(serverId, event.target.value as CapabilityPresetToolPolicy['mode'] | '')}>
              <SelectOption value="">{inherited?.tools?.mcp?.servers?.[serverId]?.mode ? `${labels.inherit} · ${inherited.tools.mcp.servers[serverId].mode}` : labels.inherit}</SelectOption>
                <SelectOption value="allow">{labels.modeAllow}</SelectOption>
                <SelectOption value="confirm">{labels.modeConfirm}</SelectOption>
                <SelectOption value="deny">{labels.modeDeny}</SelectOption>
              </Select>
            </summary>
            <div className="mt-3 grid gap-2 border-t border-edge-subtle pt-3">
              {mcp.servers?.[serverId] ? <label className="flex items-center gap-2 text-xs text-fg-muted">
                <input type="checkbox" checked={mcp.servers[serverId].scope === 'readonly'} disabled={disabled} onChange={(event) => {
                  const current = mcp.servers?.[serverId];
                  if (!current) return;
                  const servers = {
                    ...(mcp.servers ?? {}),
                    [serverId]: { ...current, scope: event.target.checked ? 'readonly' as const : undefined },
                  };
                  setField('mcp', compact({ ...mcp, servers }));
                }} />
                {labels.readonlyOnly}
              </label> : null}
              {mcpTools.filter((tool) => tool.serverId === serverId).map((tool) => {
                const policy = mcp.tools?.[tool.id];
                return <div key={tool.id} className="grid gap-2 rounded-lg bg-surface-base px-3 py-2 lg:grid-cols-[minmax(0,1fr)_11rem_8rem_8rem] lg:items-end">
                  <div className="min-w-0"><div className="truncate font-mono text-xs text-fg">{tool.name}</div><div className="truncate text-xs text-fg-muted">{tool.description}</div></div>
                  <Select value={policy?.mode ?? ''} disabled={disabled} onChange={(event) => {
                    const mode = event.target.value as CapabilityPresetToolPolicy['mode'] | '';
                    updateMcpTool(tool.id, mode ? { ...(policy ?? {}), mode } : undefined);
                  }}>
                    <SelectOption value="">{labels.inherit}</SelectOption>
                    <SelectOption value="allow">{labels.modeAllow}</SelectOption>
                    <SelectOption value="confirm">{labels.modeConfirm}</SelectOption>
                    <SelectOption value="deny">{labels.modeDeny}</SelectOption>
                  </Select>
                  <NumberField label={labels.maxCalls} value={policy?.limits?.maxCallsPerTurn} disabled={!policy || disabled} onChange={(value) => updateMcpTool(tool.id, policy ? { ...policy, limits: compact({ ...policy.limits, maxCallsPerTurn: value }) } : undefined)} />
                  <NumberField label={labels.timeoutMinutes} value={policy?.limits?.timeoutMs ? policy.limits.timeoutMs / 60_000 : undefined} disabled={!policy || disabled} onChange={(value) => updateMcpTool(tool.id, policy ? { ...policy, limits: compact({ ...policy.limits, timeoutMs: value ? value * 60_000 : undefined }) } : undefined)} />
                </div>;
              })}
            </div>
          </details>
        ))}</div> : <p className="text-sm text-fg-muted">{labels.noMcp}</p>}
      </PolicySection>

      <PolicySection title={labels.workflowsTitle} hint={labels.workflowsHint} source={sourceLabel(inheritedSources, 'workflows', labels.inherit)}>
        <label className="text-xs text-fg-muted">
          {labels.defaultWorkflow}
          <Select value={workflowPolicy.default ?? ''} disabled={disabled} onChange={(event) => setField('workflows', compact({ ...workflowPolicy, default: event.target.value || undefined }))}>
            <SelectOption value="">{inherited?.workflows?.default ? `${labels.inherit} · ${inherited.workflows.default}` : labels.inherit}</SelectOption>
            {workflows.map((workflow) => <SelectOption key={workflow.id} value={workflow.id}>{workflow.title}</SelectOption>)}
          </Select>
        </label>
        <div className="mt-3">
          <div className="mb-2 text-xs text-fg-muted">{labels.allowedWorkflows}</div>
          <div className="grid gap-2 sm:grid-cols-2">{workflows.map((workflow) => {
            const checked = workflowPolicy.allowed?.includes(workflow.id) ?? false;
            return <label key={workflow.id} className="flex gap-2 rounded-lg bg-surface-panel/70 px-3 py-2 text-sm text-fg">
              <input type="checkbox" checked={checked} disabled={disabled} onChange={() => {
                const allowed = new Set(workflowPolicy.allowed ?? []);
                if (checked) allowed.delete(workflow.id); else allowed.add(workflow.id);
                setField('workflows', compact({ ...workflowPolicy, allowed: allowed.size ? [...allowed].sort() : undefined }));
              }} />
              <span><span className="block font-medium">{workflow.title}</span><span className="text-xs text-fg-muted">{workflow.description}</span></span>
            </label>;
          })}</div>
        </div>
      </PolicySection>

      <PolicySection title={labels.runtimeTitle} hint={labels.runtimeHint} source={sourceLabel(inheritedSources, 'runtime', labels.inherit)}>
        <div className="grid gap-3 sm:grid-cols-3">
          <NumberField label={labels.timeoutMinutes} value={runtime.timeoutMs ? runtime.timeoutMs / 60_000 : undefined} placeholder={inherited?.runtime?.timeoutMs ? String(inherited.runtime.timeoutMs / 60_000) : undefined} disabled={disabled} onChange={(value) => setField('runtime', compact({ ...runtime, timeoutMs: value ? value * 60_000 : undefined }))} />
          <NumberField label={labels.maxTurns} value={runtime.maxTurns} placeholder={inherited?.runtime?.maxTurns ? String(inherited.runtime.maxTurns) : undefined} disabled={disabled} onChange={(value) => setField('runtime', compact({ ...runtime, maxTurns: value }))} />
          <NumberField label={labels.maxFailures} value={runtime.maxToolFailuresPerTurn} placeholder={inherited?.runtime?.maxToolFailuresPerTurn ? String(inherited.runtime.maxToolFailuresPerTurn) : undefined} disabled={disabled} onChange={(value) => setField('runtime', compact({ ...runtime, maxToolFailuresPerTurn: value }))} />
        </div>
      </PolicySection>

      <PolicySection title={labels.boundariesTitle} hint={labels.boundariesHint} source={sourceLabel(inheritedSources, 'boundaries', labels.inherit)}>
        <div className="grid gap-3 lg:grid-cols-3">
          {([
            ['requiresConfirmation', labels.confirmRules],
            ['forbidden', labels.forbiddenRules],
            ['escalation', labels.escalationRules],
          ] as const).map(([key, label]) => <label key={key} className="text-xs text-fg-muted">
            {label}
            <textarea className="mt-1 min-h-28 w-full resize-y rounded-lg border border-edge bg-surface-base px-3 py-2 text-sm text-fg" placeholder={labels.onePerLine} value={joinLines(boundaries[key])} disabled={disabled} onChange={(event) => setField('boundaries', compact({ ...boundaries, [key]: lines(event.target.value) }))} />
          </label>)}
        </div>
      </PolicySection>

      <details className="rounded-xl border border-edge-subtle bg-surface-panel/40 p-4">
        <summary className="cursor-pointer text-sm font-semibold text-fg">{labels.governanceTitle}</summary>
        <p className="mt-1 text-xs text-fg-muted">{labels.governanceHint}</p>
        <label className="mt-3 block text-xs text-fg-muted">
          {labels.locksLabel}
          <textarea className="mt-1 min-h-28 w-full resize-y rounded-lg border border-edge bg-surface-base px-3 py-2 font-mono text-xs text-fg" placeholder={labels.onePerLine} value={joinLines(locks)} disabled={disabled} onChange={(event) => setField('locks', lines(event.target.value))} />
        </label>
      </details>

      <section>
        <h4 className="text-sm font-semibold text-fg">{labels.rawTitle}</h4>
        <p className="mt-1 text-xs text-fg-muted">{labels.rawHint}</p>
        {!rawOpen ? <Button className="mt-3" type="button" variant="secondary" onClick={openRaw}>{labels.rawOpen}</Button> : (
          <div className="mt-3">
            <div className="h-72 overflow-hidden rounded-lg border border-edge bg-surface-base">
              <CodeEditor initialContent={rawText} onChange={setRawText} language={JSON_LANGUAGE} lineWrap />
            </div>
            {rawError ? <p className="mt-2 text-sm text-red-600 dark:text-red-400">{rawError}</p> : null}
            <div className="mt-2 flex gap-2">
              <Button type="button" onClick={applyRaw}>{labels.rawApply}</Button>
              <Button type="button" variant="secondary" onClick={() => setRawOpen(false)}>{labels.cancel}</Button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

function compact<T extends Record<string, unknown>>(value: T): T | undefined {
  const result = Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined));
  return Object.keys(result).length ? result as T : undefined;
}

function PolicySection(props: { title: string; hint: string; source: string; children: ReactNode }) {
  return <section>
    <div className="flex flex-wrap items-start justify-between gap-2">
      <div><h4 className="text-sm font-semibold text-fg">{props.title}</h4><p className="mt-1 text-xs text-fg-muted">{props.hint}</p></div>
      <span className="rounded-full bg-surface-panel px-2 py-0.5 text-[11px] text-fg-muted">{props.source}</span>
    </div>
    <div className="mt-3">{props.children}</div>
  </section>;
}

function NumberField(props: { label: string; value?: number; placeholder?: string; disabled?: boolean; onChange: (value?: number) => void }) {
  return <label className="text-xs text-fg-muted">{props.label}<input type="number" min={1} step={1} className="mt-1 w-full rounded-lg border border-edge bg-surface-base px-3 py-2 text-sm text-fg" value={props.value ?? ''} placeholder={props.placeholder} disabled={props.disabled} onChange={(event) => props.onChange(event.target.value ? Number(event.target.value) : undefined)} /></label>;
}
