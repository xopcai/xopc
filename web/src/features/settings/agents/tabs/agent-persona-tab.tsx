import { Eye, Pencil, Sparkles, User } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useDebouncedCallback } from 'use-debounce';

import { MarkdownEditor } from '@/components/markdown/markdown-editor';
import { MarkdownView } from '@/components/markdown/markdown-view';
import {
  SettingsFormSection,
  SettingsFormSectionHeader,
} from '@/features/settings/settings-form-section';
import {
  fetchAgentBootstrapFileContent,
  saveAgentBootstrapFileContent,
} from '@/features/settings/agents-admin-api';
import { cn } from '@/lib/cn';
import type { AgentsSettingsMessages } from '@/i18n/messages';
import { useLocaleStore } from '@/stores/locale-store';
import { useThemeStore } from '@/stores/theme-store';

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
} from '../bootstrap-parser';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface PersonaTabProps {
  a: AgentsSettingsMessages;
  agentId: string;
}

// ---------------------------------------------------------------------------
// Component — Identity (IDENTITY.md) + Personality (SOUL.md)
// ---------------------------------------------------------------------------

export function AgentPersonaTab({ a, agentId }: PersonaTabProps) {
  const language = useLocaleStore((s) => s.language);
  const isDark = useThemeStore((s) => s.resolved === 'dark');

  // ---- Loading state ----
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // ---- Identity fields (→ IDENTITY.md) ----
  const [identity, setIdentity] = useState<IdentityFields>({
    name: '',
    creature: '',
    emoji: '',
    avatar: '',
  });

  // ---- Soul fields (→ SOUL.md) ----
  const [soulTemplate, setSoulTemplate] = useState<SoulTemplateId>('professional');
  const [soulCustomContent, setSoulCustomContent] = useState('');
  const [soulEditorNonce, setSoulEditorNonce] = useState(0);
  const [soulPreviewMode, setSoulPreviewMode] = useState(false);

  // ---- Track whether initial load is complete ----
  const initialLoadDoneRef = useRef(false);
  const agentIdRef = useRef(agentId);
  agentIdRef.current = agentId;

  // ---- Load bootstrap files on mount / agentId change ----
  useEffect(() => {
    let cancelled = false;
    initialLoadDoneRef.current = false;
    setLoading(true);

    const loadAll = async () => {
      try {
        const [identityMd, soulMd] = await Promise.all([
          fetchAgentBootstrapFileContent(agentId, 'IDENTITY.md').catch(() => ''),
          fetchAgentBootstrapFileContent(agentId, 'SOUL.md').catch(() => ''),
        ]);
        if (cancelled) return;

        const parsedIdentity = parseIdentityMarkdown(identityMd);
        const detectedTemplate = detectSoulTemplate(soulMd);

        setIdentity(parsedIdentity);
        setSoulTemplate(detectedTemplate);
        setSoulCustomContent(soulMd);
        setSoulEditorNonce((n) => n + 1);
      } finally {
        if (!cancelled) {
          setLoading(false);
          initialLoadDoneRef.current = true;
        }
      }
    };

    void loadAll();
    return () => {
      cancelled = true;
    };
  }, [agentId]);

  // ---- Debounced save helpers ----
  const saveFile = useCallback(async (fileName: string, content: string) => {
    const currentAgent = agentIdRef.current;
    setSaving(true);
    try {
      await saveAgentBootstrapFileContent(currentAgent, fileName, content);
    } finally {
      setSaving(false);
    }
  }, []);

  const saveIdentityDebounced = useDebouncedCallback(
    (fields: IdentityFields) => void saveFile('IDENTITY.md', serializeIdentityMarkdown(fields)),
    800,
  );

  const saveSoulDebounced = useDebouncedCallback((content: string) => void saveFile('SOUL.md', content), 800);

  // Flush pending saves on unmount
  useEffect(() => {
    return () => {
      saveIdentityDebounced.flush();
      saveSoulDebounced.flush();
    };
  }, [saveIdentityDebounced, saveSoulDebounced]);

  // ---- Identity field updaters ----
  const updateIdentity = useCallback(
    (patch: Partial<IdentityFields>) => {
      setIdentity((prev) => {
        const next = { ...prev, ...patch };
        if (initialLoadDoneRef.current) {
          saveIdentityDebounced(next);
        }
        return next;
      });
    },
    [saveIdentityDebounced],
  );

  // ---- Soul template change ----
  const handleSoulTemplateChange = useCallback(
    (templateId: SoulTemplateId) => {
      setSoulTemplate(templateId);
      if (templateId !== 'custom') {
        const template = SOUL_TEMPLATES.find((t) => t.id === templateId);
        if (template?.content) {
          setSoulCustomContent(template.content);
          setSoulEditorNonce((n) => n + 1);
          if (initialLoadDoneRef.current) {
            saveSoulDebounced(template.content);
          }
        }
      }
    },
    [saveSoulDebounced],
  );

  const handleSoulContentChange = useCallback(
    (content: string) => {
      setSoulCustomContent(content);
      setSoulTemplate('custom');
      if (initialLoadDoneRef.current) {
        saveSoulDebounced(content);
      }
    },
    [saveSoulDebounced],
  );

  // ---- Helpers for localized labels ----
  const locLabel = useCallback(
    (en: string, zh: string) => (language === 'zh' ? zh : en),
    [language],
  );

  if (loading) {
    return <p className="text-sm text-fg-muted">{a.loading}</p>;
  }

  const inputClass = agentsSettingsInputClass();

  return (
    <div className="flex flex-col gap-6">
      <p className="text-sm text-fg-muted">{a.personaHint}</p>

      {/* ===== Section 1: Agent Identity ===== */}
      <SettingsFormSection>
        <SettingsFormSectionHeader
          icon={Sparkles}
          title={a.personaSectionIdentity}
          subtitle={a.personaSectionIdentityHint}
          iconLeading={
            <AgentAvatarDisplay agentId={agentId} avatar={identity.avatar} size={36} className="size-9 rounded-lg" />
          }
        />
        <div className="grid gap-4 sm:grid-cols-2">
          {/* Name */}
          <label className="flex flex-col gap-1.5 text-sm">
            <span className="font-medium text-fg">{a.personaName}</span>
            <input
              className={inputClass}
              value={identity.name}
              onChange={(e) => updateIdentity({ name: e.target.value })}
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

          {/* Creature type */}
          <label className="flex flex-col gap-1.5 text-sm">
            <span className="font-medium text-fg">{a.personaCreature}</span>
            <div className="flex flex-col gap-2">
              <div className="flex flex-wrap gap-1.5">
                {CREATURE_PRESETS.map((preset) => (
                  <button
                    key={preset.value}
                    type="button"
                    className={cn(
                      'rounded-full border px-2.5 py-1 text-xs font-medium transition-colors',
                      identity.creature === preset.value
                        ? 'border-accent bg-accent-soft text-accent-fg'
                        : 'border-edge text-fg-muted hover:border-accent/50 hover:text-fg',
                    )}
                    onClick={() => updateIdentity({ creature: preset.value })}
                  >
                    {locLabel(preset.labelEn, preset.labelZh)}
                  </button>
                ))}
              </div>
              <input
                className={cn(inputClass, 'text-xs')}
                value={CREATURE_PRESETS.some((p) => p.value === identity.creature) ? '' : identity.creature}
                onChange={(e) => updateIdentity({ creature: e.target.value })}
                placeholder={a.personaCreaturePlaceholder}
                autoComplete="off"
              />
            </div>
          </label>

          <AgentAvatarPicker
            agentId={agentId}
            value={identity.avatar}
            onChange={(next) => updateIdentity({ avatar: next })}
            a={a}
          />
        </div>
      </SettingsFormSection>

      {/* ===== Section 2: Personality & Style ===== */}
      <SettingsFormSection>
        <SettingsFormSectionHeader icon={User} title={a.personaSectionSoul} subtitle={a.personaSectionSoulHint} />

        {/* Template picker */}
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

        {/* Custom soul editor */}
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
            <div className={cn(agentsSettingsInputClass(), 'flex min-h-64 flex-col overflow-hidden p-0')}>
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

      {/* Save status indicator */}
      {saving ? <p className="shrink-0 text-center text-xs text-fg-muted">{a.personaSaving}</p> : null}
    </div>
  );
}
