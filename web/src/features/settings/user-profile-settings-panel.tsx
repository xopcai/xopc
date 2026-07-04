import { Info, Save, UserCircle } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';

import {
  fetchUserProfileContent,
  saveUserProfileContent,
} from '@/features/settings/agents-admin-api';
import { Button } from '@/components/ui/button';
import {
  SettingsFormSection,
  SettingsFormSectionHeader,
} from '@/features/settings/settings-form-section';
import { SettingsPageFrame, SettingsPageHeader } from '@/features/settings/settings-page-layout';
import {
  detectBrowserTimezone,
  parseUserMarkdown,
  PRONOUNS_PRESETS,
  serializeUserMarkdown,
  TIMEZONE_OPTIONS,
  type UserFields,
} from '@/features/settings/agents/agent-profile-markdown';
import { agentsSettingsInputClass } from '@/features/settings/agents/utils';
import { cn } from '@/lib/cn';
import { interaction } from '@/lib/interaction';
import { messages } from '@/i18n/messages';
import { useLocaleStore } from '@/stores/locale-store';

const emptyUser: UserFields = {
  callName: '',
  pronouns: '',
  timezone: '',
  notes: '',
};

function userWithDetectedTimezone(user: UserFields): UserFields {
  if (user.timezone) return user;
  const detected = detectBrowserTimezone();
  return detected ? { ...user, timezone: detected } : user;
}

export function UserProfileSettingsPanel() {
  const language = useLocaleStore((s) => s.language);
  const m = messages(language);
  const t = m.userProfileSettings;
  const inputClass = agentsSettingsInputClass();

  const [user, setUser] = useState<UserFields>(emptyUser);
  const [snapshot, setSnapshot] = useState(JSON.stringify(emptyUser));
  const [customTimezone, setCustomTimezone] = useState('');
  const [showCustomTimezone, setShowCustomTimezone] = useState(false);
  const [showCustomPronouns, setShowCustomPronouns] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchUserProfileContent()
      .then((content) => {
        if (cancelled) return;
        const parsed = userWithDetectedTimezone(parseUserMarkdown(content));
        const isKnownTimezone = TIMEZONE_OPTIONS.some((tz) => tz.value === parsed.timezone);
        const isKnownPronouns = !parsed.pronouns || PRONOUNS_PRESETS.some((p) => p.value === parsed.pronouns);
        setUser(parsed);
        setSnapshot(JSON.stringify(parsed));
        setShowCustomTimezone(Boolean(parsed.timezone && !isKnownTimezone));
        setCustomTimezone(parsed.timezone && !isKnownTimezone ? parsed.timezone : '');
        setShowCustomPronouns(Boolean(parsed.pronouns && !isKnownPronouns));
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : t.loadError);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [t.loadError]);

  const dirty = JSON.stringify(user) !== snapshot;

  const locLabel = useCallback(
    (en: string, zh: string) => (language === 'zh' ? zh : en),
    [language],
  );

  const updateUser = useCallback((patch: Partial<UserFields>) => {
    setUser((prev) => ({ ...prev, ...patch }));
    setSaved(false);
  }, []);

  const timezoneSelectValue = useMemo(() => {
    if (showCustomTimezone) return '__custom__';
    const isKnown = TIMEZONE_OPTIONS.some((tz) => tz.value === user.timezone);
    return isKnown ? user.timezone : '__custom__';
  }, [showCustomTimezone, user.timezone]);

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

  const handleDetectTimezone = useCallback(() => {
    const detected = detectBrowserTimezone();
    if (!detected) return;
    const isKnown = TIMEZONE_OPTIONS.some((tz) => tz.value === detected);
    setShowCustomTimezone(!isKnown);
    setCustomTimezone(isKnown ? '' : detected);
    updateUser({ timezone: detected });
  }, [updateUser]);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      await saveUserProfileContent(serializeUserMarkdown(user));
      setSnapshot(JSON.stringify(user));
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : t.saveError);
    } finally {
      setSaving(false);
    }
  }

  return (
    <SettingsPageFrame gap="gap-6">
      <SettingsPageHeader
        title={t.title}
        subtitle={t.subtitle}
        actions={
          <Button
            type="button"
            variant="primary"
            disabled={loading || saving || !dirty}
            onClick={() => void save()}
          >
            <Save className="size-4" aria-hidden />
            {saving ? t.saving : saved ? t.saved : t.save}
          </Button>
        }
      />

      <SettingsFormSection>
        <SettingsFormSectionHeader
          icon={UserCircle}
          title={t.sectionTitle}
          subtitle={t.sectionSubtitle}
        />

        {loading ? (
          <p className="text-sm text-fg-muted">{t.loading}</p>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="flex flex-col gap-1.5 text-sm">
              <span className="font-medium text-fg">{t.callName}</span>
              <input
                className={inputClass}
                value={user.callName}
                onChange={(e) => updateUser({ callName: e.target.value })}
                placeholder={t.callNamePlaceholder}
                autoComplete="off"
              />
            </label>

            <div className="flex flex-col gap-1.5 text-sm">
              <span className="font-medium text-fg">{t.pronouns}</span>
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
                  {t.pronounsPlaceholder}
                </option>
                {PRONOUNS_PRESETS.map((preset) => (
                  <option key={preset.value} value={preset.value}>
                    {locLabel(preset.labelEn, preset.labelZh)}
                  </option>
                ))}
                <option value="__custom__">{t.custom}</option>
              </select>
              {showCustomPronouns ? (
                <input
                  className={cn(inputClass, 'mt-1 text-xs')}
                  value={PRONOUNS_PRESETS.some((p) => p.value === user.pronouns) ? '' : user.pronouns}
                  onChange={(e) => updateUser({ pronouns: e.target.value })}
                  placeholder={t.pronounsPlaceholder}
                  autoComplete="off"
                />
              ) : null}
            </div>

            <div className="flex flex-col gap-1.5 text-sm sm:col-span-2">
              <span className="font-medium text-fg">{t.timezone}</span>
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
                  <option value="__custom__">{t.timezoneCustom}</option>
                </select>
                <button
                  type="button"
                  className={cn(
                    'shrink-0 rounded-lg border border-edge bg-surface-panel px-3 py-2 text-xs font-medium text-fg-muted hover:bg-surface-hover hover:text-fg',
                    interaction.press,
                  )}
                  onClick={handleDetectTimezone}
                >
                  {t.timezoneDetect}
                </button>
              </div>
              {showCustomTimezone ? (
                <input
                  className={cn(inputClass, 'mt-1 font-mono text-xs')}
                  value={customTimezone}
                  onChange={(e) => {
                    setCustomTimezone(e.target.value);
                    updateUser({ timezone: e.target.value });
                  }}
                  placeholder="e.g. Asia/Shanghai"
                  autoComplete="off"
                />
              ) : null}
            </div>

            <label className="flex flex-col gap-1.5 text-sm sm:col-span-2">
              <span className="font-medium text-fg">{t.notes}</span>
              <textarea
                className={cn(inputClass, 'min-h-28 resize-y text-sm leading-relaxed')}
                value={user.notes}
                onChange={(e) => updateUser({ notes: e.target.value })}
                placeholder={t.notesPlaceholder}
                rows={5}
                spellCheck
              />
            </label>
          </div>
        )}

        <div className="mt-4 flex items-start gap-2 rounded-lg bg-accent-soft/30 px-3 py-2.5 text-xs text-fg-muted">
          <Info className="mt-0.5 size-3.5 shrink-0 text-accent" aria-hidden />
          <span>{t.note}</span>
        </div>

        {error ? <p className="mt-3 text-sm text-danger">{error}</p> : null}
      </SettingsFormSection>
    </SettingsPageFrame>
  );
}
