import { Info, UserCircle } from 'lucide-react';
import { type MutableRefObject, useCallback, useEffect, useRef, useState } from 'react';

import {
  SettingsFormSection,
  SettingsFormSectionHeader,
} from '@/features/settings/settings-form-section';
import {
  fetchAgentProfileFileContent,
  saveAgentProfileFileContent,
} from '@/features/settings/agents-admin-api';
import { cn } from '@/lib/cn';
import type { AgentsSettingsMessages } from '@/i18n/messages';
import { useLocaleStore } from '@/stores/locale-store';

import { agentsSettingsInputClass } from '../utils';
import {
  type UserFields,
  parseUserMarkdown,
  serializeUserMarkdown,
  TIMEZONE_OPTIONS,
  PRONOUNS_PRESETS,
  detectBrowserTimezone,
} from '../agent-profile-markdown';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ProfileTabProps {
  a: AgentsSettingsMessages;
  agentId: string;
  /** Parent writes a save callback into this ref so the modal footer can trigger it. */
  saveRef?: MutableRefObject<(() => Promise<void>) | null>;
  /** Called when dirty state changes. */
  onDirtyChange?: (dirty: boolean) => void;
}

// ---------------------------------------------------------------------------
// Component — About You (USER.md)
// ---------------------------------------------------------------------------

export function AgentProfileTab({ a, agentId, saveRef, onDirtyChange }: ProfileTabProps) {
  const language = useLocaleStore((s) => s.language);

  const [loading, setLoading] = useState(true);
  const [, setSaving] = useState(false);

  const [user, setUser] = useState<UserFields>({
    callName: '',
    pronouns: '',
    timezone: '',
    notes: '',
  });

  const [showCustomPronouns, setShowCustomPronouns] = useState(false);
  const [showCustomTimezone, setShowCustomTimezone] = useState(false);
  const [customTimezone, setCustomTimezone] = useState('');

  const initialLoadDoneRef = useRef(false);
  const agentIdRef = useRef(agentId);
  agentIdRef.current = agentId;

  // Snapshot for dirty tracking (set after load, reset after save)
  const userSnapshotRef = useRef('');

  // ---- Save helper (manual save only, triggered by footer button) ----
  const saveFile = useCallback(async (content: string) => {
    const currentAgent = agentIdRef.current;
    setSaving(true);
    try {
      await saveAgentProfileFileContent(currentAgent, 'USER.md', content);
    } finally {
      setSaving(false);
    }
  }, []);

  // Ref to hold latest user state for the save callback
  const userRef = useRef(user);
  userRef.current = user;

  // Expose save function to parent for the footer save button
  useEffect(() => {
    if (!saveRef) return;
    saveRef.current = async () => {
      await saveFile(serializeUserMarkdown(userRef.current));
      userSnapshotRef.current = JSON.stringify(userRef.current);
      // Manually notify parent since state didn't change (only snapshot did)
      onDirtyChange?.(false);
    };
    return () => {
      saveRef.current = null;
    };
  }, [saveRef, saveFile, onDirtyChange]);

  // Notify parent when dirty state changes
  useEffect(() => {
    if (!onDirtyChange) return;
    onDirtyChange(JSON.stringify(user) !== userSnapshotRef.current);
  }, [user, onDirtyChange]);

  // ---- Load USER.md on mount / agentId change ----
  useEffect(() => {
    let cancelled = false;
    initialLoadDoneRef.current = false;
    setLoading(true);

    const load = async () => {
      try {
        const userMd = await fetchAgentProfileFileContent(agentId, 'USER.md').catch(() => '');
        if (cancelled) return;

        const parsedUser = parseUserMarkdown(userMd);

        // Auto-detect timezone if not already set (saved when user clicks "Save")
        let effectiveUser = parsedUser;
        if (!parsedUser.timezone) {
          const detected = detectBrowserTimezone();
          if (detected) {
            effectiveUser = { ...parsedUser, timezone: detected };
          }
        }

        setUser(effectiveUser);
        userSnapshotRef.current = JSON.stringify(effectiveUser);

        // Custom pronouns handling
        const isKnownPronouns = !effectiveUser.pronouns || PRONOUNS_PRESETS.some((p) => p.value === effectiveUser.pronouns);
        if (effectiveUser.pronouns && !isKnownPronouns) {
          setShowCustomPronouns(true);
        }

        // Custom timezone handling
        const isKnownTimezone = TIMEZONE_OPTIONS.some((tz) => tz.value === effectiveUser.timezone);
        if (effectiveUser.timezone && !isKnownTimezone) {
          setShowCustomTimezone(true);
          setCustomTimezone(effectiveUser.timezone);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
          initialLoadDoneRef.current = true;
        }
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [agentId]);

  // ---- Field updater (local state only, saved via footer button) ----
  const updateUser = useCallback((patch: Partial<UserFields>) => {
    setUser((prev) => ({ ...prev, ...patch }));
  }, []);

  // ---- Timezone handling ----
  const handleTimezoneChange = useCallback(
    (value: string) => {
      if (value === '__custom__') {
        setShowCustomTimezone(true);
        return;
      }
      setShowCustomTimezone(false);
      setCustomTimezone('');
      updateUser({ timezone: value });
    },
    [updateUser],
  );

  const handleCustomTimezoneChange = useCallback(
    (value: string) => {
      setCustomTimezone(value);
      updateUser({ timezone: value });
    },
    [updateUser],
  );

  const handleDetectTimezone = useCallback(() => {
    const detected = detectBrowserTimezone();
    if (detected) {
      const isKnown = TIMEZONE_OPTIONS.some((tz) => tz.value === detected);
      if (isKnown) {
        setShowCustomTimezone(false);
        setCustomTimezone('');
      } else {
        setShowCustomTimezone(true);
        setCustomTimezone(detected);
      }
      updateUser({ timezone: detected });
    }
  }, [updateUser]);

  // ---- Effective timezone for select ----
  const timezoneSelectValue = (() => {
    if (showCustomTimezone) return '__custom__';
    const isKnown = TIMEZONE_OPTIONS.some((tz) => tz.value === user.timezone);
    return isKnown ? user.timezone : '__custom__';
  })();

  const locLabel = useCallback(
    (en: string, zh: string) => (language === 'zh' ? zh : en),
    [language],
  );

  if (loading) {
    return <p className="text-sm text-fg-muted">{a.loading}</p>;
  }

  const inputClass = agentsSettingsInputClass();

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto">
      <p className="text-sm text-fg-muted">{a.personaSectionUserHint}</p>

      <SettingsFormSection>
        <SettingsFormSectionHeader
          icon={UserCircle}
          title={a.personaSectionUser}
          subtitle={a.personaSectionUserHint}
        />
        <div className="grid gap-4 sm:grid-cols-2">
          {/* Call name */}
          <label className="flex flex-col gap-1.5 text-sm">
            <span className="font-medium text-fg">{a.personaCallName}</span>
            <input
              className={inputClass}
              value={user.callName}
              onChange={(e) => updateUser({ callName: e.target.value })}
              placeholder={a.personaCallNamePlaceholder}
              autoComplete="off"
            />
          </label>

          {/* Pronouns */}
          <div className="flex flex-col gap-1.5 text-sm">
            <span className="font-medium text-fg">{a.personaPronouns}</span>
            <select
              className={inputClass}
              value={PRONOUNS_PRESETS.some((p) => p.value === user.pronouns) ? user.pronouns : '__custom__'}
              onChange={(e) => {
                if (e.target.value === '__custom__') {
                  setShowCustomPronouns(true);
                  return;
                }
                setShowCustomPronouns(false);
                updateUser({ pronouns: e.target.value });
              }}
            >
              <option value="" disabled>
                {a.personaPronounsPlaceholder}
              </option>
              {PRONOUNS_PRESETS.map((preset) => (
                <option key={preset.value} value={preset.value}>
                  {locLabel(preset.labelEn, preset.labelZh)}
                </option>
              ))}
              <option value="__custom__">{locLabel('Custom…', '自定义…')}</option>
            </select>
            {showCustomPronouns ? (
              <input
                className={cn(inputClass, 'mt-1 text-xs')}
                value={PRONOUNS_PRESETS.some((p) => p.value === user.pronouns) ? '' : user.pronouns}
                onChange={(e) => updateUser({ pronouns: e.target.value })}
                placeholder={a.personaPronounsPlaceholder}
                autoComplete="off"
              />
            ) : null}
          </div>

          {/* Timezone */}
          <div className="flex flex-col gap-1.5 text-sm sm:col-span-2">
            <span className="font-medium text-fg">{a.personaTimezone}</span>
            <div className="flex flex-wrap items-stretch gap-2">
              <select
                className={cn(inputClass, 'min-w-0 flex-1')}
                value={timezoneSelectValue}
                onChange={(e) => handleTimezoneChange(e.target.value)}
              >
                {TIMEZONE_OPTIONS.map((tz) => (
                  <option key={tz.value} value={tz.value}>
                    {locLabel(tz.labelEn, tz.labelZh)}
                  </option>
                ))}
                <option value="__custom__">{a.personaTimezoneCustom}</option>
              </select>
              <button
                type="button"
                className="shrink-0 rounded-lg border border-edge bg-surface-panel px-3 py-2 text-xs font-medium text-fg-muted hover:bg-surface-hover hover:text-fg"
                onClick={handleDetectTimezone}
              >
                {a.personaTimezoneDetect}
              </button>
            </div>
            {showCustomTimezone ? (
              <input
                className={cn(inputClass, 'mt-1 font-mono text-xs')}
                value={customTimezone}
                onChange={(e) => handleCustomTimezoneChange(e.target.value)}
                placeholder="e.g. Asia/Shanghai"
                autoComplete="off"
              />
            ) : null}
          </div>

          {/* Notes */}
          <label className="flex flex-col gap-1.5 text-sm sm:col-span-2">
            <span className="font-medium text-fg">{a.personaNotes}</span>
            <textarea
              className={cn(inputClass, 'min-h-16 resize-y text-sm leading-relaxed')}
              value={user.notes}
              onChange={(e) => updateUser({ notes: e.target.value })}
              placeholder={a.personaNotesPlaceholder}
              rows={3}
              spellCheck
            />
          </label>
        </div>

        {/* Memory note */}
        <div className="mt-3 flex items-start gap-2 rounded-lg bg-accent-soft/30 px-3 py-2.5 text-xs text-fg-muted">
          <Info className="mt-0.5 size-3.5 shrink-0 text-accent" aria-hidden />
          <span>{a.personaMemoryNote}</span>
        </div>
      </SettingsFormSection>
    </div>
  );
}
