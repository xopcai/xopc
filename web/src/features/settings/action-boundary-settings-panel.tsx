import { ShieldCheck } from 'lucide-react';
import { useState } from 'react';
import useSWR from 'swr';

import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import {
  SettingsFormSection,
  SettingsFormSectionHeader,
} from '@/features/settings/settings-form-section';
import {
  SettingsPageFrame,
  SettingsPageHeader,
} from '@/features/settings/settings-page-layout';
import { SettingsPanelSkeleton } from '@/features/settings/settings-loading-skeleton';
import {
  fetchUserContext,
  updateUserTrust,
  type UserContextResponse,
  type UserTrustLevel,
} from '@/features/user-context/user-context-api';
import { messages } from '@/i18n/messages';
import { cn } from '@/lib/cn';
import { showToast } from '@/lib/toast';
import { useLocaleStore } from '@/stores/locale-store';

export function ActionBoundarySettingsPanel() {
  const language = useLocaleStore((state) => state.language);
  const m = messages(language);
  const t = m.you;
  const s = m.actionBoundarySettings;
  const { data, error, isLoading, mutate } = useSWR<UserContextResponse>(
    '/api/you',
    fetchUserContext,
  );
  const [saving, setSaving] = useState(false);
  const [pendingLevel, setPendingLevel] = useState<UserTrustLevel | null>(null);

  async function selectLevel(level: UserTrustLevel) {
    if (saving || level === data?.trust.defaultActionLevel) return;
    setSaving(true);
    try {
      const trust = await updateUserTrust(level);
      await mutate(
        (current) => current ? { ...current, trust } : current,
        { revalidate: false },
      );
      showToast({ type: 'success', title: s.title, message: t.saved });
    } catch {
      showToast({ type: 'error', title: s.title, message: t.saveError });
    } finally {
      setSaving(false);
      setPendingLevel(null);
    }
  }

  return (
    <SettingsPageFrame gap="gap-6">
      <SettingsPageHeader title={s.title} subtitle={s.subtitle} />

      <SettingsFormSection>
        <SettingsFormSectionHeader
          icon={ShieldCheck}
          title={t.trustTitle}
          subtitle={t.trustHint}
        />

        {isLoading ? (
          <SettingsPanelSkeleton rows={4} />
        ) : error || !data ? (
          <p className="rounded-xl border border-danger/25 bg-danger-soft p-4 text-sm text-danger">
            {s.loadError}
          </p>
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-2">
              {data.trust.levels.map((level) => {
                const selected = level === data.trust.defaultActionLevel;
                return (
                  <button
                    key={level}
                    type="button"
                    aria-pressed={selected}
                    disabled={saving}
                    onClick={() => {
                      if (level === 'auto') {
                        setPendingLevel(level);
                        return;
                      }
                      void selectLevel(level);
                    }}
                    className={cn(
                      'rounded-xl border p-4 text-left transition-colors',
                      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 disabled:opacity-70',
                      selected
                        ? 'border-accent/35 bg-accent-soft/35'
                        : 'border-edge-subtle bg-surface-panel hover:border-accent/25 hover:bg-surface-hover',
                    )}
                  >
                    <p className="text-sm font-semibold text-fg">{t.trustLevels[level]}</p>
                    <p className="mt-1 text-xs leading-5 text-fg-muted">{t.trustLevelHints[level]}</p>
                    {selected ? (
                      <span className="mt-3 inline-block rounded-full bg-accent-soft px-2 py-0.5 text-[11px] text-accent-fg">
                        {t.defaultTrust}
                      </span>
                    ) : null}
                  </button>
                );
              })}
            </div>
            <p className="mt-4 text-xs leading-5 text-fg-subtle">{t.autoOptInPromise}</p>
          </>
        )}
      </SettingsFormSection>

      <ConfirmDialog
        open={pendingLevel === 'auto'}
        title={t.autoConfirmTitle}
        description={t.autoConfirmBody}
        confirmLabel={t.autoConfirmAction}
        cancelLabel={t.cancel}
        onConfirm={() => void selectLevel('auto')}
        onCancel={() => setPendingLevel(null)}
      />
    </SettingsPageFrame>
  );
}
