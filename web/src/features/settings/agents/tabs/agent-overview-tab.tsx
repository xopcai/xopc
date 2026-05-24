import * as Dialog from '@radix-ui/react-dialog';
import { type MutableRefObject, useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, Cog, Eye, Pencil, Sparkles, Trash2, User, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { MarkdownEditor } from '@/components/markdown/markdown-editor';
import { MarkdownView } from '@/components/markdown/markdown-view';
import { ModelSelector } from '@/features/chat/model-selector';
import { DirectoryPickerField } from '@/features/fs/directory-picker-field';
import type { GatewayAgentRow } from '@/features/settings/agents-admin-api';
import {
  fetchAgentProfileFileContent,
  saveAgentProfileFileContent,
} from '@/features/settings/agents-admin-api';
import { SettingsFormSection, SettingsFormSectionHeader } from '@/features/settings/settings-form-section';
import type { AgentsSettingsMessages, ChatMessages } from '@/i18n/messages';
import { cn } from '@/lib/cn';
import {
  SETTINGS_SHELL_CONTENT_Z,
  SETTINGS_SHELL_MODAL_POPOVER_Z,
  SETTINGS_SHELL_OVERLAY_Z,
} from '@/lib/settings-shell-dialog-layer';
import { useLocaleStore } from '@/stores/locale-store';
import { useThemeStore } from '@/stores/theme-store';

import { AgentConfigInheritanceSummary } from '../agent-config-inheritance-summary';
import { AgentAvatarDisplay } from '../agent-avatar-display';
import { AgentAvatarPicker } from '../agent-avatar-picker';
import { agentsSettingsInputClass } from '../utils';
import {
  type IdentityFields,
  type SoulTemplateId,
  parseIdentityMarkdown,
  serializeIdentityMarkdown,
  detectSoulTemplate,
  SOUL_TEMPLATES,
  CREATURE_PRESETS,
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
  hideInlineSave?: boolean;
  /** Parent writes a save callback for IDENTITY/SOUL Markdown into this ref (modal footer). */
  saveProfileMarkdownRef?: MutableRefObject<(() => Promise<void>) | null>;
  /** Called when IDENTITY/SOUL editor dirty state changes. */
  onProfileMarkdownDirtyChange?: (dirty: boolean) => void;
  defaultModel?: string;
  defaultWorkspace?: string;
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
    hideInlineSave,
    saveProfileMarkdownRef,
    onProfileMarkdownDirtyChange,
    defaultModel = '',
    defaultWorkspace = '',
  } = props;

  const language = useLocaleStore((s) => s.language);
  const isDark = useThemeStore((s) => s.resolved === 'dark');

  // ---- Profile Markdown (IDENTITY / SOUL) ----
  const [profileMarkdownLoading, setProfileMarkdownLoading] = useState(true);
  const [, setProfileMarkdownSaving] = useState(false);

  const [identity, setIdentity] = useState<IdentityFields>({
    name: '',
    creature: '',
    emoji: '',
    avatar: '',
  });
  const [soulTemplate, setSoulTemplate] = useState<SoulTemplateId>('professional');
  const [soulCustomContent, setSoulCustomContent] = useState('');
  const [soulEditorNonce, setSoulEditorNonce] = useState(0);
  const [soulPreviewMode, setSoulPreviewMode] = useState(false);
  const [avatarDialogOpen, setAvatarDialogOpen] = useState(false);

  const initialLoadDoneRef = useRef(false);
  const agentIdRef = useRef(selected?.id ?? '');
  agentIdRef.current = selected?.id ?? '';

  // Snapshots for dirty tracking (set after load, reset after save)
  const identitySnapshotRef = useRef('');
  const soulSnapshotRef = useRef('');

  // ---- Load IDENTITY.md + SOUL.md ----
  useEffect(() => {
    if (!selected) return;
    let cancelled = false;
    initialLoadDoneRef.current = false;
    setProfileMarkdownLoading(true);

    const load = async () => {
      try {
        const [identityMd, soulMd] = await Promise.all([
          fetchAgentProfileFileContent(selected.id, 'IDENTITY.md').catch(() => ''),
          fetchAgentProfileFileContent(selected.id, 'SOUL.md').catch(() => ''),
        ]);
        if (cancelled) return;
        const parsedIdentity = parseIdentityMarkdown(identityMd);
        setIdentity(parsedIdentity);
        identitySnapshotRef.current = JSON.stringify(parsedIdentity);
        setSoulTemplate(detectSoulTemplate(soulMd));
        setSoulCustomContent(soulMd);
        soulSnapshotRef.current = soulMd;
        setSoulEditorNonce((n) => n + 1);
      } finally {
        if (!cancelled) {
          setProfileMarkdownLoading(false);
          initialLoadDoneRef.current = true;
        }
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [selected?.id]);

  // ---- Save helpers (manual save only, triggered by footer button) ----
  const saveProfileMarkdownFile = useCallback(async (fileName: string, content: string) => {
    setProfileMarkdownSaving(true);
    try {
      await saveAgentProfileFileContent(agentIdRef.current, fileName, content);
    } finally {
      setProfileMarkdownSaving(false);
    }
  }, []);

  // Refs to hold latest state for the save callback
  const identityRef = useRef(identity);
  identityRef.current = identity;
  const soulContentRef = useRef(soulCustomContent);
  soulContentRef.current = soulCustomContent;

  // Expose save function to parent for the footer save button
  useEffect(() => {
    if (!saveProfileMarkdownRef) return;
    saveProfileMarkdownRef.current = async () => {
      await Promise.all([
        saveProfileMarkdownFile('IDENTITY.md', serializeIdentityMarkdown(identityRef.current)),
        saveProfileMarkdownFile('SOUL.md', soulContentRef.current),
      ]);
      // Reset snapshots after successful save
      identitySnapshotRef.current = JSON.stringify(identityRef.current);
      soulSnapshotRef.current = soulContentRef.current;
      // Manually notify parent since state didn't change (only snapshot did)
      onProfileMarkdownDirtyChange?.(false);
    };
    return () => {
      saveProfileMarkdownRef.current = null;
    };
  }, [saveProfileMarkdownRef, saveProfileMarkdownFile, onProfileMarkdownDirtyChange]);

  // Notify parent when profile markdown dirty state changes
  useEffect(() => {
    if (!onProfileMarkdownDirtyChange) return;
    const identityDirty = JSON.stringify(identity) !== identitySnapshotRef.current;
    const soulDirty = soulCustomContent !== soulSnapshotRef.current;
    onProfileMarkdownDirtyChange(identityDirty || soulDirty);
  }, [identity, soulCustomContent, onProfileMarkdownDirtyChange]);

  const updateIdentity = useCallback((patch: Partial<IdentityFields>) => {
    setIdentity((prev) => ({ ...prev, ...patch }));
  }, []);

  const handleSoulTemplateChange = useCallback((templateId: SoulTemplateId) => {
    setSoulTemplate(templateId);
    if (templateId !== 'custom') {
      const tpl = SOUL_TEMPLATES.find((t) => t.id === templateId);
      if (tpl?.content) {
        setSoulCustomContent(tpl.content);
        setSoulEditorNonce((n) => n + 1);
      }
    }
  }, []);

  const handleSoulContentChange = useCallback((content: string) => {
    setSoulCustomContent(content);
    setSoulTemplate('custom');
  }, []);

  const locLabel = useCallback(
    (en: string, zh: string) => (language === 'zh' ? zh : en),
    [language],
  );

  const inputClass = agentsSettingsInputClass();

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
      />

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
                    className="shrink-0 rounded-lg p-1.5 text-fg-muted hover:bg-surface-base hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
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
          {/* Name — single unified field */}
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

          {/* Emoji */}
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

          {/* Description */}
          <label className="flex flex-col gap-1.5 text-sm sm:col-span-2">
            <span className="font-medium text-fg">{a.agentDescription}</span>
            <textarea
              className={cn(inputClass, 'min-h-16 resize-y text-sm leading-relaxed')}
              value={editDescription}
              onChange={(e) => setEditDescription(e.target.value)}
              placeholder={a.agentDescriptionPlaceholder}
              maxLength={4000}
              rows={3}
              spellCheck
            />
          </label>

          {/* Creature type — dropdown */}
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
                popoverContentClassName={SETTINGS_SHELL_MODAL_POPOVER_Z}
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
            <DirectoryPickerField
              value={editWorkspace}
              onChange={setEditWorkspace}
              disabled={busy}
              wd={chat.workingDirectory}
              placeholder={chat.workingDirectory.notSet}
              maxWidthClass="max-w-full sm:max-w-[min(20rem,100%)]"
            />
            <input
              className={cn(inputClass, 'font-mono text-xs')}
              value={editWorkspace}
              onChange={(e) => setEditWorkspace(e.target.value)}
              placeholder={chat.workingDirectory.pathInputPlaceholder}
              spellCheck={false}
              autoComplete="off"
            />
          </div>
        </div>
        {!hideInlineSave ? (
          <div className="mt-4">
            <Button type="button" disabled={busy} onClick={() => void onSaveAgentEdits()}>
              {a.save}
            </Button>
          </div>
        ) : null}
      </SettingsFormSection>

      {/* ===== Section 3: Personality & Style ===== */}
      {profileMarkdownLoading ? (
        <p className="text-sm text-fg-muted">{a.loading}</p>
      ) : (
        <SettingsFormSection>
          <SettingsFormSectionHeader icon={User} title={a.personaSectionSoul} subtitle={a.personaSectionSoulHint} />
          {/* Soul template */}
          <div className="mb-4 flex flex-col gap-2">
            <span className="text-sm font-medium text-fg">{a.personaSoulTemplate}</span>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {SOUL_TEMPLATES.map((template) => (
                <button
                  key={template.id}
                  type="button"
                  className={cn(
                    'flex flex-col items-center gap-1.5 rounded-xl border-2 p-3 text-center transition-all',
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
                  className="inline-flex size-9 shrink-0 items-center justify-center rounded-md text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg"
                  title={soulPreviewMode ? a.personaSoulEdit : a.personaSoulPreview}
                  aria-label={soulPreviewMode ? a.personaSoulEdit : a.personaSoulPreview}
                  onClick={() => setSoulPreviewMode((v) => !v)}
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
