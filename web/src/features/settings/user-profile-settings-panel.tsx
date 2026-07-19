import { Info, Save, UserCircle } from 'lucide-react';
import { useEffect, useState } from 'react';

import {
  fetchUserProfileContent,
  saveUserProfileContent,
} from '@/features/settings/agents-admin-api';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  SettingsFormSection,
  SettingsFormSectionHeader,
} from '@/features/settings/settings-form-section';
import { SettingsPageFrame, SettingsPageHeader } from '@/features/settings/settings-page-layout';
import {
  detectBrowserTimezone,
  parseUserMarkdown,
  serializeUserMarkdown,
  type UserFields,
} from '@/features/settings/agents/agent-profile-markdown';
import { UserProfileFieldsEditor } from '@/features/settings/user-profile-fields-editor';
import { agentsSettingsInputClass } from '@/features/settings/agents/utils';
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

function UserProfileFormSkeleton() {
  return (
    <div className="grid gap-4 sm:grid-cols-2" aria-hidden="true">
      <div className="grid gap-2">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-10 rounded-lg" />
      </div>
      <div className="grid gap-2">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-10 rounded-lg" />
      </div>
      <div className="grid gap-2 sm:col-span-2">
        <Skeleton className="h-4 w-28" />
        <Skeleton className="h-28 rounded-lg" />
      </div>
    </div>
  );
}

export function UserProfileSettingsPanel() {
  const language = useLocaleStore((s) => s.language);
  const m = messages(language);
  const t = m.userProfileSettings;
  const inputClass = agentsSettingsInputClass();

  const [user, setUser] = useState<UserFields>(emptyUser);
  const [snapshot, setSnapshot] = useState(JSON.stringify(emptyUser));
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
        setUser(parsed);
        setSnapshot(JSON.stringify(parsed));
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
          <UserProfileFormSkeleton />
        ) : (
          <UserProfileFieldsEditor
            value={user}
            onChange={(next) => {
              setUser(next);
              setSaved(false);
            }}
            labels={t}
            language={language}
            inputClassName={inputClass}
          />
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
