import { Database } from 'lucide-react';
import { useCallback, useMemo, useReducer, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useGatewayConfigSwr } from '@/features/gateway/gateway-config-swr';
import { useSaveBarRegistration } from '@/features/settings/save-bar/use-save-bar-registration';
import {
  normalizeSessionConfigFromConfig,
  patchSessionConfig,
  type SessionConfigState,
  type SessionDmScope,
} from '@/features/settings/session-config-api';
import { SettingsFormSection, SettingsFormSectionHeader } from '@/features/settings/settings-form-section';
import { settingsInputFocusClass } from '@/lib/form-field-width';
import { createFormDraftReducer, syncFormDraftFromParsed } from '@/lib/settings-form-draft';
import { cn } from '@/lib/cn';
import { messages } from '@/i18n/messages';
import { useLocaleStore } from '@/stores/locale-store';
import { Select, SelectOption } from '@/components/ui/popover-select';

function inputClassName(): string {
  return cn(
    'w-full rounded-lg border border-edge bg-surface-panel px-3 py-2 text-sm text-fg',
    settingsInputFocusClass,
    'dark:border-edge',
  );
}

const sessionFormReducer = createFormDraftReducer<SessionConfigState>();

export function SessionConfigSection({ hasToken }: { hasToken: boolean }) {
  const t = messages(useLocaleStore((s) => s.language)).sessions.config;
  const { data, isLoading } = useGatewayConfigSwr(hasToken);
  const parsed = useMemo(
    () => (data?.payload?.config !== undefined ? normalizeSessionConfigFromConfig(data.payload.config) : null),
    [data],
  );
  const [formDraft, dispatchForm] = useReducer(sessionFormReducer, { form: null, baseline: null });
  const form = formDraft.form;
  const baseline = formDraft.baseline;
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dirtyRef = useRef(false);
  const trackedParsedRef = useRef<SessionConfigState | null>(null);

  syncFormDraftFromParsed({
    enabled: hasToken,
    parsed,
    dirty: dirtyRef.current,
    trackedParsedRef,
    dispatch: dispatchForm,
    onResetDirty: () => {
      dirtyRef.current = false;
    },
  });

  const dirty = Boolean(form && baseline && JSON.stringify(form) !== JSON.stringify(baseline));
  const update = useCallback((patch: Partial<SessionConfigState>) => {
    dirtyRef.current = true;
    dispatchForm({ type: 'patch', patch });
  }, []);

  const discard = useCallback(() => {
    dirtyRef.current = false;
    setError(null);
    dispatchForm({ type: 'discard' });
  }, []);

  const save = useCallback(async () => {
    if (!form) return;
    setSaving(true);
    setError(null);
    try {
      await patchSessionConfig(form);
      dirtyRef.current = false;
      dispatchForm({ type: 'saved', value: form });
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : t.saveError;
      setError(message);
      throw new Error(message);
    } finally {
      setSaving(false);
    }
  }, [form, t.saveError]);

  useSaveBarRegistration({ id: 'session-storage', dirty, saving, save, discard });

  if (!hasToken || !form) {
    return isLoading ? (
      <SettingsFormSection>
        <div className="space-y-3" aria-busy>
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-24 w-full rounded-xl" />
        </div>
      </SettingsFormSection>
    ) : null;
  }

  return (
    <SettingsFormSection>
      <SettingsFormSectionHeader icon={Database} title={t.title} subtitle={t.hint} />
      <div className="mb-4 flex justify-end gap-2">
        <Button type="button" variant="secondary" disabled={!dirty || saving} onClick={discard}>
          {t.discard}
        </Button>
        <Button
          type="button"
          variant="primary"
          disabled={!dirty || saving}
          onClick={() => void save().catch(() => {})}
        >
          {saving ? t.saving : t.save}
        </Button>
      </div>
      {error ? <p className="mb-3 text-sm text-red-600 dark:text-red-400">{error}</p> : null}
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label className="mb-1 block text-sm font-medium text-fg">{t.dmScope}</label>
          <Select className={inputClassName()} value={form.dmScope} onChange={(e) => update({ dmScope: e.target.value as SessionDmScope })}>
            <SelectOption value="main">{t.dmScopeMain}</SelectOption>
            <SelectOption value="per-peer">{t.dmScopePerPeer}</SelectOption>
            <SelectOption value="per-channel-peer">{t.dmScopePerChannelPeer}</SelectOption>
            <SelectOption value="per-account-channel-peer">{t.dmScopePerAccountChannelPeer}</SelectOption>
          </Select>
          <p className="mt-1 text-xs text-fg-subtle">{t.dmScopeHint}</p>
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-fg">{t.pruneAfterDays}</label>
          <input
            type="number"
            min={0}
            className={inputClassName()}
            value={form.pruneAfterDays ?? ''}
            placeholder={t.unsetPlaceholder}
            onChange={(e) => {
              const raw = e.target.value.trim();
              update({ pruneAfterDays: raw === '' ? null : Math.max(0, Math.floor(Number(raw) || 0)) });
            }}
          />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-fg">{t.maxEntries}</label>
          <input
            type="number"
            min={1}
            className={inputClassName()}
            value={form.maxEntries ?? ''}
            placeholder={t.unsetPlaceholder}
            onChange={(e) => {
              const raw = e.target.value.trim();
              update({ maxEntries: raw === '' ? null : Math.max(1, Math.floor(Number(raw) || 1)) });
            }}
          />
        </div>
      </div>
    </SettingsFormSection>
  );
}
