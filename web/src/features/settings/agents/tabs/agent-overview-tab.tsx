import * as Dialog from '@radix-ui/react-dialog';
import { useCallback } from 'react';
import { Brain, Eye, ExternalLink, Pencil, Sparkles, User, X } from 'lucide-react';
import { Link } from 'react-router-dom';

import { MarkdownEditor } from '@/components/markdown/markdown-editor';
import { MarkdownView } from '@/components/markdown/markdown-view';
import { Select, SelectOption } from '@/components/ui/popover-select';
import type { GatewayAgentRow } from '@/features/settings/agents-admin-api';
import type { OverviewProfileDraft } from '@/features/settings/agents/hooks/use-agent-overview-profile-markdown';
import { SettingsPanelSkeleton } from '@/features/settings/settings-loading-skeleton';
import { SettingsFormSection, SettingsFormSectionHeader } from '@/features/settings/settings-form-section';
import type { AgentsSettingsMessages } from '@/i18n/messages';
import { cn } from '@/lib/cn';
import { ghostIconButton } from '@/lib/interaction';
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
  selected: GatewayAgentRow | null;
  busy: boolean;
  editName: string;
  setEditName: (v: string) => void;
  editDescription: string;
  setEditDescription: (v: string) => void;
  profileMarkdownLoading: boolean;
  profileDraft: OverviewProfileDraft | null;
  updateIdentity: (patch: Partial<OverviewProfileDraft['identity']>) => void;
  handleSoulTemplateChange: (templateId: SoulTemplateId) => void;
  handleSoulContentChange: (content: string) => void;
  setAvatarDialogOpen: (open: boolean) => void;
  toggleSoulPreviewMode: () => void;
}) {
  const {
    a,
    selected,
    busy,
    editName,
    setEditName,
    editDescription,
    setEditDescription,
    profileMarkdownLoading,
    profileDraft,
    updateIdentity,
    handleSoulTemplateChange,
    handleSoulContentChange,
    setAvatarDialogOpen,
    toggleSoulPreviewMode,
  } = props;

  const language = useLocaleStore((s) => s.language);
  const isDark = useThemeStore((s) => s.resolved === 'dark');
  const inputClass = agentsSettingsInputClass();
  const locLabel = useCallback(
    (en: string, zh: string) => (language === 'zh' ? zh : en),
    [language],
  );

  if (!selected) {
    return <p className="text-sm text-fg-muted">{a.selectAgentHint}</p>;
  }
  if (profileMarkdownLoading || !profileDraft) {
    return <SettingsPanelSkeleton rows={4} />;
  }

  const identity = profileDraft.identity;
  const soulTemplate = profileDraft.soulTemplate;
  const soulCustomContent = profileDraft.soulCustomContent;
  const soulEditorNonce = profileDraft.soulEditorNonce;
  const soulPreviewMode = profileDraft.soulPreviewMode;
  const avatarDialogOpen = profileDraft.avatarDialogOpen;

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
            <Select
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
                <SelectOption key={preset.value} value={preset.value}>
                  {locLabel(preset.labelEn, preset.labelZh)}
                </SelectOption>
              ))}
              <SelectOption value="__custom__">{locLabel('Custom…', '自定义…')}</SelectOption>
            </Select>
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

      <div className="flex items-start gap-3 rounded-xl border border-edge-subtle bg-surface-panel px-4 py-3">
        <Brain className="mt-0.5 size-4 shrink-0 text-accent-fg" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-fg">{a.sharedUserContextTitle}</p>
          <p className="mt-0.5 max-w-[68ch] text-xs leading-5 text-fg-muted">{a.sharedUserContextHint}</p>
        </div>
        <Link
          to="/you"
          className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-accent-fg hover:underline"
        >
          {a.sharedUserContextLink}
          <ExternalLink className="size-3" aria-hidden />
        </Link>
      </div>

      {/* Personality and operating style are stored in SOUL.md. */}
      <SettingsFormSection>
        <SettingsFormSectionHeader icon={User} title={a.personaSectionSoul} subtitle={a.personaSectionSoulHint} />
        <div className="mb-4 flex flex-col gap-2 sm:max-w-sm">
          <span className="text-sm font-medium text-fg">{a.personaSoulTemplate}</span>
          <Select
            className={inputClass}
            value={soulTemplate}
            onChange={(event) => handleSoulTemplateChange(event.target.value as SoulTemplateId)}
            disabled={busy}
          >
            {SOUL_TEMPLATES.map((template) => (
              <SelectOption key={template.id} value={template.id}>
                {template.emoji} {locLabel(template.labelEn, template.labelZh)}
              </SelectOption>
            ))}
          </Select>
          <p className="text-xs leading-5 text-fg-muted">{a.personaTemplateHint}</p>
        </div>
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm font-medium text-fg">{a.personaBehaviorEditorLabel}</span>
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
      </SettingsFormSection>
    </div>
  );
}
