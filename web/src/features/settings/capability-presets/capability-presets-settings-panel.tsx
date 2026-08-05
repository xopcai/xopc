import * as Dialog from '@radix-ui/react-dialog';
import {
  ArrowLeft,
  ArrowUpRight,
  ChevronDown,
  Copy,
  Eye,
  Layers,
  Loader2,
  Plus,
  Puzzle,
  Save,
  SlidersHorizontal,
  Trash2,
  Wrench,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import useSWR from 'swr';

import { Button } from '@/components/ui/button';
import { Select, SelectOption } from '@/components/ui/popover-select';
import type { ConfiguredModel } from '@/features/chat/api/registry-api';
import { ModelSelector } from '@/features/chat/model/model-selector';
import { fetchSkillsCatalog } from '@/features/settings/agents-admin-api';
import type { BuiltinToolUiGroupKey } from '@/features/settings/agents/builtin-tool-disable-groups';
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
  type CapabilityPresetPolicyFields,
  type CapabilityPresetToolPolicy,
} from '@/features/settings/capability-presets/capability-presets-api';
import { PresetModelsEditor } from '@/features/settings/capability-presets/preset-models-editor';
import {
  PresetAdvancedPolicyEditor,
  type PresetAdvancedFieldKey,
  type PresetAdvancedJsonFields,
} from '@/features/settings/capability-presets/preset-advanced-policy-editor';
import {
  PresetSkillsPolicyEditor,
  type PresetSkillMode,
} from '@/features/settings/capability-presets/preset-skills-policy-editor';
import { PresetToolsPolicyEditor } from '@/features/settings/capability-presets/preset-tools-policy-editor';
import { fetchImageCatalog } from '@/features/settings/image-generation-api';
import { SettingsFormSection, SettingsFormSectionHeader } from '@/features/settings/settings-form-section';
import { SettingsPageSkeleton } from '@/features/settings/settings-loading-skeleton';
import { SettingsPageFrame, SettingsPageHeader } from '@/features/settings/settings-page-layout';
import { messages, type ChatMessages } from '@/i18n/messages';
import { cn } from '@/lib/cn';
import { ghostIconButton } from '@/lib/interaction';
import {
  SETTINGS_SHELL_CONTENT_Z,
  SETTINGS_SHELL_OVERLAY_Z,
} from '@/lib/settings-shell-dialog-layer';
import { SettingsShellLayerProvider } from '@/lib/settings-shell-layer-context';
import { useGatewayStore } from '@/stores/gateway-store';
import { useLocaleStore } from '@/stores/locale-store';

type PresetTab = 'overview' | 'models' | 'tools' | 'skills' | 'advanced' | 'impact';
type StarterId = 'blank' | 'safe-coder' | 'read-only' | 'low-cost';
const STARTER_IDS: readonly StarterId[] = ['blank', 'safe-coder', 'read-only', 'low-cost'];
type CapabilityPresetMessages = ReturnType<typeof messages>['capabilityPresetsSettings'];

type ToolModelDraft = {
  primary: string;
  fallbacks: string[];
  timeoutMs: string;
  autoProviderFallback: '' | 'true' | 'false';
};

type ModelAdvancedDraft = {
  imageModel: ToolModelDraft;
  imageGenerationModel: ToolModelDraft;
  allowFallbacks: '' | 'true' | 'false';
  maxCostTier: '' | 'low' | 'medium' | 'high';
};

type Draft = {
  id: string;
  name: string;
  description: string;
  modelRows: AgentTypedModelRow[];
  modelAdvanced: ModelAdvancedDraft;
  toolPolicies: Record<string, CapabilityPresetToolPolicy>;
  skillMode: PresetSkillMode;
  skillPick: Set<string>;
  extendsIds: string[];
  jsonFields: PresetAdvancedJsonFields;
};

const TABS: Array<{ id: PresetTab; icon: typeof Copy }> = [
  { id: 'overview', icon: Copy },
  { id: 'models', icon: Layers },
  { id: 'tools', icon: Wrench },
  { id: 'skills', icon: Puzzle },
  { id: 'advanced', icon: SlidersHorizontal },
  { id: 'impact', icon: Eye },
];

function typedRowsFromPreset(preset: CapabilityPresetRow | null): AgentTypedModelRow[] {
  return typedModelsRowsFromList(
    Object.entries(preset?.models?.roles ?? {}).map(([id, role]) => ({
      id,
      model: role.model,
      fallbacks: role.fallbacks ?? [],
      description: role.description,
    })),
  );
}

function toolPoliciesFromPreset(preset: CapabilityPresetRow | null): Record<string, CapabilityPresetToolPolicy> {
  return structuredClone(preset?.tools?.builtin ?? {});
}

function skillPickFromPreset(preset: CapabilityPresetRow | null): Set<string> {
  const policy = preset?.skills;
  if (!policy) return new Set();
  const list = policy.mode === 'denylist' ? policy.deny : policy.allow;
  return new Set(list ?? []);
}

function emptyToolModelDraft(): ToolModelDraft {
  return { primary: '', fallbacks: [], timeoutMs: '', autoProviderFallback: '' };
}

function toolModelDraft(value: NonNullable<CapabilityPresetRow['models']>['imageModel']): ToolModelDraft {
  return {
    primary: value?.primary ?? '',
    fallbacks: [...(value?.fallbacks ?? [])],
    timeoutMs: value?.timeoutMs ? String(value.timeoutMs) : '',
    autoProviderFallback:
      value?.autoProviderFallback === undefined ? '' : value.autoProviderFallback ? 'true' : 'false',
  };
}

function emptyModelAdvancedDraft(): ModelAdvancedDraft {
  return {
    imageModel: emptyToolModelDraft(),
    imageGenerationModel: emptyToolModelDraft(),
    allowFallbacks: '',
    maxCostTier: '',
  };
}

function modelAdvancedFromPreset(preset: CapabilityPresetRow | null): ModelAdvancedDraft {
  return {
    imageModel: toolModelDraft(preset?.models?.imageModel),
    imageGenerationModel: toolModelDraft(preset?.models?.imageGenerationModel),
    allowFallbacks:
      preset?.models?.policy?.allowFallbacks === undefined
        ? ''
        : preset.models.policy.allowFallbacks
          ? 'true'
          : 'false',
    maxCostTier: preset?.models?.policy?.maxCostTier ?? '',
  };
}

function jsonText(value: unknown): string {
  return value === undefined ? '' : JSON.stringify(value, null, 2);
}

function emptyAdvancedJson(): PresetAdvancedJsonFields {
  return { mcp: '', workflows: '', boundaries: '', runtime: '', locks: '' };
}

function advancedJsonFromPreset(preset: CapabilityPresetRow | null): PresetAdvancedJsonFields {
  return {
    mcp: jsonText(preset?.tools?.mcp),
    workflows: jsonText(preset?.workflows),
    boundaries: jsonText(preset?.boundaries),
    runtime: jsonText(preset?.runtime),
    locks: jsonText(preset?.locks),
  };
}

function draftFromPreset(preset: CapabilityPresetRow | null): Draft {
  return {
    id: preset?.id ?? '',
    name: preset?.name ?? '',
    description: preset?.description ?? '',
    modelRows: typedRowsFromPreset(preset),
    modelAdvanced: modelAdvancedFromPreset(preset),
    toolPolicies: toolPoliciesFromPreset(preset),
    skillMode: preset?.skills?.mode ?? 'inherit',
    skillPick: skillPickFromPreset(preset),
    extendsIds: [...(preset?.extends ?? [])],
    jsonFields: advancedJsonFromPreset(preset),
  };
}

function toolModelFromDraft(draft: ToolModelDraft) {
  const primary = draft.primary.trim();
  if (!primary) return undefined;
  const fallbacks = draft.fallbacks.map((item) => item.trim()).filter(Boolean);
  const timeoutMs = draft.timeoutMs.trim() ? Number(draft.timeoutMs) : undefined;
  const autoProviderFallback =
    draft.autoProviderFallback === '' ? undefined : draft.autoProviderFallback === 'true';
  return {
    primary,
    ...(fallbacks.length > 0 ? { fallbacks } : {}),
    ...(timeoutMs ? { timeoutMs } : {}),
    ...(autoProviderFallback === undefined ? {} : { autoProviderFallback }),
  };
}

function modelsPatchFromDraft(draft: Draft, selected: CapabilityPresetRow | null) {
  const patch = cleanTypedModelsForPatch(draft.modelRows);
  const imageModel = toolModelFromDraft(draft.modelAdvanced.imageModel);
  const imageGenerationModel = toolModelFromDraft(draft.modelAdvanced.imageGenerationModel);
  const policy =
    draft.modelAdvanced.allowFallbacks || draft.modelAdvanced.maxCostTier
      ? {
          ...(draft.modelAdvanced.allowFallbacks
            ? { allowFallbacks: draft.modelAdvanced.allowFallbacks === 'true' }
            : {}),
          ...(draft.modelAdvanced.maxCostTier ? { maxCostTier: draft.modelAdvanced.maxCostTier } : {}),
        }
      : undefined;
  const models = {
    ...(selected?.models?.defaultRole ? { defaultRole: selected.models.defaultRole } : {}),
    ...(patch?.roles ? { roles: patch.roles } : {}),
    ...(imageModel ? { imageModel } : {}),
    ...(imageGenerationModel ? { imageGenerationModel } : {}),
    ...(policy ? { policy } : {}),
  };
  return Object.keys(models).length > 0 ? models : null;
}

function parseOptionalJson<T>(text: string): T | undefined {
  return text.trim() ? JSON.parse(text) as T : undefined;
}

function normalizedJsonText(text: string): string {
  if (!text.trim()) return '';
  try {
    return JSON.stringify(JSON.parse(text));
  } catch {
    return `!invalid:${text}`;
  }
}

function toolsPatchFromDraft(draft: Draft) {
  const builtin = Object.fromEntries(Object.entries(draft.toolPolicies).toSorted(([a], [b]) => a.localeCompare(b)));
  const mcp = parseOptionalJson<NonNullable<CapabilityPresetRow['tools']>['mcp']>(draft.jsonFields.mcp);
  return Object.keys(builtin).length > 0 || mcp ? { builtin, ...(mcp ? { mcp } : {}) } : null;
}

function sortedToolPolicies(policies: Record<string, CapabilityPresetToolPolicy> | undefined) {
  return Object.fromEntries(Object.entries(policies ?? {}).toSorted(([a], [b]) => a.localeCompare(b)));
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
    models: modelsPatchFromDraft(draft, selected),
    tools: {
      builtin: sortedToolPolicies(draft.toolPolicies),
      mcp: normalizedJsonText(draft.jsonFields.mcp),
    },
    skills: skillsPatchFromDraft(draft),
    extends: [...draft.extendsIds].toSorted(),
    workflows: normalizedJsonText(draft.jsonFields.workflows),
    boundaries: normalizedJsonText(draft.jsonFields.boundaries),
    runtime: normalizedJsonText(draft.jsonFields.runtime),
    locks: normalizedJsonText(draft.jsonFields.locks),
  };
}

function comparablePreset(preset: CapabilityPresetRow | null) {
  if (!preset) return null;
  return {
    id: preset.id,
    name: preset.name,
    description: preset.description ?? '',
    models: preset.models ?? null,
    tools: {
      builtin: sortedToolPolicies(preset.tools?.builtin),
      mcp: normalizedJsonText(jsonText(preset.tools?.mcp)),
    },
    skills: preset.skills ?? null,
    extends: [...(preset.extends ?? [])].toSorted(),
    workflows: normalizedJsonText(jsonText(preset.workflows)),
    boundaries: normalizedJsonText(jsonText(preset.boundaries)),
    runtime: normalizedJsonText(jsonText(preset.runtime)),
    locks: normalizedJsonText(jsonText(preset.locks)),
  };
}

function presetSummary(preset: CapabilityPresetRow, cp: CapabilityPresetMessages): string {
  const parts = [
    preset.models?.roles ? cp.summaryModels.replace('{{count}}', String(Object.keys(preset.models.roles).length)) : '',
    preset.tools?.builtin ? cp.summaryTools.replace('{{count}}', String(Object.keys(preset.tools.builtin).length)) : '',
    preset.skills ? cp.summarySkills.replace('{{mode}}', cp.skillModeLabels[preset.skills.mode]) : '',
  ].filter(Boolean);
  return parts.join(' · ') || cp.summaryEmpty;
}

function emptyDraftPolicyFields() {
  return {
    modelAdvanced: emptyModelAdvancedDraft(),
    extendsIds: [] as string[],
    jsonFields: emptyAdvancedJson(),
  };
}

function policyPayloadFromDraft(
  draft: Draft,
  selected: CapabilityPresetRow | null,
): CapabilityPresetPolicyFields {
  return {
    extends: [...draft.extendsIds],
    models: modelsPatchFromDraft(draft, selected) ?? undefined,
    tools: toolsPatchFromDraft(draft) ?? undefined,
    skills: skillsPatchFromDraft(draft) ?? undefined,
    workflows: parseOptionalJson<CapabilityPresetRow['workflows']>(draft.jsonFields.workflows),
    boundaries: parseOptionalJson<CapabilityPresetRow['boundaries']>(draft.jsonFields.boundaries),
    runtime: parseOptionalJson<CapabilityPresetRow['runtime']>(draft.jsonFields.runtime),
    locks: parseOptionalJson<CapabilityPresetRow['locks']>(draft.jsonFields.locks),
  };
}

function starterDraft(id: StarterId, cp: CapabilityPresetMessages): Draft {
  if (id === 'safe-coder') {
    return {
      id: 'safe-coder',
      name: cp.starters['safe-coder'].title,
      description: cp.starters['safe-coder'].description,
      modelRows: [
        { id: 'deep', model: '', fallbacks: [], description: cp.modelRoleDescriptions.deep },
        { id: 'code', model: '', fallbacks: [], description: cp.modelRoleDescriptions.code },
        { id: 'review', model: '', fallbacks: [], description: cp.modelRoleDescriptions.review },
      ],
      toolPolicies: {
        exec_command: { mode: 'deny' },
        send_message: { mode: 'deny' },
        send_media: { mode: 'deny' },
      },
      skillMode: 'allowlist',
      skillPick: new Set(['diagnose', 'tdd']),
      ...emptyDraftPolicyFields(),
    };
  }
  if (id === 'read-only') {
    return {
      id: 'read-only-research',
      name: cp.starters['read-only'].title,
      description: cp.starters['read-only'].description,
      modelRows: [
        { id: 'deep', model: '', fallbacks: [], description: cp.modelRoleDescriptions.deep },
        { id: 'fast', model: '', fallbacks: [], description: cp.modelRoleDescriptions.fast },
      ],
      toolPolicies: {
        write_file: { mode: 'deny' },
        apply_patch: { mode: 'deny' },
        exec_command: { mode: 'deny' },
        send_message: { mode: 'deny' },
        send_media: { mode: 'deny' },
      },
      skillMode: 'all',
      skillPick: new Set(),
      ...emptyDraftPolicyFields(),
    };
  }
  if (id === 'low-cost') {
    return {
      id: 'low-cost-assistant',
      name: cp.starters['low-cost'].title,
      description: cp.starters['low-cost'].description,
      modelRows: [
        { id: 'deep', model: '', fallbacks: [], description: cp.modelRoleDescriptions.deep },
        { id: 'fast', model: '', fallbacks: [], description: cp.modelRoleDescriptions.fast },
        { id: 'cheap', model: '', fallbacks: [], description: cp.modelRoleDescriptions.cheap },
      ],
      toolPolicies: {},
      skillMode: 'inherit',
      skillPick: new Set(),
      ...emptyDraftPolicyFields(),
    };
  }
  return {
    id: '',
    name: '',
    description: '',
    modelRows: [],
    toolPolicies: {},
    skillMode: 'inherit',
    skillPick: new Set(),
    ...emptyDraftPolicyFields(),
  };
}

export function CapabilityPresetsSettingsPanel() {
  const language = useLocaleStore((s) => s.language);
  const m = messages(language);
  const cp = m.capabilityPresetsSettings;
  const manageAgentsAction = (
    <Button asChild type="button" variant="secondary">
      <Link to="/agents">
        {cp.manageAgents}
        <ArrowUpRight className="size-4" aria-hidden />
      </Link>
    </Button>
  );
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
  const [draft, setDraft] = useState<Draft>(() => starterDraft('blank', cp));
  const [selectedStarter, setSelectedStarter] = useState<StarterId | null>(null);
  const [busy, setBusy] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [portalContainer, setPortalContainer] = useState<HTMLDivElement | null>(null);

  const presets = data?.presets ?? [];
  const defaultPresetId = data?.defaultPresetId ?? 'default';
  const defaultPreset = presets.find((preset) => preset.id === defaultPresetId) ?? null;
  const sharedPresets = presets.filter((preset) => preset.id !== defaultPresetId);
  const selected = useMemo(
    () => presets.find((preset) => preset.id === selectedId) ?? presets[0] ?? null,
    [presets, selectedId],
  );
  const isNew = !selected || draft.id.trim() !== selected.id;
  const isDefaultPreset = Boolean(selected && selected.id === defaultPresetId);
  const dirty = JSON.stringify(comparableDraft(draft, selected)) !== JSON.stringify(comparablePreset(selected));
  const draftComparable = comparableDraft(draft, selected);
  const presetComparable = comparablePreset(selected);
  const changedSections = [
    draftComparable.id !== presetComparable?.id ||
    draftComparable.name !== presetComparable?.name ||
    draftComparable.description !== presetComparable?.description
      ? cp.tabs.overview
      : '',
    JSON.stringify(draftComparable.models) !== JSON.stringify(presetComparable?.models) ? cp.tabs.models : '',
    JSON.stringify(draftComparable.tools) !== JSON.stringify(presetComparable?.tools) ? cp.tabs.tools : '',
    JSON.stringify(draftComparable.skills) !== JSON.stringify(presetComparable?.skills) ? cp.tabs.skills : '',
    JSON.stringify({
      extends: draftComparable.extends,
      workflows: draftComparable.workflows,
      boundaries: draftComparable.boundaries,
      runtime: draftComparable.runtime,
      locks: draftComparable.locks,
    }) !== JSON.stringify({
      extends: presetComparable?.extends,
      workflows: presetComparable?.workflows,
      boundaries: presetComparable?.boundaries,
      runtime: presetComparable?.runtime,
      locks: presetComparable?.locks,
    }) ? cp.tabs.advanced : '',
  ].filter(Boolean);
  const displayError = localError ?? (error instanceof Error ? error.message : null);
  const dialogOpen = searchParams.get('action') === 'new' || Boolean(searchParams.get('preset'));
  const choosingTemplate = searchParams.get('action') === 'new' && selectedStarter === null;
  const dialogTitle = isNew ? cp.newPreset : selected?.name ?? cp.editorTitle;
  const getToolGroupTitle = (key: BuiltinToolUiGroupKey) => m.agentsSettings.toolsDisableGroups[key];
  const getToolDescription = (toolId: string) =>
    toolId in m.agentsSettings.toolDescriptions
      ? m.agentsSettings.toolDescriptions[toolId as keyof typeof m.agentsSettings.toolDescriptions]
      : '';

  useEffect(() => {
    if (!data || busy) return;
    if (searchParams.get('action') === 'new') {
      setSelectedId('');
      setDraft(starterDraft('blank', cp));
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
    setSelectedStarter(null);
    setSelectedId(preset.id);
    setDraft(draftFromPreset(preset));
    setSearchParams({ preset: preset.id }, { replace: true });
    setActiveTab('overview');
  }

  function openNewPreset() {
    setSelectedStarter(null);
    setSelectedId('');
    setDraft(starterDraft('blank', cp));
    setLocalError(null);
    setSearchParams({ action: 'new' }, { replace: true });
    setActiveTab('overview');
  }

  function chooseTemplate(starter: StarterId) {
    setSelectedStarter(starter);
    setDraft(starterDraft(starter, cp));
    setLocalError(null);
    setActiveTab('overview');
  }

  function returnToTemplates() {
    if (selectedStarter) {
      const initialDraft = starterDraft(selectedStarter, cp);
      const changedFromTemplate =
        JSON.stringify(comparableDraft(draft, null)) !== JSON.stringify(comparableDraft(initialDraft, null));
      if (changedFromTemplate && !window.confirm(cp.changeTemplateConfirm)) return;
    }
    setSelectedStarter(null);
    setLocalError(null);
  }

  function closeDialog() {
    if (!choosingTemplate && dirty && !window.confirm(cp.discardConfirm)) return;
    setDeleteConfirmOpen(false);
    setDeleteError(null);
    setSearchParams({}, { replace: true });
    setSelectedStarter(null);
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
    for (const model of [draft.modelAdvanced.imageModel, draft.modelAdvanced.imageGenerationModel]) {
      const refs = [model.primary, ...model.fallbacks].map((item) => item.trim()).filter(Boolean);
      if (refs.some((ref) => !/^[^/\s]+\/.+/.test(ref))) {
        setLocalError(cp.invalidModelRef);
        setActiveTab('models');
        return;
      }
      if (model.timeoutMs.trim() && (!Number.isInteger(Number(model.timeoutMs)) || Number(model.timeoutMs) <= 0)) {
        setLocalError(cp.advancedPositiveIntegerError);
        setActiveTab('models');
        return;
      }
    }
    for (const policy of Object.values(draft.toolPolicies)) {
      const limits = [policy.limits?.maxCallsPerTurn, policy.limits?.timeoutMs].filter(
        (value): value is number => value !== undefined,
      );
      if (limits.some((value) => !Number.isInteger(value) || value <= 0)) {
        setLocalError(cp.advancedPositiveIntegerError);
        setActiveTab('tools');
        return;
      }
    }
    for (const field of Object.keys(draft.jsonFields) as PresetAdvancedFieldKey[]) {
      try {
        parseOptionalJson(draft.jsonFields[field]);
      } catch {
        setLocalError(
          cp.advancedJsonError.replace('{{field}}', cp.advancedFieldLabels[field]),
        );
        setActiveTab('advanced');
        return;
      }
    }
    setBusy(true);
    setLocalError(null);
    try {
      const policy = policyPayloadFromDraft(draft, selected);
      if (isNew) {
        const created = await createCapabilityPreset({
          id: draft.id.trim(),
          name: draft.name.trim(),
          ...(draft.description.trim() ? { description: draft.description.trim() } : {}),
          ...policy,
        });
        await mutate(created.presets, { revalidate: false });
        setSelectedId(created.presetId);
        setSelectedStarter(null);
        setSearchParams({ preset: created.presetId }, { replace: true });
      } else if (selected) {
        const next = await updateCapabilityPreset(selected.id, {
          name: draft.name.trim(),
          description: draft.description.trim() || null,
          extends: policy.extends ?? null,
          models: policy.models ?? null,
          tools: policy.tools ?? null,
          skills: policy.skills ?? null,
          workflows: policy.workflows ?? null,
          boundaries: policy.boundaries ?? null,
          runtime: policy.runtime ?? null,
          locks: policy.locks ?? null,
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
    setDeleteError(null);
    try {
      const next = await deleteCapabilityPreset(selected.id);
      await mutate(next, { revalidate: false });
      setDeleteConfirmOpen(false);
      setSelectedId('');
      setSelectedStarter(null);
      setDraft(starterDraft('blank', cp));
      setActiveTab('overview');
      setSearchParams({}, { replace: true });
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : cp.deleteError);
    } finally {
      setBusy(false);
    }
  }

  if (!hasToken) {
    return (
      <SettingsPageFrame gap="gap-3">
        <SettingsPageHeader title={cp.title} actions={manageAgentsAction} />
        <p className="text-sm text-fg-muted">{cp.needToken}</p>
      </SettingsPageFrame>
    );
  }

  return (
    <SettingsPageFrame gap="gap-5" className="pb-24">
      <SettingsPageHeader
        title={cp.title}
        subtitle={cp.subtitle}
        actions={
          <div className="flex flex-wrap items-center justify-end gap-2">
            {manageAgentsAction}
            <Button type="button" onClick={openNewPreset} disabled={busy}>
              <Plus className="size-4" aria-hidden />
              {cp.newPreset}
            </Button>
          </div>
        }
      />

      {displayError ? (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-200">
          {displayError}
        </div>
      ) : null}

      {isLoading ? (
        <SettingsPageSkeleton sections={2} />
      ) : (
        <div className="flex flex-col gap-5">
          {defaultPreset ? (
            <SettingsFormSection>
              <SettingsFormSectionHeader
                icon={Layers}
                title={cp.globalDefaultsTitle}
                subtitle={cp.globalDefaultsHint}
              />
              <button
                type="button"
                onClick={() => selectPreset(defaultPreset)}
                className="group rounded-lg bg-accent/5 px-4 py-3 text-left text-fg shadow-surface transition-colors hover:bg-accent/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-semibold text-fg">{defaultPreset.name}</span>
                      <span className="rounded-full bg-surface-panel px-2 py-0.5 text-[11px] font-medium text-accent">
                        {cp.globalDefaultsBadge}
                      </span>
                    </div>
                    <div className="mt-1 font-mono text-[11px] text-fg-subtle">{defaultPreset.id}</div>
                  </div>
                  <span className="shrink-0 rounded-full bg-surface-panel px-2 py-0.5 text-[11px] font-medium text-fg-muted">
                    {cp.globalDefaultsInherited}
                  </span>
                </div>
                {defaultPreset.description ? (
                  <p className="mt-3 line-clamp-2 text-xs leading-relaxed text-fg-muted">
                    {defaultPreset.description}
                  </p>
                ) : null}
                <div className="mt-3 text-xs text-fg-subtle">{presetSummary(defaultPreset, cp)}</div>
              </button>
            </SettingsFormSection>
          ) : null}

          <SettingsFormSection>
            <SettingsFormSectionHeader icon={Layers} title={cp.listTitle} subtitle={cp.listHint} />
            {sharedPresets.length === 0 ? (
              <div className="flex flex-col items-start gap-3 rounded-lg bg-surface-panel/70 px-3 py-4 text-sm text-fg-muted shadow-surface">
                <p>{cp.empty}</p>
                <Button type="button" variant="secondary" onClick={openNewPreset} disabled={busy}>
                  <Plus className="size-4" aria-hidden />
                  {cp.newPreset}
                </Button>
              </div>
            ) : (
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {sharedPresets.map((preset) => (
                  <button
                    key={preset.id}
                    type="button"
                    onClick={() => selectPreset(preset)}
                    className="group min-h-36 rounded-lg bg-surface-panel/80 px-4 py-3 text-left text-fg shadow-surface transition-colors hover:bg-surface-hover/55 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-semibold text-fg">{preset.name}</div>
                        <div className="mt-1 truncate font-mono text-[11px] text-fg-subtle">{preset.id}</div>
                      </div>
                      <span className="shrink-0 rounded-full bg-surface-hover px-2 py-0.5 text-[11px] font-medium text-fg-muted">
                        {preset.usage.length}
                      </span>
                    </div>
                    {preset.description ? (
                      <p className="mt-3 line-clamp-2 text-xs leading-relaxed text-fg-muted">
                        {preset.description}
                      </p>
                    ) : null}
                    <div className="mt-3 truncate text-xs text-fg-subtle">{presetSummary(preset, cp)}</div>
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
            ref={setPortalContainer}
            className={cn(
              'xopc-dialog-content fixed left-1/2 top-1/2 flex h-[min(90vh,760px)] w-[min(100%-2rem,64rem)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-xl border border-edge bg-surface-panel shadow-popover dark:border-edge',
              SETTINGS_SHELL_CONTENT_Z,
            )}
            onOpenAutoFocus={(e) => e.preventDefault()}
          >
            <SettingsShellLayerProvider layer="modal" portalContainer={portalContainer}>
              <div className="flex shrink-0 items-start justify-between gap-3 border-b border-edge-subtle px-4 py-3 dark:border-edge">
                <div className="flex min-w-0 items-start gap-2">
                  {!choosingTemplate && isNew && selectedStarter ? (
                    <button
                      type="button"
                      className={cn(ghostIconButton, 'shrink-0 p-1.5 hover:bg-surface-base')}
                      onClick={returnToTemplates}
                      aria-label={cp.changeTemplate}
                      title={cp.changeTemplate}
                    >
                      <ArrowLeft className="size-4" aria-hidden />
                    </button>
                  ) : null}
                  <div className="min-w-0">
                    <Dialog.Title className="truncate text-base font-semibold text-fg">{dialogTitle}</Dialog.Title>
                    <Dialog.Description className="mt-0.5 truncate text-xs text-fg-muted">
                      {choosingTemplate
                        ? cp.templatePickerSubtitle
                        : isNew && selectedStarter
                          ? `${cp.editorHint} · ${cp.basedOnTemplate.replace('{{template}}', cp.starters[selectedStarter].title)}`
                          : isNew
                            ? cp.editorHint
                            : draft.id}
                    </Dialog.Description>
                  </div>
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

              {choosingTemplate ? (
                <>
                  <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-5">
                    <div className="mx-auto grid max-w-3xl gap-3 sm:grid-cols-2">
                      {STARTER_IDS.map((starter) => (
                        <button
                          key={starter}
                          type="button"
                          className="group min-h-32 rounded-xl border border-edge-subtle bg-surface-base px-4 py-4 text-left text-fg transition-colors hover:border-edge hover:bg-surface-hover/55 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                          onClick={() => chooseTemplate(starter)}
                        >
                          <span className="flex items-center justify-between gap-3">
                            <span className="font-medium">{cp.starters[starter].title}</span>
                            {starter === 'blank' ? (
                              <span className="rounded-full bg-accent-soft px-2 py-0.5 text-[11px] font-medium text-accent-fg">
                                {cp.templateRecommended}
                              </span>
                            ) : null}
                          </span>
                          <span className="mt-2 block text-xs leading-relaxed text-fg-muted">
                            {cp.starters[starter].description}
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="flex shrink-0 justify-end border-t border-edge-subtle px-4 py-3 dark:border-edge">
                    <Button type="button" variant="secondary" onClick={closeDialog}>
                      {cp.cancel}
                    </Button>
                  </div>
                </>
              ) : (
                <>
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

              <div className="min-h-0 flex-1 overflow-y-auto p-4">
                <div className="w-full">
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
                  {!isNew && selected ? (
                    <div className="flex flex-col gap-1.5 text-sm">
                      <span className="font-medium text-fg">{cp.versionLabel}</span>
                      <div className="rounded-lg border border-edge bg-surface-base px-3 py-2 text-sm text-fg-muted">
                        {cp.versionAutomatic.replace('{{version}}', String(selected.version))}
                      </div>
                    </div>
                  ) : null}
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
                  <SummaryTile icon={Wrench} label={cp.toolsTitle} value={String(Object.keys(draft.toolPolicies).length)} />
                  <SummaryTile icon={Puzzle} label={cp.skillsTitle} value={cp.skillModeLabels[draft.skillMode]} />
                </div>
              </SettingsFormSection>
            ) : null}

            {activeTab === 'models' ? (
              <SettingsFormSection>
                <SettingsFormSectionHeader icon={Layers} title={cp.modelsTitle} subtitle={cp.modelsHint} />
                <PresetModelsEditor
                  rows={draft.modelRows}
                  onChange={(rows) => setDraft((prev) => ({ ...prev, modelRows: rows }))}
                  disabled={busy}
                  defaultRole={selected?.models?.defaultRole}
                  chat={m.chat}
                  labels={{
                    defaultTitle: cp.modelDefaultTitle,
                    defaultHint: cp.modelDefaultHint,
                    defaultBadge: cp.modelDefaultBadge,
                    roleId: cp.modelRoleIdLabel,
                    description: cp.modelRoleDescriptionLabel,
                    descriptionPlaceholder: cp.modelRoleDescriptionPlaceholder,
                    primaryModel: cp.modelPrimaryModelLabel,
                    fallbackModels: cp.modelFallbackModelsLabel,
                    addFallback: cp.modelAddFallback,
                    removeFallback: cp.modelRemoveFallback,
                    fallbackPlaceholder: cp.modelFallbackPlaceholder,
                    fallbackEmptyHint: cp.modelFallbackEmptyHint,
                    moreSettings: cp.modelMoreSettings,
                    otherRolesTitle: cp.modelOtherRolesTitle,
                    otherRolesHint: cp.modelOtherRolesHint,
                    otherRolesEmpty: cp.modelOtherRolesEmpty,
                    addTaskModel: cp.modelAddTaskModel,
                    customRole: cp.modelCustomRole,
                    removeRole: cp.removeModelRole,
                    roleIdPlaceholder: 'custom-role',
                    roleNames: cp.modelRoleNames,
                    roleDescriptions: cp.modelRoleDescriptions,
                  }}
                />
                <ModelAdvancedPolicyEditor
                  value={draft.modelAdvanced}
                  onChange={(modelAdvanced) => setDraft((prev) => ({ ...prev, modelAdvanced }))}
                  disabled={busy}
                  cp={cp}
                  chat={m.chat}
                />
              </SettingsFormSection>
            ) : null}

            {activeTab === 'tools' ? (
              <SettingsFormSection>
                <SettingsFormSectionHeader icon={Wrench} title={cp.toolsTitle} subtitle={cp.toolsHint} />
                <PresetToolsPolicyEditor
                  builtinToolIds={data?.builtinToolIds ?? []}
                  toolPolicies={draft.toolPolicies}
                  onChange={(toolPolicies) => setDraft((prev) => ({ ...prev, toolPolicies }))}
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
                    modeConfirm: cp.toolModes.confirm,
                    modeDeny: cp.toolModes.deny,
                    scopeLabel: cp.toolScopeLabel,
                    scopeInherit: cp.toolScopeInherit,
                    scopeReadonly: cp.toolScopeReadonly,
                    scopeWorkspace: cp.toolScopeWorkspace,
                    scopeUnrestricted: cp.toolScopeUnrestricted,
                    maxCallsLabel: cp.toolMaxCallsLabel,
                    timeoutLabel: cp.toolTimeoutLabel,
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

            {activeTab === 'advanced' ? (
              <SettingsFormSection>
                <SettingsFormSectionHeader
                  icon={SlidersHorizontal}
                  title={cp.advancedTitle}
                  subtitle={cp.advancedHint}
                />
                <PresetAdvancedPolicyEditor
                  extendsIds={draft.extendsIds}
                  onExtendsChange={(extendsIds) => setDraft((prev) => ({ ...prev, extendsIds }))}
                  presetOptions={presets.filter(
                    (preset) => preset.id !== selected?.id && preset.id !== defaultPresetId,
                  )}
                  jsonFields={draft.jsonFields}
                  onJsonFieldsChange={(jsonFields) => setDraft((prev) => ({ ...prev, jsonFields }))}
                  disabled={busy}
                  labels={{
                    inheritanceTitle: cp.advancedInheritanceTitle,
                    inheritanceHint: cp.advancedInheritanceHint,
                    inheritanceEmpty: cp.advancedInheritanceEmpty,
                    jsonTitle: cp.advancedJsonTitle,
                    jsonHint: cp.advancedJsonHint,
                    fieldLabels: cp.advancedFieldLabels,
                    fieldHints: cp.advancedFieldHints,
                  }}
                />
              </SettingsFormSection>
            ) : null}

            {activeTab === 'impact' ? (
              <SettingsFormSection>
                <SettingsFormSectionHeader icon={Eye} title={cp.usageTitle} subtitle={cp.usageHint} />
                <div className="mb-4 rounded-lg bg-surface-panel/70 px-3 py-2 shadow-surface">
                  <div className="text-xs font-medium text-fg-muted">{cp.changePreviewTitle}</div>
                  <p className="mt-1 text-sm text-fg">
                    {changedSections.length > 0
                      ? cp.changePreviewSections.replace('{{sections}}', changedSections.join('、'))
                      : cp.changePreviewEmpty}
                  </p>
                </div>
                {selected?.usage.length ? (
                  <div className="grid gap-2">
                    {selected.usage.map((usage) => (
                      <div key={usage.agentId} className="rounded-lg bg-surface-panel/80 px-3 py-2 shadow-surface">
                        <div className="text-sm font-medium text-fg">{usage.agentName || usage.agentId}</div>
                        <div className="mt-1 font-mono text-[11px] text-fg-muted">{usage.agentId}</div>
                        <div className="mt-1 text-[11px] text-fg-subtle">
                          {usage.direct ? cp.usageDirect : cp.usageIndirect}
                        </div>
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
                  {selected && !isDefaultPreset ? (
                    <Button
                      type="button"
                      variant="secondary"
                      disabled={busy}
                      onClick={() => {
                        setDeleteError(null);
                        setDeleteConfirmOpen(true);
                      }}
                    >
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
                </>
              )}
            </SettingsShellLayerProvider>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      <Dialog.Root
        open={deleteConfirmOpen}
        onOpenChange={(open) => {
          if (busy) return;
          setDeleteConfirmOpen(open);
          if (!open) setDeleteError(null);
        }}
      >
        <Dialog.Portal>
          <Dialog.Overlay className={cn('xopc-dialog-overlay fixed inset-0 bg-scrim', SETTINGS_SHELL_OVERLAY_Z)} />
          <Dialog.Content
            className={cn(
              'xopc-dialog-content fixed left-1/2 top-1/2 w-[min(100%-2rem,28rem)] -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-xl border border-edge bg-surface-panel shadow-popover dark:border-edge',
              SETTINGS_SHELL_CONTENT_Z,
            )}
            onOpenAutoFocus={(event) => event.preventDefault()}
          >
            <div className="border-b border-edge-subtle px-4 py-3 dark:border-edge">
              <Dialog.Title className="text-base font-semibold text-fg">{cp.deleteDialogTitle}</Dialog.Title>
              <Dialog.Description className="mt-1 text-sm leading-relaxed text-fg-muted">
                {selected ? cp.deleteConfirm.replace('{{name}}', selected.name) : cp.deleteConfirmFallback}
              </Dialog.Description>
            </div>

            {deleteError ? (
              <div className="mx-4 mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-200">
                {deleteError}
              </div>
            ) : null}

            <div className="flex justify-end gap-2 px-4 py-3">
              <Button type="button" variant="secondary" disabled={busy} onClick={() => setDeleteConfirmOpen(false)}>
                {cp.cancel}
              </Button>
              <Button
                type="button"
                disabled={busy || !selected}
                className="bg-red-600 text-white shadow-surface hover:bg-red-700 focus-visible:ring-red-600 dark:bg-red-500 dark:hover:bg-red-600"
                onClick={() => void onDelete()}
              >
                {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Trash2 className="size-4" aria-hidden />}
                {busy ? cp.deleting : cp.delete}
              </Button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </SettingsPageFrame>
  );
}

function SummaryTile({ icon: Icon, label, value }: { icon: typeof Copy; label: string; value: string }) {
  return (
    <div className="rounded-lg bg-surface-panel/80 px-3 py-2 shadow-surface">
      <div className="flex items-center gap-2 text-xs text-fg-muted">
        <Icon className="size-3.5" aria-hidden />
        {label}
      </div>
      <div className="mt-1 text-sm font-medium text-fg">{value}</div>
    </div>
  );
}

function ModelAdvancedPolicyEditor(props: {
  value: ModelAdvancedDraft;
  onChange: (value: ModelAdvancedDraft) => void;
  disabled?: boolean;
  cp: CapabilityPresetMessages;
  chat: ChatMessages;
}) {
  const { value, onChange, disabled, cp, chat } = props;
  const {
    data: imageProviders,
    isLoading: imageModelsLoading,
    error: imageModelsError,
  } = useSWR('capability-preset-image-generation-models', fetchImageCatalog, {
    revalidateOnFocus: false,
  });
  const imageGenerationModels = useMemo<ConfiguredModel[]>(
    () => (imageProviders ?? [])
      .filter((provider) => provider.configured || provider.credentialMode === 'none')
      .flatMap((provider) =>
        provider.models.map((model) => ({
          id: `${provider.id}/${model}`,
          name: model,
          provider: provider.label,
        })),
      ),
    [imageProviders],
  );
  const imageGenerationModelIds = useMemo(
    () => new Set(imageGenerationModels.map((model) => model.id)),
    [imageGenerationModels],
  );

  useEffect(() => {
    if (!imageProviders) return;
    const current = value.imageGenerationModel;
    const primary = imageGenerationModelIds.has(current.primary) ? current.primary : '';
    const fallbacks = current.fallbacks.filter((model) => imageGenerationModelIds.has(model));
    if (primary === current.primary && fallbacks.length === current.fallbacks.length) return;
    onChange({
      ...value,
      imageGenerationModel: { ...current, primary, fallbacks },
    });
  }, [imageGenerationModelIds, imageProviders, onChange, value]);

  const updateModel = (key: 'imageModel' | 'imageGenerationModel', next: ToolModelDraft) => {
    onChange({ ...value, [key]: next });
  };

  return (
    <div className="mt-5 grid gap-3 border-t border-edge-subtle pt-5 dark:border-edge">
      <details className="group rounded-xl border border-edge bg-surface-base">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 p-4">
          <div className="min-w-0">
            <h4 className="text-sm font-semibold text-fg">{cp.modelSpecializedTitle}</h4>
            <p className="mt-1 text-xs leading-relaxed text-fg-muted">
              {cp.modelSpecializedSummary
                .replace('{{image}}', value.imageModel.primary || cp.modelNotSet)
                .replace('{{generation}}', value.imageGenerationModel.primary || cp.modelNotSet)}
            </p>
          </div>
          <ChevronDown className="size-4 shrink-0 text-fg-subtle transition-transform group-open:rotate-180" aria-hidden />
        </summary>
        <div className="grid gap-3 border-t border-edge-subtle p-4 dark:border-edge lg:grid-cols-2">
          <ToolModelPolicyCard
            title={cp.imageUnderstandingTitle}
            value={value.imageModel}
            onChange={(next) => updateModel('imageModel', next)}
            disabled={disabled}
            cp={cp}
            chat={chat}
            capabilitiesFilter="vision"
          />
          <ToolModelPolicyCard
            title={cp.imageGenerationTitle}
            value={value.imageGenerationModel}
            onChange={(next) => updateModel('imageGenerationModel', next)}
            disabled={disabled}
            cp={cp}
            chat={chat}
            models={imageGenerationModels}
            modelsLoading={imageModelsLoading}
            modelsError={imageModelsError}
            noMatches={cp.modelNoConfiguredImageModels}
            settingsFooterLink={{
              label: cp.modelImageSettingsLink,
              path: '/settings/capabilities/image',
            }}
          />
        </div>
      </details>

      <details className="group rounded-xl border border-edge bg-surface-base">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 p-4">
          <div className="min-w-0">
            <h4 className="text-sm font-semibold text-fg">{cp.modelAdvancedTitle}</h4>
            <p className="mt-1 text-xs leading-relaxed text-fg-muted">{cp.modelAdvancedHint}</p>
          </div>
          <ChevronDown className="size-4 shrink-0 text-fg-subtle transition-transform group-open:rotate-180" aria-hidden />
        </summary>
        <div className="grid gap-3 border-t border-edge-subtle p-4 dark:border-edge sm:grid-cols-2">
          <label className="flex flex-col gap-1.5 text-sm">
            <span className="font-medium text-fg">{cp.modelAllowFallbacksLabel}</span>
            <Select
              value={value.allowFallbacks}
              disabled={disabled}
              side="top"
              onChange={(event) => onChange({
                ...value,
                allowFallbacks: event.target.value as ModelAdvancedDraft['allowFallbacks'],
              })}
            >
              <SelectOption value="">{cp.policyInherit}</SelectOption>
              <SelectOption value="true">{cp.policyEnabled}</SelectOption>
              <SelectOption value="false">{cp.policyDisabled}</SelectOption>
            </Select>
          </label>
          <label className="flex flex-col gap-1.5 text-sm">
            <span className="font-medium text-fg">{cp.modelMaxCostTierLabel}</span>
            <Select
              value={value.maxCostTier}
              disabled={disabled}
              side="top"
              onChange={(event) => onChange({
                ...value,
                maxCostTier: event.target.value as ModelAdvancedDraft['maxCostTier'],
              })}
            >
              <SelectOption value="">{cp.policyInherit}</SelectOption>
              <SelectOption value="low">{cp.costTierLow}</SelectOption>
              <SelectOption value="medium">{cp.costTierMedium}</SelectOption>
              <SelectOption value="high">{cp.costTierHigh}</SelectOption>
            </Select>
          </label>
        </div>
      </details>
    </div>
  );
}

function ToolModelPolicyCard(props: {
  title: string;
  value: ToolModelDraft;
  onChange: (value: ToolModelDraft) => void;
  disabled?: boolean;
  cp: CapabilityPresetMessages;
  chat: ChatMessages;
  capabilitiesFilter?: 'vision';
  models?: ConfiguredModel[];
  modelsLoading?: boolean;
  modelsError?: unknown;
  noMatches?: string;
  settingsFooterLink?: { label: string; path: string };
}) {
  const {
    title,
    value,
    onChange,
    disabled,
    cp,
    chat,
    capabilitiesFilter,
    models,
    modelsLoading,
    modelsError,
    noMatches,
    settingsFooterLink,
  } = props;
  const inputClass = 'rounded-lg border border-edge bg-surface-base px-3 py-2 text-sm text-fg placeholder:text-fg-subtle focus:border-edge-strong focus:outline-none';
  const updateFallback = (index: number, modelId: string) => {
    onChange({
      ...value,
      fallbacks: value.fallbacks.map((fallback, fallbackIndex) =>
        fallbackIndex === index ? modelId : fallback,
      ),
    });
  };
  return (
    <div className="rounded-lg bg-surface-panel/70 shadow-surface">
      <div className="flex items-center justify-between gap-2 px-3 py-2.5">
        <span className="text-sm font-medium text-fg">{title}</span>
        <span className="max-w-48 truncate font-mono text-xs text-fg-muted">
          {value.primary || cp.modelNotSet}
        </span>
      </div>
      <div className="grid gap-3 border-t border-edge-subtle p-3 dark:border-edge">
        <div className="grid gap-1">
          <div className="text-xs text-fg-muted">{cp.modelToolPrimaryLabel}</div>
          <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
            <ModelSelector
              value={value.primary}
              disabled={disabled}
              placeholder={chat.modelPlaceholder}
              searchPlaceholder={chat.modelSearchPlaceholder}
              noMatches={noMatches ?? chat.modelNoMatches}
              models={models}
              modelsLoading={modelsLoading}
              modelsError={modelsError}
              settingsFooterLink={settingsFooterLink}
              capabilitiesFilter={capabilitiesFilter}
              className="w-full max-w-none"
              contentAlign="start"
              onChange={(modelId) => onChange({ ...value, primary: modelId })}
            />
            {value.primary ? (
              <Button
                type="button"
                variant="secondary"
                className="shrink-0 px-2"
                disabled={disabled}
                aria-label={cp.modelClearSelection}
                onClick={() => onChange({ ...value, primary: '' })}
              >
                <X className="size-4" strokeWidth={1.75} />
              </Button>
            ) : null}
          </div>
        </div>
        <div className="grid gap-1.5">
          <div className="flex items-center justify-between gap-2">
            <div className="text-xs text-fg-muted">{cp.modelToolFallbacksLabel}</div>
            <Button
              type="button"
              variant="secondary"
              className="h-7 gap-1 px-2 text-xs"
              disabled={disabled}
              onClick={() => onChange({ ...value, fallbacks: [...value.fallbacks, ''] })}
            >
              <Plus className="size-3.5" strokeWidth={1.75} />
              {cp.modelAddFallback}
            </Button>
          </div>
          {value.fallbacks.length > 0 ? (
            <div className="grid gap-1.5">
              {value.fallbacks.map((fallback, index) => (
                <div key={`fallback-${index}`} className="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
                  <ModelSelector
                    value={fallback}
                    disabled={disabled}
                    placeholder={cp.modelFallbackPlaceholder}
                    searchPlaceholder={chat.modelSearchPlaceholder}
                    noMatches={noMatches ?? chat.modelNoMatches}
                    models={models}
                    modelsLoading={modelsLoading}
                    modelsError={modelsError}
                    settingsFooterLink={settingsFooterLink}
                    capabilitiesFilter={capabilitiesFilter}
                    className="w-full max-w-none"
                    contentAlign="start"
                    onChange={(modelId) => updateFallback(index, modelId)}
                  />
                  <Button
                    type="button"
                    variant="secondary"
                    className="shrink-0 px-2"
                    disabled={disabled}
                    aria-label={cp.modelRemoveFallback}
                    onClick={() => onChange({
                      ...value,
                      fallbacks: value.fallbacks.filter((_, fallbackIndex) => fallbackIndex !== index),
                    })}
                  >
                    <Trash2 className="size-4" strokeWidth={1.75} />
                  </Button>
                </div>
              ))}
            </div>
          ) : (
            <div className="rounded-lg bg-surface-base px-3 py-2 text-xs text-fg-muted">
              {cp.modelFallbackEmptyHint}
            </div>
          )}
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-xs text-fg-muted">
            {cp.toolTimeoutLabel}
            <input
              type="number"
              min={1}
              step={1}
              className={inputClass}
              value={value.timeoutMs}
              disabled={disabled}
              onChange={(event) => onChange({ ...value, timeoutMs: event.target.value })}
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-fg-muted">
            {cp.modelAutoProviderFallbackLabel}
            <Select
              value={value.autoProviderFallback}
              disabled={disabled}
              side="top"
              onChange={(event) => onChange({
                ...value,
                autoProviderFallback: event.target.value as ToolModelDraft['autoProviderFallback'],
              })}
            >
              <SelectOption value="">{cp.policyInherit}</SelectOption>
              <SelectOption value="true">{cp.policyEnabled}</SelectOption>
              <SelectOption value="false">{cp.policyDisabled}</SelectOption>
            </Select>
          </label>
        </div>
      </div>
    </div>
  );
}
