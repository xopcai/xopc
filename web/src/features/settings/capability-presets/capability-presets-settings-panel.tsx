import * as Dialog from '@radix-ui/react-dialog';
import {
  Copy,
  Eye,
  Layers,
  Plus,
  Puzzle,
  Save,
  Trash2,
  Wrench,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import useSWR from 'swr';

import { Button } from '@/components/ui/button';
import { fetchSkillsCatalog } from '@/features/settings/agents-admin-api';
import type { BuiltinToolUiGroupKey } from '@/features/settings/agents/builtin-tool-disable-groups';
import { TypedModelsEditor } from '@/features/settings/agents/typed-models-editor';
import {
  cleanTypedModelsForPatch,
  typedModelsRowsFromList,
  validateTypedModelsForSave,
  type AgentTypedModelRow,
} from '@/features/settings/agents/typed-models-lib';
import {
  createCapabilityPreset,
  deleteCapabilityPreset,
  fetchCapabilityPresets,
  updateCapabilityPreset,
  type CapabilityPresetRow,
} from '@/features/settings/capability-presets/capability-presets-api';
import {
  PresetSkillsPolicyEditor,
  type PresetSkillMode,
} from '@/features/settings/capability-presets/preset-skills-policy-editor';
import { PresetToolsPolicyEditor } from '@/features/settings/capability-presets/preset-tools-policy-editor';
import { SettingsFormSection, SettingsFormSectionHeader } from '@/features/settings/settings-form-section';
import { messages } from '@/i18n/messages';
import { cn } from '@/lib/cn';
import { ghostIconButton } from '@/lib/interaction';
import {
  SETTINGS_SHELL_CONTENT_Z,
  SETTINGS_SHELL_OVERLAY_Z,
} from '@/lib/settings-shell-dialog-layer';
import { SettingsShellLayerProvider } from '@/lib/settings-shell-layer-context';
import { useGatewayStore } from '@/stores/gateway-store';
import { useLocaleStore } from '@/stores/locale-store';

type ToolMode = 'allow' | 'deny';
type PresetTab = 'overview' | 'models' | 'tools' | 'skills' | 'impact';
type StarterId = 'blank' | 'safe-coder' | 'read-only' | 'low-cost';

type Draft = {
  id: string;
  name: string;
  description: string;
  version: string;
  modelRows: AgentTypedModelRow[];
  toolModes: Record<string, ToolMode>;
  skillMode: PresetSkillMode;
  skillPick: Set<string>;
};

const TABS: Array<{ id: PresetTab; icon: typeof Copy }> = [
  { id: 'overview', icon: Copy },
  { id: 'models', icon: Layers },
  { id: 'tools', icon: Wrench },
  { id: 'skills', icon: Puzzle },
  { id: 'impact', icon: Eye },
];

function typedRowsFromPreset(preset: CapabilityPresetRow | null): AgentTypedModelRow[] {
  return typedModelsRowsFromList(
    Object.entries(preset?.models?.roles ?? {}).map(([id, role]) => ({
      id,
      model: role.model,
      description: role.description,
    })),
  );
}

function toolModesFromPreset(preset: CapabilityPresetRow | null): Record<string, ToolMode> {
  return Object.fromEntries(
    Object.entries(preset?.tools?.builtin ?? {}).map(([id, policy]) => [
      id,
      policy.mode === 'allow' ? 'allow' : 'deny',
    ]),
  );
}

function skillPickFromPreset(preset: CapabilityPresetRow | null): Set<string> {
  const policy = preset?.skills;
  if (!policy) return new Set();
  const list = policy.mode === 'denylist' ? policy.deny : policy.allow;
  return new Set(list ?? []);
}

function draftFromPreset(preset: CapabilityPresetRow | null): Draft {
  return {
    id: preset?.id ?? '',
    name: preset?.name ?? '',
    description: preset?.description ?? '',
    version: String(preset?.version ?? 1),
    modelRows: typedRowsFromPreset(preset),
    toolModes: toolModesFromPreset(preset),
    skillMode: preset?.skills?.mode ?? 'inherit',
    skillPick: skillPickFromPreset(preset),
  };
}

function modelsPatchFromDraft(draft: Draft, selected: CapabilityPresetRow | null) {
  const patch = cleanTypedModelsForPatch(draft.modelRows);
  if (!patch?.roles) return null;
  return {
    ...(selected?.models?.defaultRole ? { defaultRole: selected.models.defaultRole } : {}),
    roles: patch.roles,
  };
}

function toolsPatchFromDraft(draft: Draft) {
  const builtin = Object.fromEntries(
    Object.entries(draft.toolModes)
      .toSorted(([a], [b]) => a.localeCompare(b))
      .map(([id, mode]) => [id, { mode }]),
  );
  return Object.keys(builtin).length > 0 ? { builtin } : null;
}

function skillsPatchFromDraft(draft: Draft) {
  if (draft.skillMode === 'inherit') return null;
  const list = [...draft.skillPick].toSorted((a, b) => a.localeCompare(b));
  if (draft.skillMode === 'allowlist') return { mode: 'allowlist' as const, allow: list };
  if (draft.skillMode === 'denylist') return { mode: 'denylist' as const, deny: list };
  return { mode: draft.skillMode };
}

function comparableDraft(draft: Draft, selected: CapabilityPresetRow | null) {
  return {
    id: draft.id.trim(),
    name: draft.name.trim(),
    description: draft.description.trim(),
    version: Number(draft.version),
    models: modelsPatchFromDraft(draft, selected),
    tools: toolsPatchFromDraft(draft),
    skills: skillsPatchFromDraft(draft),
  };
}

function comparablePreset(preset: CapabilityPresetRow | null) {
  if (!preset) return null;
  return {
    id: preset.id,
    name: preset.name,
    description: preset.description ?? '',
    version: preset.version,
    models: preset.models?.roles ? {
      ...(preset.models.defaultRole ? { defaultRole: preset.models.defaultRole } : {}),
      roles: preset.models.roles,
    } : null,
    tools: preset.tools?.builtin && Object.keys(preset.tools.builtin).length > 0
      ? { builtin: preset.tools.builtin }
      : null,
    skills: preset.skills ?? { mode: 'all' },
  };
}

function presetSummary(preset: CapabilityPresetRow): string {
  const parts = [
    preset.models?.roles ? `${Object.keys(preset.models.roles).length} model roles` : '',
    preset.tools?.builtin ? `${Object.keys(preset.tools.builtin).length} tool access settings` : '',
    preset.skills ? `skills: ${preset.skills.mode}` : '',
  ].filter(Boolean);
  return parts.join(' · ') || 'No shared settings yet';
}

function starterDraft(id: StarterId): Draft {
  if (id === 'safe-coder') {
    return {
      id: 'safe-coder',
      name: 'Safe Coder',
      description: 'Shared settings for coding agents: code-oriented model roles, careful shell usage, and focused engineering skills.',
      version: '1',
      modelRows: [
        { id: 'deep', model: '', description: 'Complex implementation and planning' },
        { id: 'code', model: '', description: 'Code edits and tests' },
        { id: 'review', model: '', description: 'Review and risk checks' },
      ],
      toolModes: { shell: 'deny', send_message: 'deny', send_media: 'deny' },
      skillMode: 'allowlist',
      skillPick: new Set(['diagnose', 'tdd']),
    };
  }
  if (id === 'read-only') {
    return {
      id: 'read-only-research',
      name: 'Read-only Research',
      description: 'Shared settings for reading, searching, and summarizing without modifying files or running shell commands.',
      version: '1',
      modelRows: [
        { id: 'deep', model: '', description: 'Synthesis and long-context reading' },
        { id: 'fast', model: '', description: 'Quick summaries' },
      ],
      toolModes: { write_file: 'deny', edit_file: 'deny', shell: 'deny', send_message: 'deny', send_media: 'deny' },
      skillMode: 'all',
      skillPick: new Set(),
    };
  }
  if (id === 'low-cost') {
    return {
      id: 'low-cost-assistant',
      name: 'Low-cost Assistant',
      description: 'Shared settings for lightweight agents that should prefer faster or cheaper model roles.',
      version: '1',
      modelRows: [
        { id: 'deep', model: '', description: 'Default low-cost model' },
        { id: 'fast', model: '', description: 'Low-latency replies' },
        { id: 'cheap', model: '', description: 'Batch or summary work' },
      ],
      toolModes: {},
      skillMode: 'inherit',
      skillPick: new Set(),
    };
  }
  return { id: '', name: '', description: '', version: '1', modelRows: [], toolModes: {}, skillMode: 'inherit', skillPick: new Set() };
}

export function CapabilityPresetsSettingsPanel() {
  const language = useLocaleStore((s) => s.language);
  const m = messages(language);
  const cp = m.capabilityPresetsSettings;
  const token = useGatewayStore((s) => s.token);
  const hasToken = Boolean(token);
  const { data, error, isLoading, mutate } = useSWR(
    hasToken ? 'settings-capability-presets' : null,
    fetchCapabilityPresets,
    { revalidateOnFocus: false },
  );
  const { data: skillsCatalog = [], isLoading: skillsCatalogLoading } = useSWR(
    hasToken ? 'settings-capability-presets-skills-catalog' : null,
    fetchSkillsCatalog,
    { revalidateOnFocus: false },
  );
  const [searchParams, setSearchParams] = useSearchParams();
  const [selectedId, setSelectedId] = useState('');
  const [activeTab, setActiveTab] = useState<PresetTab>('overview');
  const [draft, setDraft] = useState<Draft>(() => starterDraft('blank'));
  const [busy, setBusy] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  const presets = data?.presets ?? [];
  const selected = useMemo(
    () => presets.find((preset) => preset.id === selectedId) ?? presets[0] ?? null,
    [presets, selectedId],
  );
  const isNew = !selected || draft.id.trim() !== selected.id;
  const dirty = JSON.stringify(comparableDraft(draft, selected)) !== JSON.stringify(comparablePreset(selected));
  const displayError = localError ?? (error instanceof Error ? error.message : null);
  const dialogOpen = searchParams.get('action') === 'new' || Boolean(searchParams.get('preset'));
  const dialogTitle = isNew ? cp.newPreset : selected?.name ?? cp.editorTitle;
  const getToolGroupTitle = (key: BuiltinToolUiGroupKey) => m.agentsSettings.toolsDisableGroups[key];
  const getToolDescription = (toolId: string) =>
    toolId in m.agentsSettings.toolDescriptions
      ? m.agentsSettings.toolDescriptions[toolId as keyof typeof m.agentsSettings.toolDescriptions]
      : '';

  useEffect(() => {
    if (!data || busy) return;
    if (searchParams.get('action') === 'new') {
      const starter = searchParams.get('starter');
      setSelectedId('');
      setDraft(starterDraft(starter === 'safe-coder' || starter === 'read-only' || starter === 'low-cost' ? starter : 'blank'));
      setActiveTab('overview');
      return;
    }
    const presetId = searchParams.get('preset')?.trim();
    const preset = presetId ? data.presets.find((item) => item.id === presetId) : null;
    if (preset) {
      setSelectedId(preset.id);
      setDraft(draftFromPreset(preset));
      setActiveTab((searchParams.get('tab') as PresetTab | null) ?? 'overview');
      return;
    }
    if (selected) {
      setSelectedId(selected.id);
      setDraft((prev) => (prev.id === selected.id ? prev : draftFromPreset(selected)));
    }
  }, [busy, data, searchParams, selected]);

  function selectPreset(preset: CapabilityPresetRow) {
    setSelectedId(preset.id);
    setDraft(draftFromPreset(preset));
    setSearchParams({ preset: preset.id }, { replace: true });
    setActiveTab('overview');
  }

  function startNew(starter: StarterId) {
    const next = starterDraft(starter);
    setSelectedId('');
    setDraft(next);
    setLocalError(null);
    setSearchParams(starter === 'blank' ? { action: 'new' } : { action: 'new', starter }, { replace: true });
    setActiveTab('overview');
  }

  function closeDialog() {
    setSearchParams({}, { replace: true });
    setLocalError(null);
    setDraft(draftFromPreset(selected));
    setActiveTab('overview');
  }

  async function onSave() {
    const modelError = validateTypedModelsForSave(draft.modelRows, {
      invalidId: cp.invalidModelRoleId,
      duplicateId: cp.duplicateModelRoleId,
      invalidModel: cp.invalidModelRef,
    });
    if (modelError) {
      setLocalError(modelError);
      setActiveTab('models');
      return;
    }
    setBusy(true);
    setLocalError(null);
    try {
      if (isNew) {
        const created = await createCapabilityPreset({
          id: draft.id.trim(),
          name: draft.name.trim(),
          ...(draft.description.trim() ? { description: draft.description.trim() } : {}),
        });
        let nextPayload = created.presets;
        const strategy = comparableDraft(draft, null);
        if (strategy.models || strategy.tools || strategy.skills) {
          nextPayload = await updateCapabilityPreset(created.presetId, {
            version: strategy.version,
            models: strategy.models,
            tools: strategy.tools,
            skills: strategy.skills,
          });
        }
        await mutate(nextPayload, { revalidate: false });
        setSelectedId(created.presetId);
        setSearchParams({ preset: created.presetId }, { replace: true });
      } else if (selected) {
        const strategy = comparableDraft(draft, selected);
        const next = await updateCapabilityPreset(selected.id, {
          name: strategy.name,
          description: strategy.description || null,
          version: strategy.version,
          models: strategy.models,
          tools: strategy.tools,
          skills: strategy.skills,
        });
        await mutate(next, { revalidate: false });
      }
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : cp.saveError);
    } finally {
      setBusy(false);
    }
  }

  async function onDelete() {
    if (!selected) return;
    setBusy(true);
    setLocalError(null);
    try {
      const next = await deleteCapabilityPreset(selected.id);
      await mutate(next, { revalidate: false });
      const first = next.presets[0] ?? null;
      setSelectedId(first?.id ?? '');
      setDraft(draftFromPreset(first));
      setSearchParams(first ? { preset: first.id } : {}, { replace: true });
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : cp.saveError);
    } finally {
      setBusy(false);
    }
  }

  if (!hasToken) {
    return (
      <div className="mx-auto flex w-full max-w-app-main flex-col gap-3 px-4 py-8">
        <h1 className="text-lg font-semibold text-fg">{cp.title}</h1>
        <p className="text-sm text-fg-muted">{cp.needToken}</p>
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-app-main flex-col gap-5 px-4 py-8 pb-24">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-lg font-semibold text-fg">{cp.title}</h1>
          <p className="mt-1 max-w-3xl text-sm text-fg-muted">{cp.subtitle}</p>
        </div>
        <Button type="button" onClick={() => startNew('blank')} disabled={busy}>
          <Plus className="size-4" aria-hidden />
          {cp.newPreset}
        </Button>
      </div>

      {displayError ? (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-200">
          {displayError}
        </div>
      ) : null}

      {isLoading ? (
        <p className="text-sm text-fg-muted">{cp.loading}</p>
      ) : (
        <div className="flex flex-col gap-5">
          <SettingsFormSection>
            <SettingsFormSectionHeader icon={Plus} title={cp.newPreset} subtitle={cp.editorHint} />
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {(['blank', 'safe-coder', 'read-only', 'low-cost'] as const).map((starter) => (
                <button
                  key={starter}
                  type="button"
                  className="min-h-28 rounded-lg border border-edge-subtle bg-surface-panel px-4 py-3 text-left text-sm text-fg transition-colors hover:border-edge hover:bg-surface-hover/55 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                  onClick={() => startNew(starter)}
                >
                  <span className="font-medium">{cp.starters[starter].title}</span>
                  <span className="mt-2 block text-xs leading-relaxed text-fg-muted">
                    {cp.starters[starter].description}
                  </span>
                </button>
              ))}
            </div>
          </SettingsFormSection>

          <SettingsFormSection>
            <SettingsFormSectionHeader icon={Layers} title={cp.listTitle} subtitle={cp.listHint} />
            {presets.length === 0 ? (
              <div className="rounded-lg border border-dashed border-edge-subtle px-3 py-4 text-sm text-fg-muted">
                {cp.empty}
              </div>
            ) : (
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {presets.map((preset) => (
                  <button
                    key={preset.id}
                    type="button"
                    onClick={() => selectPreset(preset)}
                    className="group min-h-36 rounded-lg border border-edge-subtle bg-surface-panel px-4 py-3 text-left text-fg transition-colors hover:border-edge hover:bg-surface-hover/55 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-semibold text-fg">{preset.name}</div>
                        <div className="mt-1 truncate font-mono text-[11px] text-fg-subtle">{preset.id}</div>
                      </div>
                      <span className="shrink-0 rounded-full border border-edge-subtle px-2 py-0.5 text-[11px] font-medium text-fg-muted">
                        {preset.usage.length}
                      </span>
                    </div>
                    {preset.description ? (
                      <p className="mt-3 line-clamp-2 text-xs leading-relaxed text-fg-muted">
                        {preset.description}
                      </p>
                    ) : null}
                    <div className="mt-3 truncate text-xs text-fg-subtle">{presetSummary(preset)}</div>
                  </button>
                ))}
              </div>
            )}
          </SettingsFormSection>
        </div>
      )}

      <Dialog.Root open={dialogOpen} onOpenChange={(open) => {
        if (!open) closeDialog();
      }}>
        <Dialog.Portal>
          <Dialog.Overlay className={cn('xopc-dialog-overlay fixed inset-0 bg-scrim', SETTINGS_SHELL_OVERLAY_Z)} />
          <Dialog.Content
            className={cn(
              'xopc-dialog-content fixed left-1/2 top-1/2 flex h-[min(90vh,760px)] w-[min(100%-2rem,64rem)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-xl border border-edge bg-surface-panel shadow-popover dark:border-edge',
              SETTINGS_SHELL_CONTENT_Z,
            )}
            onOpenAutoFocus={(e) => e.preventDefault()}
          >
            <SettingsShellLayerProvider layer="modal">
              <div className="flex shrink-0 items-start justify-between gap-3 border-b border-edge-subtle px-4 py-3 dark:border-edge">
                <div className="min-w-0">
                  <Dialog.Title className="truncate text-base font-semibold text-fg">{dialogTitle}</Dialog.Title>
                  <Dialog.Description className="mt-0.5 truncate text-xs text-fg-muted">
                    {isNew ? cp.editorHint : draft.id}
                  </Dialog.Description>
                </div>
                <Dialog.Close asChild>
                  <button
                    type="button"
                    className={cn(ghostIconButton, 'shrink-0 p-1.5 hover:bg-surface-base')}
                    aria-label={cp.closeDialog}
                  >
                    <X className="size-4" aria-hidden />
                  </button>
                </Dialog.Close>
              </div>

              {displayError ? (
                <div className="mx-4 mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-200">
                  {displayError}
                </div>
              ) : null}

              <div className="flex shrink-0 flex-wrap gap-2 border-b border-edge-subtle bg-surface-base px-4 py-2 dark:border-edge">
                {TABS.map(({ id, icon: Icon }) => (
                  <button
                    key={id}
                    type="button"
                    className={cn(
                      'inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
                      activeTab === id ? 'bg-surface-panel text-fg shadow-surface' : 'text-fg-muted hover:bg-surface-hover hover:text-fg',
                    )}
                    onClick={() => setActiveTab(id)}
                  >
                    <Icon className="size-4" aria-hidden />
                    {cp.tabs[id]}
                  </button>
                ))}
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
                <div className="mx-auto max-w-4xl">
            {activeTab === 'overview' ? (
              <SettingsFormSection>
                <SettingsFormSectionHeader icon={Copy} title={cp.overviewTitle} subtitle={cp.overviewHint} />
                <div className="grid gap-4 sm:grid-cols-2">
                  <label className="flex flex-col gap-1.5 text-sm">
                    <span className="font-medium text-fg">{cp.idLabel}</span>
                    <input
                      className="w-full rounded-lg border border-edge bg-surface-panel px-3 py-2 text-sm text-fg placeholder:text-fg-subtle focus:border-edge-strong focus:outline-none"
                      value={draft.id}
                      disabled={busy || !isNew}
                      onChange={(e) => setDraft((prev) => ({ ...prev, id: e.target.value.toLowerCase() }))}
                      placeholder="safe-coder"
                    />
                  </label>
                  <label className="flex flex-col gap-1.5 text-sm">
                    <span className="font-medium text-fg">{cp.versionLabel}</span>
                    <input
                      className="w-full rounded-lg border border-edge bg-surface-panel px-3 py-2 text-sm text-fg placeholder:text-fg-subtle focus:border-edge-strong focus:outline-none"
                      value={draft.version}
                      disabled={busy}
                      inputMode="numeric"
                      onChange={(e) => setDraft((prev) => ({ ...prev, version: e.target.value }))}
                    />
                  </label>
                  <label className="flex flex-col gap-1.5 text-sm sm:col-span-2">
                    <span className="font-medium text-fg">{cp.nameLabel}</span>
                    <input
                      className="w-full rounded-lg border border-edge bg-surface-panel px-3 py-2 text-sm text-fg placeholder:text-fg-subtle focus:border-edge-strong focus:outline-none"
                      value={draft.name}
                      disabled={busy}
                      onChange={(e) => setDraft((prev) => ({ ...prev, name: e.target.value }))}
                      placeholder={cp.namePlaceholder}
                    />
                  </label>
                  <label className="flex flex-col gap-1.5 text-sm sm:col-span-2">
                    <span className="font-medium text-fg">{cp.descriptionLabel}</span>
                    <textarea
                      className="min-h-24 w-full resize-y rounded-lg border border-edge bg-surface-panel px-3 py-2 text-sm text-fg placeholder:text-fg-subtle focus:border-edge-strong focus:outline-none"
                      value={draft.description}
                      disabled={busy}
                      onChange={(e) => setDraft((prev) => ({ ...prev, description: e.target.value }))}
                      placeholder={cp.descriptionPlaceholder}
                    />
                  </label>
                </div>
                <div className="mt-5 grid gap-2 sm:grid-cols-3">
                  <SummaryTile icon={Layers} label={cp.modelsTitle} value={String(draft.modelRows.length)} />
                  <SummaryTile icon={Wrench} label={cp.toolsTitle} value={String(Object.keys(draft.toolModes).length)} />
                  <SummaryTile icon={Puzzle} label={cp.skillsTitle} value={cp.skillModeLabels[draft.skillMode]} />
                </div>
              </SettingsFormSection>
            ) : null}

            {activeTab === 'models' ? (
              <SettingsFormSection>
                <SettingsFormSectionHeader icon={Layers} title={cp.modelsTitle} subtitle={cp.modelsHint} />
                <TypedModelsEditor
                  rows={draft.modelRows}
                  onChange={(rows) => setDraft((prev) => ({ ...prev, modelRows: rows }))}
                  disabled={busy}
                  defaultRole={selected?.models?.defaultRole}
                  chat={m.chat}
                  labels={{
                    id: cp.modelRoleIdLabel,
                    description: cp.modelRoleDescriptionLabel,
                    add: cp.addModelRole,
                    remove: cp.removeModelRole,
                    recommendedTitle: cp.modelRecommendedTitle,
                    customTitle: cp.modelCustomTitle,
                    defaultBadge: cp.modelDefaultBadge,
                    addPurpose: cp.addModelPurpose,
                    noCustomRoles: cp.noCustomModelRoles,
                    idPlaceholder: 'deep',
                    descriptionPlaceholder: cp.modelRoleDescriptionPlaceholder,
                    roleNames: cp.modelRoleNames,
                    roleDescriptions: cp.modelRoleDescriptions,
                  }}
                />
              </SettingsFormSection>
            ) : null}

            {activeTab === 'tools' ? (
              <SettingsFormSection>
                <SettingsFormSectionHeader icon={Wrench} title={cp.toolsTitle} subtitle={cp.toolsHint} />
                <PresetToolsPolicyEditor
                  builtinToolIds={data?.builtinToolIds ?? []}
                  toolModes={draft.toolModes}
                  onChange={(toolModes) => setDraft((prev) => ({ ...prev, toolModes }))}
                  disabled={busy}
                  getToolDescription={getToolDescription}
                  getGroupTitle={getToolGroupTitle}
                  labels={{
                    quickActionsLabel: cp.toolsQuickActionsLabel,
                    quickClearOverrides: cp.toolsQuickClearOverrides,
                    quickReadOnlyWorkspace: cp.toolsQuickReadOnlyWorkspace,
                    quickHighRiskOff: cp.toolsQuickHighRiskOff,
                    quickNoOutbound: cp.toolsQuickNoOutbound,
                    quickResearchMode: cp.toolsQuickResearchMode,
                    quickCodingMode: cp.toolsQuickCodingMode,
                    emptyBuiltin: cp.toolsEmptyBuiltin,
                    overrideSummaryTitle: cp.toolsOverrideSummaryTitle,
                    noOverrides: cp.toolsNoOverrides,
                    inheritedMode: cp.toolModes.inherit,
                    modeAllow: cp.toolModes.allow,
                    modeDeny: cp.toolModes.deny,
                  }}
                />
              </SettingsFormSection>
            ) : null}

            {activeTab === 'skills' ? (
              <SettingsFormSection>
                <SettingsFormSectionHeader icon={Puzzle} title={cp.skillsTitle} subtitle={cp.skillsHint} />
                <PresetSkillsPolicyEditor
                  mode={draft.skillMode}
                  selected={draft.skillPick}
                  catalog={skillsCatalog}
                  loading={skillsCatalogLoading}
                  disabled={busy}
                  onModeChange={(skillMode) => setDraft((prev) => ({ ...prev, skillMode }))}
                  onSelectedChange={(skillPick) => setDraft((prev) => ({ ...prev, skillPick }))}
                  labels={{
                    modeLabel: cp.skillsModeLabel,
                    modeInherit: cp.skillsModeInherit,
                    modeAll: cp.skillsModeAll,
                    modeAllowlist: cp.skillsModeAllowlist,
                    modeDenylist: cp.skillsModeDenylist,
                    modeOff: cp.skillsModeOff,
                    quickActionsLabel: cp.skillsQuickActionsLabel,
                    quickSelectAll: cp.skillsQuickSelectAll,
                    quickClear: cp.skillsQuickClear,
                    catalogLoading: cp.skillsCatalogLoading,
                    emptyCatalog: cp.skillsEmptyCatalog,
                    noDescription: cp.skillsNoDescription,
                    overrideSummaryTitle: cp.skillsOverrideSummaryTitle,
                    inheritSummary: cp.skillsInheritSummary,
                    allSummary: cp.skillsAllSummary,
                    offSummary: cp.skillsOffSummary,
                    allowSummary: cp.skillsAllowSummary,
                    denySummary: cp.skillsDenySummary,
                  }}
                />
              </SettingsFormSection>
            ) : null}

            {activeTab === 'impact' ? (
              <SettingsFormSection>
                <SettingsFormSectionHeader icon={Eye} title={cp.usageTitle} subtitle={cp.usageHint} />
                {selected?.usage.length ? (
                  <div className="grid gap-2">
                    {selected.usage.map((usage) => (
                      <div key={usage.agentId} className="rounded-lg border border-edge-subtle bg-surface-panel px-3 py-2">
                        <div className="text-sm font-medium text-fg">{usage.agentName || usage.agentId}</div>
                        <div className="mt-1 font-mono text-[11px] text-fg-muted">{usage.agentId}</div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-fg-muted">{cp.noUsage}</p>
                )}
              </SettingsFormSection>
            ) : null}
                </div>
              </div>

              <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-edge-subtle px-4 py-3 dark:border-edge">
                <div className="min-w-0 text-sm">
                  <div className="font-medium text-fg">{dirty ? cp.unsavedTitle : cp.noUnsavedTitle}</div>
              <div className="text-xs text-fg-muted">
                    {dirty
                      ? (selected?.usage.length ?? 0) > 0
                        ? cp.unsavedImpact.replace('{{count}}', String(selected?.usage.length ?? 0))
                        : cp.unsavedNoImpact
                      : cp.noUnsavedHint}
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  {dirty ? (
                    <Button
                      type="button"
                      variant="secondary"
                      disabled={busy}
                      onClick={() => setDraft(draftFromPreset(selected))}
                    >
                      {cp.discard}
                    </Button>
                  ) : null}
                  {selected ? (
                    <Button type="button" variant="secondary" disabled={busy} onClick={() => void onDelete()}>
                      <Trash2 className="size-4" aria-hidden />
                      {cp.delete}
                    </Button>
                  ) : null}
                  <Button type="button" disabled={busy || !draft.id.trim() || !draft.name.trim() || !dirty} onClick={() => void onSave()}>
                    <Save className="size-4" aria-hidden />
                    {cp.savePreset}
                  </Button>
                </div>
              </div>
            </SettingsShellLayerProvider>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}

function SummaryTile({ icon: Icon, label, value }: { icon: typeof Copy; label: string; value: string }) {
  return (
    <div className="rounded-lg border border-edge-subtle bg-surface-panel px-3 py-2">
      <div className="flex items-center gap-2 text-xs text-fg-muted">
        <Icon className="size-3.5" aria-hidden />
        {label}
      </div>
      <div className="mt-1 text-sm font-medium text-fg">{value}</div>
    </div>
  );
}
