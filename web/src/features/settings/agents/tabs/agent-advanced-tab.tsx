import { AlertTriangle, ArrowDown, ArrowUp, ExternalLink, Plus, Sparkles, Trash2 } from 'lucide-react';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import type { GatewayAgentRow } from '@/features/settings/agents-admin-api';
import type { CapabilityPresetRow } from '@/features/settings/capability-presets/capability-presets-api';
import { SettingsFormSection, SettingsFormSectionHeader } from '@/features/settings/settings-form-section';
import type { AgentsSettingsMessages } from '@/i18n/messages';

import { AgentConfigInheritanceSummary } from '../agent-config-inheritance-summary';
import { AgentEffectiveCapabilityTab } from './agent-effective-capability-tab';

type AgentConfigSubtab = 'sources' | 'shared' | 'effective';

function AdvancedScroll({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pr-1">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-5 pb-6">{children}</div>
    </div>
  );
}

function ConfigSubtabButton({
  active,
  children,
  onClick,
}: {
  active: boolean;
  children: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        active
          ? 'rounded-md bg-accent-soft px-3 py-1.5 text-sm font-medium text-accent-fg'
          : 'rounded-md px-3 py-1.5 text-sm font-medium text-fg-muted hover:bg-surface-hover hover:text-fg'
      }
    >
      {children}
    </button>
  );
}

export function AgentConfigTab({
  a,
  selected,
  busy,
  defaultModel,
  defaultWorkspace,
  agentModel,
  agentWorkspace,
  capabilityPresets,
  defaultPresetId,
  onUpdateAgentExtends,
  onOpenCapabilityPreset,
}: {
  a: AgentsSettingsMessages;
  selected: GatewayAgentRow;
  busy: boolean;
  defaultModel: string;
  defaultWorkspace: string;
  agentModel: string;
  agentWorkspace: string;
  capabilityPresets: CapabilityPresetRow[];
  defaultPresetId?: string;
  onUpdateAgentExtends: (nextExtends: string[]) => void;
  onOpenCapabilityPreset: (presetId: string) => void;
}) {
  const [subtab, setSubtab] = useState<AgentConfigSubtab>('sources');

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-hidden">
      <div className="shrink-0 rounded-lg border border-edge bg-surface-panel p-1">
        <div className="flex flex-wrap gap-1">
          <ConfigSubtabButton active={subtab === 'sources'} onClick={() => setSubtab('sources')}>
            {a.configSubtabSources}
          </ConfigSubtabButton>
          <ConfigSubtabButton active={subtab === 'shared'} onClick={() => setSubtab('shared')}>
            {a.configSubtabShared}
          </ConfigSubtabButton>
          <ConfigSubtabButton active={subtab === 'effective'} onClick={() => setSubtab('effective')}>
            {a.configSubtabEffective}
          </ConfigSubtabButton>
        </div>
      </div>
      {subtab === 'sources' ? (
        <AgentConfigSourcesTab
          a={a}
          defaultModel={defaultModel}
          defaultWorkspace={defaultWorkspace}
          agentModel={agentModel}
          agentWorkspace={agentWorkspace}
        />
      ) : null}
      {subtab === 'shared' ? (
        <AgentSharedSettingsTab
          a={a}
          selected={selected}
          busy={busy}
          capabilityPresets={capabilityPresets}
          defaultPresetId={defaultPresetId}
          onUpdateAgentExtends={onUpdateAgentExtends}
          onOpenCapabilityPreset={onOpenCapabilityPreset}
        />
      ) : null}
      {subtab === 'effective' ? <AgentEffectiveConfigTab a={a} selected={selected} /> : null}
    </div>
  );
}

export function AgentConfigSourcesTab({
  a,
  defaultModel,
  defaultWorkspace,
  agentModel,
  agentWorkspace,
  onEditWorkspace,
}: {
  a: AgentsSettingsMessages;
  defaultModel: string;
  defaultWorkspace: string;
  agentModel: string;
  agentWorkspace: string;
  onEditWorkspace?: () => void;
}) {
  return (
    <AdvancedScroll>
      <AgentConfigInheritanceSummary
        a={a}
        defaultModel={defaultModel}
        defaultWorkspace={defaultWorkspace}
        agentModel={agentModel}
        agentWorkspace={agentWorkspace}
        onEditWorkspace={onEditWorkspace}
      />
    </AdvancedScroll>
  );
}

export function AgentSharedSettingsTab({
  a,
  selected,
  busy,
  capabilityPresets,
  defaultPresetId = 'default',
  onUpdateAgentExtends,
  onOpenCapabilityPreset,
}: {
  a: AgentsSettingsMessages;
  selected: GatewayAgentRow;
  busy: boolean;
  capabilityPresets: CapabilityPresetRow[];
  defaultPresetId?: string;
  onUpdateAgentExtends: (nextExtends: string[]) => void;
  onOpenCapabilityPreset: (presetId: string) => void;
}) {
  const presetById = new Map(capabilityPresets.map((preset) => [preset.id, preset]));
  const globalDefaultsPreset =
    presetById.get(defaultPresetId) ?? {
      id: defaultPresetId,
      name: a.capabilityPresetsGlobalDefault,
      description: a.capabilityPresetsGlobalDefaultHint,
    };
  const explicitPresetIds = selected.extends.filter((id) => id !== defaultPresetId);
  const availablePresetIds = capabilityPresets
    .map((preset) => preset.id)
    .filter((id) => id !== defaultPresetId && !explicitPresetIds.includes(id));
  const selectedPresetId = availablePresetIds[0] ?? '';

  return (
    <AdvancedScroll>
      <SettingsFormSection>
          <SettingsFormSectionHeader
            icon={Sparkles}
            title={a.capabilityPresetsTitle}
            subtitle={a.capabilityPresetsHint}
            trailing={
              <Button
                type="button"
                variant="secondary"
                className="text-xs"
                disabled={busy}
                onClick={() => onOpenCapabilityPreset('')}
              >
                <ExternalLink className="size-3.5" aria-hidden />
                {a.capabilityPresetsManage}
              </Button>
            }
          />
        <div className="flex flex-col gap-2">
          <div className="flex flex-col gap-2 rounded-lg border border-accent/25 bg-accent-soft/20 px-3 py-2 sm:flex-row sm:items-center sm:justify-between">
            <button
              type="button"
              className="min-w-0 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              onClick={() => onOpenCapabilityPreset(globalDefaultsPreset.id)}
            >
              <div className="flex min-w-0 items-center gap-2">
                <div className="truncate text-sm font-medium text-fg">
                  {globalDefaultsPreset.name || a.capabilityPresetsGlobalDefault}
                </div>
                <span className="shrink-0 rounded-full border border-accent/25 bg-accent/10 px-2 py-0.5 text-[11px] font-medium text-accent">
                  {a.capabilityPresetsGlobalDefault}
                </span>
              </div>
              <div className="mt-0.5 truncate font-mono text-[11px] text-fg-muted">
                {globalDefaultsPreset.id}
              </div>
              <div className="mt-1 line-clamp-2 text-xs text-fg-muted">
                {globalDefaultsPreset.description || a.capabilityPresetsGlobalDefaultHint}
              </div>
            </button>
          </div>
          {explicitPresetIds.length > 0 ? (
            explicitPresetIds.map((presetId, index) => {
              const preset = presetById.get(presetId);
              return (
                <div
                  key={presetId}
                  className="flex flex-col gap-2 rounded-lg border border-edge-subtle bg-surface-panel px-3 py-2 sm:flex-row sm:items-center sm:justify-between"
                >
                  <button
                    type="button"
                    className="min-w-0 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                    onClick={() => onOpenCapabilityPreset(presetId)}
                  >
                    <div className="truncate text-sm font-medium text-fg">{preset?.name ?? presetId}</div>
                    <div className="mt-0.5 truncate font-mono text-[11px] text-fg-muted">{presetId}</div>
                    {preset?.description ? (
                      <div className="mt-1 line-clamp-2 text-xs text-fg-muted">{preset.description}</div>
                    ) : null}
                  </button>
                  <div className="flex shrink-0 flex-wrap gap-1.5">
                    <Button
                      type="button"
                      variant="secondary"
                      className="size-8 rounded-lg p-0"
                      disabled={busy || index === 0}
                      aria-label={a.capabilityPresetMoveUp}
                      onClick={() => {
                        const next = [...explicitPresetIds];
                        [next[index - 1], next[index]] = [next[index], next[index - 1]];
                        onUpdateAgentExtends(next);
                      }}
                    >
                      <ArrowUp className="size-3.5" aria-hidden />
                    </Button>
                    <Button
                      type="button"
                      variant="secondary"
                      className="size-8 rounded-lg p-0"
                      disabled={busy || index === explicitPresetIds.length - 1}
                      aria-label={a.capabilityPresetMoveDown}
                      onClick={() => {
                        const next = [...explicitPresetIds];
                        [next[index], next[index + 1]] = [next[index + 1], next[index]];
                        onUpdateAgentExtends(next);
                      }}
                    >
                      <ArrowDown className="size-3.5" aria-hidden />
                    </Button>
                    <Button
                      type="button"
                      variant="secondary"
                      className="size-8 rounded-lg p-0"
                      disabled={busy}
                      aria-label={a.capabilityPresetRemove}
                      onClick={() => onUpdateAgentExtends(explicitPresetIds.filter((id) => id !== presetId))}
                    >
                      <Trash2 className="size-3.5" aria-hidden />
                    </Button>
                  </div>
                </div>
              );
            })
          ) : (
            <div className="rounded-lg border border-dashed border-edge-subtle px-3 py-3 text-sm text-fg-muted">
              {a.capabilityPresetsEmptyAdditional}
            </div>
          )}
        </div>
        {availablePresetIds.length > 0 ? (
          <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
            <select
              className="min-w-0 flex-1 rounded-lg border border-edge bg-surface-panel px-3 py-2 text-sm text-fg focus:border-edge-strong focus:outline-none"
              disabled={busy}
              defaultValue={selectedPresetId}
            >
              {availablePresetIds.map((presetId) => (
                <option key={presetId} value={presetId}>
                  {presetById.get(presetId)?.name ?? presetId}
                </option>
              ))}
            </select>
            <Button
              type="button"
              variant="secondary"
              disabled={busy || !selectedPresetId}
              onClick={(event) => {
                const select = event.currentTarget.parentElement?.querySelector('select');
                const presetId = select?.value || selectedPresetId;
                if (presetId) onUpdateAgentExtends([...explicitPresetIds, presetId]);
              }}
            >
              <Plus className="size-4" aria-hidden />
              {a.capabilityPresetAdd}
            </Button>
          </div>
        ) : null}
      </SettingsFormSection>
    </AdvancedScroll>
  );
}

export function AgentEffectiveConfigTab({ a, selected }: { a: AgentsSettingsMessages; selected: GatewayAgentRow }) {
  return (
    <AdvancedScroll>
      <AgentEffectiveCapabilityTab a={a} selected={selected} />
    </AdvancedScroll>
  );
}

export function AgentDangerZoneTab({
  a,
  selected,
  busy,
  onDelete,
}: {
  a: AgentsSettingsMessages;
  selected: GatewayAgentRow;
  busy: boolean;
  onDelete: (purge: boolean) => void;
}) {
  return (
    <AdvancedScroll>
      {selected.id !== 'main' ? (
        <SettingsFormSection className="border border-red-200/70 bg-red-50/60 dark:border-red-900/50 dark:bg-red-950/25">
          <SettingsFormSectionHeader
            icon={AlertTriangle}
            title={a.dangerZoneTitle}
            subtitle={a.dangerZoneHint}
          />
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="max-w-xl text-sm text-red-800 dark:text-red-200">
              {a.dangerZoneBody}
            </p>
            <div className="flex shrink-0 flex-wrap gap-2">
              <Button type="button" variant="secondary" disabled={busy} onClick={() => void onDelete(false)}>
                <Trash2 className="mr-1 size-4" aria-hidden />
                {a.removeFromConfig}
              </Button>
              <Button
                type="button"
                variant="secondary"
                className="border-red-200 text-red-700 hover:bg-red-100 dark:border-red-900/60 dark:text-red-300 dark:hover:bg-red-950/50"
                disabled={busy}
                onClick={() => void onDelete(true)}
              >
                {a.purgeDisk}
              </Button>
            </div>
          </div>
        </SettingsFormSection>
      ) : (
        <SettingsFormSection>
          <SettingsFormSectionHeader
            icon={AlertTriangle}
            title={a.dangerZoneTitle}
            subtitle={a.dangerZoneMainUnavailable}
          />
        </SettingsFormSection>
      )}
    </AdvancedScroll>
  );
}
