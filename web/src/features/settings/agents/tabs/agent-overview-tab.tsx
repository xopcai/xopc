import * as Dialog from '@radix-ui/react-dialog';
import { useCallback, useRef } from 'react';
import { AlertTriangle, ArrowDown, ArrowUp, Cog, ExternalLink, Eye, MessageSquarePlus, Pencil, Plus, Sparkles, Trash2, User, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { MarkdownEditor } from '@/components/markdown/markdown-editor';
import { MarkdownView } from '@/components/markdown/markdown-view';
import { ModelSelector } from '@/features/chat/model/model-selector';
import { DirectoryPickerPathField } from '@/features/fs/directory-picker-path-field';
import type { GatewayAgentRow } from '@/features/settings/agents-admin-api';
import type { CapabilityPresetRow } from '@/features/settings/capability-presets/capability-presets-api';
import type { OverviewProfileDraft } from '@/features/settings/agents/hooks/use-agent-overview-profile-markdown';
import { SettingsFormSection, SettingsFormSectionHeader } from '@/features/settings/settings-form-section';
import type { AgentsSettingsMessages, ChatMessages } from '@/i18n/messages';
import { cn } from '@/lib/cn';
import { ghostIconButton, interaction } from '@/lib/interaction';
import {
  SETTINGS_SHELL_CONTENT_Z,
  SETTINGS_SHELL_OVERLAY_Z,
} from '@/lib/settings-shell-dialog-layer';
import { useLocaleStore } from '@/stores/locale-store';
import { useThemeStore } from '@/stores/theme-store';

import { AgentConfigInheritanceSummary } from '../agent-config-inheritance-summary';
import { AgentAvatarDisplay } from '../agent-avatar-display';
import { AgentAvatarPicker } from '../agent-avatar-picker';
import { agentsSettingsInputClass } from '../utils';
import {
  CREATURE_PRESETS,
  SOUL_TEMPLATES,
  type SoulTemplateId,
} from '../agent-profile-markdown';

export function AgentOverviewTab(props: {
  a: AgentsSettingsMessages;
  chat: ChatMessages;
  selected: GatewayAgentRow | null;
  busy: boolean;
  editName: string;
  setEditName: (v: string) => void;
  editDescription: string;
  setEditDescription: (v: string) => void;
  editWorkspace: string;
  setEditWorkspace: (v: string) => void;
  editModel: string;
  setEditModel: (v: string) => void;
  onSetDefault: () => void;
  onSaveAgentEdits: () => void;
  onDelete: (purge: boolean) => void;
  capabilityPresets: CapabilityPresetRow[];
  defaultPresetId?: string;
  onUpdateAgentExtends: (nextExtends: string[]) => void;
  onOpenCapabilityPreset: (presetId: string) => void;
  hideInlineSave?: boolean;
  profileMarkdownLoading: boolean;
  profileDraft: OverviewProfileDraft | null;
  updateIdentity: (patch: Partial<OverviewProfileDraft['identity']>) => void;
  handleSoulTemplateChange: (templateId: SoulTemplateId) => void;
  handleSoulContentChange: (content: string) => void;
  setAvatarDialogOpen: (open: boolean) => void;
  toggleSoulPreviewMode: () => void;
  defaultModel?: string;
  defaultWorkspace?: string;
  onTryInChat?: () => void;
  onEditModelStrategy?: () => void;
}) {
  const {
    a,
    chat,
    selected,
    busy,
    editName,
    setEditName,
    editDescription,
    setEditDescription,
    editWorkspace,
    setEditWorkspace,
    editModel,
    setEditModel,
    onSetDefault,
    onSaveAgentEdits,
    onDelete,
    capabilityPresets,
    onUpdateAgentExtends,
    onOpenCapabilityPreset,
    hideInlineSave,
    profileMarkdownLoading,
    profileDraft,
    updateIdentity,
    handleSoulTemplateChange,
    handleSoulContentChange,
    setAvatarDialogOpen,
    toggleSoulPreviewMode,
    defaultModel = '',
    defaultWorkspace = '',
    defaultPresetId = 'default',
    onTryInChat,
    onEditModelStrategy,
  } = props;

  const language = useLocaleStore((s) => s.language);
  const isDark = useThemeStore((s) => s.resolved === 'dark');
  const workspaceFieldRef = useRef<HTMLDivElement | null>(null);

  const identity = profileDraft?.identity ?? { name: '', description: '', language: '', creature: '', emoji: '', avatar: '' };
  const soulTemplate = profileDraft?.soulTemplate ?? 'professional';
  const soulCustomContent = profileDraft?.soulCustomContent ?? '';
  const soulEditorNonce = profileDraft?.soulEditorNonce ?? 0;
  const soulPreviewMode = profileDraft?.soulPreviewMode ?? false;
  const avatarDialogOpen = profileDraft?.avatarDialogOpen ?? false;

  const locLabel = useCallback(
    (en: string, zh: string) => (language === 'zh' ? zh : en),
    [language],
  );

  const inputClass = agentsSettingsInputClass();
  const presetById = new Map(capabilityPresets.map((preset) => [preset.id, preset]));
  const globalDefaultsPreset =
    presetById.get(defaultPresetId) ?? {
      id: defaultPresetId,
      name: a.capabilityPresetsGlobalDefault,
      description: a.capabilityPresetsGlobalDefaultHint,
    };
  const explicitPresetIds = selected?.extends.filter((id) => id !== defaultPresetId) ?? [];
  const availablePresetIds = capabilityPresets
    .map((preset) => preset.id)
    .filter((id) => id !== defaultPresetId && !explicitPresetIds.includes(id));
  const selectedPresetId = availablePresetIds[0] ?? '';
  const focusWorkspaceField = useCallback(() => {
    const field = workspaceFieldRef.current;
    field?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    window.setTimeout(() => {
      field?.querySelector('input')?.focus();
    }, 180);
  }, []);

  if (!selected) {
    return <p className="text-sm text-fg-muted">{a.selectAgentHint}</p>;
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-8 overflow-y-auto">
      <AgentConfigInheritanceSummary
        a={a}
        defaultModel={defaultModel}
        defaultWorkspace={defaultWorkspace}
        agentModel={editModel}
        agentWorkspace={editWorkspace}
        onEditModelStrategy={onEditModelStrategy}
        onEditWorkspace={focusWorkspaceField}
      />

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
          {globalDefaultsPreset ? (
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
          ) : null}
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
          ) : globalDefaultsPreset ? (
            <div className="rounded-lg border border-dashed border-edge-subtle px-3 py-3 text-sm text-fg-muted">
              {a.capabilityPresetsEmptyAdditional}
            </div>
          ) : (
            <div className="rounded-lg border border-dashed border-edge-subtle px-3 py-3 text-sm text-fg-muted">
              {a.capabilityPresetsEmpty}
            </div>
          )}
        </div>
        {availablePresetIds.length > 0 ? (
          <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
            <select
              className="min-w-0 flex-1 rounded-lg border border-edge bg-surface-panel px-3 py-2 text-sm text-fg focus:border-edge-strong focus:outline-none"
              disabled={busy}
              defaultValue={selectedPresetId}
              onChange={(e) => {
                e.currentTarget.dataset.value = e.target.value;
              }}
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
              onClick={(e) => {
                const select = e.currentTarget.parentElement?.querySelector('select');
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

      {/* ===== Section 1: Basic Identity ===== */}
      <SettingsFormSection>
        <SettingsFormSectionHeader
          icon={Sparkles}
          title={a.personaSectionIdentity}
          subtitle={a.personaSectionIdentityHint}
          iconLeading={
            <AgentAvatarDisplay
              agentId={selected.id}
              avatar={identity.avatar}
              size={36}
              className="size-9 rounded-lg"
            />
          }
          iconInteractive={{
            onClick: () => setAvatarDialogOpen(true),
            ariaLabel: a.avatarOpenSettingsAria,
            id: 'agent-avatar-settings',
          }}
          trailing={
            !selected.isDefault ? (
              <Button
                type="button"
                variant="secondary"
                className="text-xs"
                disabled={busy}
                onClick={() => void onSetDefault()}
              >
                {a.setDefault}
              </Button>
            ) : null
          }
        />

        <Dialog.Root open={avatarDialogOpen} onOpenChange={setAvatarDialogOpen}>
          <Dialog.Portal>
            <Dialog.Overlay
              className={cn('fixed inset-0 bg-scrim backdrop-blur-[2px]', SETTINGS_SHELL_OVERLAY_Z)}
            />
            <Dialog.Content
              className={cn(
                'fixed left-1/2 top-1/2 w-[min(calc(100vw-2rem),26rem)] max-h-[min(90dvh,36rem)] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-xl border border-edge bg-surface-panel p-4 shadow-popover dark:border-edge',
                SETTINGS_SHELL_CONTENT_Z,
              )}
              onOpenAutoFocus={(e) => e.preventDefault()}
            >
              <div className="mb-3 flex items-start justify-between gap-2">
                <Dialog.Title className="text-base font-semibold text-fg">{a.avatarPickerTitle}</Dialog.Title>
                <Dialog.Close asChild>
                  <button
                    type="button"
                    className={cn(ghostIconButton, 'shrink-0 p-1.5 hover:bg-surface-base')}
                    aria-label={a.closeDialogAria}
                  >
                    <X className="size-4" aria-hidden />
                  </button>
                </Dialog.Close>
              </div>
              <Dialog.Description className="sr-only">{a.avatarRowHint}</Dialog.Description>
              <AgentAvatarPicker
                agentId={selected.id}
                value={identity.avatar}
                onChange={(next) => updateIdentity({ avatar: next })}
                a={a}
              />
            </Dialog.Content>
          </Dialog.Portal>
        </Dialog.Root>

        <div className="grid gap-4 sm:grid-cols-2">
          <label className="flex flex-col gap-1.5 text-sm">
            <span className="font-medium text-fg">{a.displayName}</span>
            <input
              className={inputClass}
              value={editName}
              onChange={(e) => {
                setEditName(e.target.value);
                updateIdentity({ name: e.target.value });
              }}
              placeholder={a.personaNamePlaceholder}
              autoComplete="off"
            />
          </label>

          <label className="flex flex-col gap-1.5 text-sm">
            <span className="font-medium text-fg">{a.personaEmoji}</span>
            <input
              className={inputClass}
              value={identity.emoji}
              onChange={(e) => updateIdentity({ emoji: e.target.value })}
              placeholder={a.personaEmojiPlaceholder}
              autoComplete="off"
            />
          </label>

          <label className="flex flex-col gap-1.5 text-sm sm:col-span-2">
            <span className="font-medium text-fg">{a.agentDescription}</span>
            <textarea
              className={cn(inputClass, 'min-h-16 resize-y text-sm leading-relaxed')}
              value={editDescription}
              onChange={(e) => {
                setEditDescription(e.target.value);
                updateIdentity({ description: e.target.value });
              }}
              placeholder={a.agentDescriptionPlaceholder}
              maxLength={4000}
              rows={3}
              spellCheck
            />
          </label>

          <div className="flex flex-col gap-1.5 text-sm">
            <span className="font-medium text-fg">{a.personaCreature}</span>
            <select
              className={inputClass}
              value={CREATURE_PRESETS.some((p) => p.value === identity.creature) ? identity.creature : '__custom__'}
              onChange={(e) => {
                if (e.target.value === '__custom__') {
                  updateIdentity({ creature: '' });
                  return;
                }
                updateIdentity({ creature: e.target.value });
              }}
            >
              {CREATURE_PRESETS.map((preset) => (
                <option key={preset.value} value={preset.value}>
                  {locLabel(preset.labelEn, preset.labelZh)}
                </option>
              ))}
              <option value="__custom__">{locLabel('Custom…', '自定义…')}</option>
            </select>
            {!CREATURE_PRESETS.some((p) => p.value === identity.creature) ? (
              <input
                className={cn(inputClass, 'mt-1 text-xs')}
                value={identity.creature}
                onChange={(e) => updateIdentity({ creature: e.target.value })}
                placeholder={a.personaCreaturePlaceholder}
                autoComplete="off"
              />
            ) : null}
          </div>
        </div>
      </SettingsFormSection>

      {/* ===== Section 2: Runtime Configuration ===== */}
      <SettingsFormSection>
        <SettingsFormSectionHeader icon={Cog} title={a.editAgent} subtitle={a.editAgentHint} />
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5 text-sm sm:col-span-2">
            <span className="font-medium text-fg">{a.modelPrimary}</span>
            <div className="flex flex-wrap items-stretch gap-2">
              <ModelSelector
                className="min-w-0 flex-1"
                value={editModel}
                disabled={busy}
                placeholder={chat.modelPlaceholder}
                searchPlaceholder={chat.modelSearchPlaceholder}
                noMatches={chat.modelNoMatches}
                onChange={(id) => setEditModel(id)}
              />
              {editModel.trim() ? (
                <Button type="button" variant="secondary" className="shrink-0" disabled={busy} onClick={() => setEditModel('')}>
                  {a.modelClear}
                </Button>
              ) : null}
            </div>
          </div>
          <div ref={workspaceFieldRef} className="flex flex-col gap-1.5 text-sm sm:col-span-2">
            <span className="font-medium text-fg">{a.workspacePath}</span>
            <DirectoryPickerPathField
              value={editWorkspace}
              onChange={setEditWorkspace}
              disabled={busy}
              wd={chat.workingDirectory}
              placeholder={chat.workingDirectory.notSet}
              inputClassName={cn(inputClass, 'font-mono text-xs')}
            />
          </div>
        </div>
        {!hideInlineSave ? (
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <Button type="button" disabled={busy} onClick={() => void onSaveAgentEdits()}>
              {a.save}
            </Button>
            {onTryInChat ? (
              <Button type="button" variant="secondary" disabled={busy} onClick={onTryInChat}>
                <MessageSquarePlus className="mr-1.5 size-4" aria-hidden />
                {a.tryInChat}
              </Button>
            ) : null}
          </div>
        ) : null}
      </SettingsFormSection>

      {/* ===== Section 3: Personality & Style ===== */}
      {profileMarkdownLoading ? (
        <p className="text-sm text-fg-muted">{a.loading}</p>
      ) : (
        <SettingsFormSection>
          <SettingsFormSectionHeader icon={User} title={a.personaSectionSoul} subtitle={a.personaSectionSoulHint} />
          <div className="mb-4 flex flex-col gap-2">
            <span className="text-sm font-medium text-fg">{a.personaSoulTemplate}</span>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {SOUL_TEMPLATES.map((template) => (
                <button
                  key={template.id}
                  type="button"
                  className={cn(
                    'flex flex-col items-center gap-1.5 rounded-xl border-2 p-3 text-center transition-all',
                    interaction.pressCard,
                    soulTemplate === template.id
                      ? 'border-accent bg-accent-soft/40 shadow-sm'
                      : 'border-edge hover:border-accent/40 hover:bg-surface-hover',
                  )}
                  onClick={() => handleSoulTemplateChange(template.id)}
                >
                  <span className="text-xl">{template.emoji}</span>
                  <span className="text-xs font-medium text-fg">{locLabel(template.labelEn, template.labelZh)}</span>
                </button>
              ))}
            </div>
          </div>
          {soulTemplate === 'custom' ? (
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between gap-3">
                <span className="text-sm font-medium text-fg">{a.personaSoulCustomEdit}</span>
                <button
                  type="button"
                  className={cn(
                    ghostIconButton,
                    'inline-flex size-9 shrink-0 items-center justify-center rounded-md p-0 hover:bg-surface-hover',
                  )}
                  title={soulPreviewMode ? a.personaSoulEdit : a.personaSoulPreview}
                  aria-label={soulPreviewMode ? a.personaSoulEdit : a.personaSoulPreview}
                  onClick={toggleSoulPreviewMode}
                >
                  {soulPreviewMode ? <Pencil className="size-4" aria-hidden /> : <Eye className="size-4" aria-hidden />}
                </button>
              </div>
              <div className={cn(inputClass, 'flex min-h-64 flex-col overflow-hidden p-0')}>
                {soulPreviewMode ? (
                  <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
                    <MarkdownView content={soulCustomContent} />
                  </div>
                ) : (
                  <MarkdownEditor
                    key={`soul-${soulEditorNonce}`}
                    initialContent={soulCustomContent}
                    onChange={handleSoulContentChange}
                    isDark={isDark}
                    className="min-h-0 flex-1"
                  />
                )}
              </div>
            </div>
          ) : null}
        </SettingsFormSection>
      )}

      {/* ===== Section 4: Danger Zone ===== */}
      {selected.id !== 'main' ? (
        <SettingsFormSection>
          <SettingsFormSectionHeader
            icon={AlertTriangle}
            title={locLabel('Danger Zone', '危险操作')}
            subtitle={locLabel(
              'Actions that cannot be undone. Be careful.',
              '以下操作不可撤销，请谨慎操作。',
            )}
          />
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="secondary" disabled={busy} onClick={() => void onDelete(false)}>
              <Trash2 className="mr-1 size-4" aria-hidden />
              {a.removeFromConfig}
            </Button>
            <Button
              type="button"
              variant="secondary"
              className="border-red-200 text-red-700 hover:bg-red-50 dark:border-red-900/60 dark:text-red-300 dark:hover:bg-red-950/40"
              disabled={busy}
              onClick={() => void onDelete(true)}
            >
              {a.purgeDisk}
            </Button>
          </div>
        </SettingsFormSection>
      ) : null}
    </div>
  );
}
