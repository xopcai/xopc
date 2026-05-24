import { Database, Loader2 } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import { useGatewayConfigSwr } from '@/features/gateway/gateway-config-swr';
import {
  normalizeSessionConfigFromConfig,
  patchSessionConfig,
  type SessionConfigState,
  type SessionDmScope,
} from '@/features/settings/session-config-api';
import { SettingsFormSection, SettingsFormSectionHeader } from '@/features/settings/settings-form-section';
import { settingsInputFocusClass } from '@/lib/form-field-width';
import { cn } from '@/lib/cn';
import { messages } from '@/i18n/messages';
import { useLocaleStore } from '@/stores/locale-store';

function inputClassName(): string {
  return cn(
    'w-full rounded-lg border border-edge bg-surface-panel px-3 py-2 text-sm text-fg',
    settingsInputFocusClass,
    'dark:border-edge',
  );
}

export function SessionConfigSection({ hasToken }: { hasToken: boolean }) {
  const t = messages(useLocaleStore((s) => s.language)).sessions.config;
  const { data, isLoading } = useGatewayConfigSwr(hasToken);
  const parsed = useMemo(
    () => (data?.payload?.config !== undefined ? normalizeSessionConfigFromConfig(data.payload.config) : null),
    [data],
  );
  const [form, setForm] = useState<SessionConfigState | null>(null);
  const [baseline, setBaseline] = useState<SessionConfigState | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dirtyRef = useRef(false);

  useEffect(() => {
    if (!hasToken || parsed === null || dirtyRef.current) return;
    setForm(structuredClone(parsed));
    setBaseline(structuredClone(parsed));
  }, [hasToken, parsed]);

  const dirty = form && baseline && JSON.stringify(form) !== JSON.stringify(baseline);
  const update = useCallback((patch: Partial<SessionConfigState>) => {
    dirtyRef.current = true;
    setForm((f) => (f ? { ...f, ...patch } : null));
  }, []);

  if (!hasToken || !form) {
    return isLoading ? (
      <SettingsFormSection>
        <Loader2 className="size-4 animate-spin text-fg-muted" />
      </SettingsFormSection>
    ) : null;
  }

  return (
    <SettingsFormSection>
      <SettingsFormSectionHeader icon={Database} title={t.title} subtitle={t.hint} />
      <div className="mb-4 flex justify-end gap-2">
        <Button type="button" variant="secondary" disabled={!dirty || saving} onClick={() => baseline && setForm(structuredClone(baseline))}>
          {t.discard}
        </Button>
        <Button
          type="button"
          variant="primary"
          disabled={!dirty || saving}
          onClick={() => {
            void (async () => {
              setSaving(true);
              setError(null);
              try {
                await patchSessionConfig(form);
                dirtyRef.current = false;
                setBaseline(structuredClone(form));
              } catch (e) {
                setError(e instanceof Error ? e.message : t.saveError);
              } finally {
                setSaving(false);
              }
            })();
          }}
        >
          {saving ? t.saving : t.save}
        </Button>
      </div>
      {error ? <p className="mb-3 text-sm text-red-600 dark:text-red-400">{error}</p> : null}
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label className="mb-1 block text-sm font-medium text-fg">{t.dmScope}</label>
          <select className={inputClassName()} value={form.dmScope} onChange={(e) => update({ dmScope: e.target.value as SessionDmScope })}>
            <option value="main">{t.dmScopeMain}</option>
            <option value="per-peer">{t.dmScopePerPeer}</option>
            <option value="per-channel-peer">{t.dmScopePerChannelPeer}</option>
            <option value="per-account-channel-peer">{t.dmScopePerAccountChannelPeer}</option>
          </select>
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
