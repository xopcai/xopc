import { type MutableRefObject, useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, Cog, Sparkles, Trash2, User } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { MarkdownEditor } from '@/components/markdown/markdown-editor';
import { ModelSelector } from '@/features/chat/model-selector';
import type { GatewayAgentRow } from '@/features/settings/agents-admin-api';
import {
  fetchAgentBootstrapFileContent,
  saveAgentBootstrapFileContent,
} from '@/features/settings/agents-admin-api';
import { SettingsFormSection, SettingsFormSectionHeader } from '@/features/settings/settings-form-section';
import { cn } from '@/lib/cn';
import type { AgentsSettingsMessages, ChatMessages } from '@/i18n/messages';
import { useLocaleStore } from '@/stores/locale-store';
import { useThemeStore } from '@/stores/theme-store';

import { agentsSettingsInputClass } from '../utils';
import {
  type IdentityFields,
  type SoulTemplateId,
  parseIdentityMarkdown,
  serializeIdentityMarkdown,
  detectSoulTemplate,
  SOUL_TEMPLATES,
  CREATURE_PRESETS,
} from '../bootstrap-parser';

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
  /** Parent writes a save-bootstrap callback into this ref so the modal footer can trigger it. */
  saveBootstrapRef?: MutableRefObject<(() => Promise<void>) | null>;
  /** Called when bootstrap-file dirty state changes. */
  onBootstrapDirtyChange?: (dirty: boolean) => void;
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
    saveBootstrapRef,
    onBootstrapDirtyChange,
  } = props;

  const language = useLocaleStore((s) => s.language);
  const isDark = useThemeStore((s) => s.resolved === 'dark');

  // ---- Bootstrap file state ----
  const [bootstrapLoading, setBootstrapLoading] = useState(true);
  const [, setBootstrapSaving] = useState(false);

  const [identity, setIdentity] = useState<IdentityFields>({
    name: '',
    creature: '',
    emoji: '',
    avatar: '',
  });
  const [soulTemplate, setSoulTemplate] = useState<SoulTemplateId>('professional');
  const [soulCustomContent, setSoulCustomContent] = useState('');
  const [soulEditorNonce, setSoulEditorNonce] = useState(0);

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
    setBootstrapLoading(true);

    const load = async () => {
      try {
        const [identityMd, soulMd] = await Promise.all([
          fetchAgentBootstrapFileContent(selected.id, 'IDENTITY.md').catch(() => ''),
          fetchAgentBootstrapFileContent(selected.id, 'SOUL.md').catch(() => ''),
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
          setBootstrapLoading(false);
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
  const saveBootstrapFile = useCallback(async (fileName: string, content: string) => {
    setBootstrapSaving(true);
    try {
      await saveAgentBootstrapFileContent(agentIdRef.current, fileName, content);
    } finally {
      setBootstrapSaving(false);
    }
  }, []);

  // Refs to hold latest state for the save callback
  const identityRef = useRef(identity);
  identityRef.current = identity;
  const soulContentRef = useRef(soulCustomContent);
  soulContentRef.current = soulCustomContent;

  // Expose save function to parent for the footer save button
  useEffect(() => {
    if (!saveBootstrapRef) return;
    saveBootstrapRef.current = async () => {
      await Promise.all([
        saveBootstrapFile('IDENTITY.md', serializeIdentityMarkdown(identityRef.current)),
        saveBootstrapFile('SOUL.md', soulContentRef.current),
      ]);
      // Reset snapshots after successful save
      identitySnapshotRef.current = JSON.stringify(identityRef.current);
      soulSnapshotRef.current = soulContentRef.current;
      // Manually notify parent since state didn't change (only snapshot did)
      onBootstrapDirtyChange?.(false);
    };
    return () => {
      saveBootstrapRef.current = null;
    };
  }, [saveBootstrapRef, saveBootstrapFile, onBootstrapDirtyChange]);

  // Notify parent when bootstrap dirty state changes
  useEffect(() => {
    if (!onBootstrapDirtyChange) return;
    const identityDirty = JSON.stringify(identity) !== identitySnapshotRef.current;
    const soulDirty = soulCustomContent !== soulSnapshotRef.current;
    onBootstrapDirtyChange(identityDirty || soulDirty);
  }, [identity, soulCustomContent, onBootstrapDirtyChange]);

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
      {/* ===== Section 1: Basic Identity ===== */}
      <SettingsFormSection>
        <SettingsFormSectionHeader
          icon={Sparkles}
          title={a.personaSectionIdentity}
          subtitle={a.personaSectionIdentityHint}
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

          {/* Avatar */}
          <label className="flex flex-col gap-1.5 text-sm sm:col-span-2">
            <span className="font-medium text-fg">{a.personaAvatar}</span>
            <input
              className={cn(inputClass, 'font-mono text-xs')}
              value={identity.avatar}
              onChange={(e) => updateIdentity({ avatar: e.target.value })}
              placeholder={a.personaAvatarPlaceholder}
              autoComplete="off"
            />
          </label>
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
                popoverContentClassName="z-[70]"
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
          <label className="flex flex-col gap-1.5 text-sm sm:col-span-2">
            <span className="font-medium text-fg">{a.workspacePath}</span>
            <input
              className={cn(inputClass, 'font-mono text-xs')}
              value={editWorkspace}
              onChange={(e) => setEditWorkspace(e.target.value)}
            />
          </label>
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
      {bootstrapLoading ? (
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
                    'flex flex-col items-center gap-1.5 rounded-xl border-2 px-3 py-3 text-center transition-all',
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
              <span className="text-sm font-medium text-fg">{a.personaSoulCustomEdit}</span>
              <div className={cn(inputClass, 'flex min-h-64 flex-col overflow-hidden p-0')}>
                <MarkdownEditor
                  key={`soul-${soulEditorNonce}`}
                  initialContent={soulCustomContent}
                  onChange={handleSoulContentChange}
                  isDark={isDark}
                  className="min-h-0 flex-1"
                />
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
