import * as Dialog from '@radix-ui/react-dialog';
import { useCallback } from 'react';
import { Cog, Eye, MessageSquarePlus, Pencil, Sparkles, User, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { MarkdownEditor } from '@/components/markdown/markdown-editor';
import { MarkdownView } from '@/components/markdown/markdown-view';
import { ModelSelector } from '@/features/chat/model/model-selector';
import { DirectoryPickerPathField } from '@/features/fs/directory-picker-path-field';
import type { GatewayAgentRow } from '@/features/settings/agents-admin-api';
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
  onSetTuiDefault: () => void;
  isTuiDefault: boolean;
  isTuiDefaultInherited: boolean;
  onSaveAgentEdits: () => void;
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
    onSetTuiDefault,
    isTuiDefault,
    isTuiDefaultInherited,
    onSaveAgentEdits,
    hideInlineSave,
    profileMarkdownLoading,
    profileDraft,
    updateIdentity,
    handleSoulTemplateChange,
    handleSoulContentChange,
    setAvatarDialogOpen,
    toggleSoulPreviewMode,
    onTryInChat,
  } = props;

  const language = useLocaleStore((s) => s.language);
  const isDark = useThemeStore((s) => s.resolved === 'dark');
  const identity = profileDraft?.identity ?? { name: '', description: '', language: '', creature: '', emoji: '', avatar: '' };
  const soulTemplate = profileDraft?.soulTemplate ?? 'professional';
  const soulCustomContent = profileDraft?.soulCustomContent ?? '';
  const soulEditorNonce = profileDraft?.soulEditorNonce ?? 0;
  const soulPreviewMode = profileDraft?.soulPreviewMode ?? false;
  const avatarDialogOpen = profileDraft?.avatarDialogOpen ?? false;

  const inputClass = agentsSettingsInputClass();
  const locLabel = useCallback(
    (en: string, zh: string) => (language === 'zh' ? zh : en),
    [language],
  );

  if (!selected) {
    return <p className="text-sm text-fg-muted">{a.selectAgentHint}</p>;
  }

  return (
    <div className="flex flex-col gap-8">
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
          titleAccessory={
            selected.isDefault || isTuiDefault ? (
              <div className="flex flex-wrap items-center gap-1.5">
                {selected.isDefault ? (
                  <span className="rounded-full bg-accent-soft px-2 py-0.5 text-xs font-medium text-accent">
                    {a.globalDefaultBadge}
                  </span>
                ) : null}
                {isTuiDefault ? (
                  <span className="rounded-full bg-surface-hover px-2 py-0.5 text-xs font-medium text-fg">
                    {isTuiDefaultInherited ? a.tuiDefaultInheritedBadge : a.tuiDefaultBadge}
                  </span>
                ) : null}
              </div>
            ) : null
          }
          trailing={
            !selected.isDefault || !isTuiDefault ? (
              <div className="flex flex-wrap items-center justify-end gap-2">
                {!selected.isDefault ? (
                  <Button
                    type="button"
                    variant="secondary"
                    className="text-xs"
                    disabled={busy}
                    onClick={() => void onSetDefault()}
                  >
                    {a.setDefault}
                  </Button>
                ) : null}
                {!isTuiDefault ? (
                  <Button
                    type="button"
                    variant="secondary"
                    className="text-xs"
                    disabled={busy}
                    onClick={() => void onSetTuiDefault()}
                  >
                    {a.setTuiDefault}
                  </Button>
                ) : null}
              </div>
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
          <div className="flex flex-col gap-1.5 text-sm sm:col-span-2">
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

    </div>
  );
}
