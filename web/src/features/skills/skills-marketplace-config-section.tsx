import { Store, Loader2 } from 'lucide-react';
import { useCallback, useMemo, useReducer, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import { useGatewayConfigSwr } from '@/features/gateway/gateway-config-swr';
import {
  listKnownMarketplaceProviders,
  normalizeSkillsMarketplaceFromConfig,
  patchSkillsMarketplaceConfig,
  type SkillsMarketplaceConfigState,
} from '@/features/skills/skills-marketplace-config-api';
import { SettingsFormSection, SettingsFormSectionHeader } from '@/features/settings/settings-form-section';
import { settingsInputFocusClass } from '@/lib/form-field-width';
import { createFormDraftReducer, syncFormDraftFromParsed } from '@/lib/settings-form-draft';
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

const marketplaceFormReducer = createFormDraftReducer<SkillsMarketplaceConfigState>();

export function SkillsMarketplaceConfigSection({ hasToken }: { hasToken: boolean }) {
  const t = messages(useLocaleStore((s) => s.language)).skillsMarketplaceSettings;
  const providers = listKnownMarketplaceProviders();
  const { data, isLoading } = useGatewayConfigSwr(hasToken);
  const parsed = useMemo(
    () =>
      data?.payload?.config !== undefined ? normalizeSkillsMarketplaceFromConfig(data.payload.config) : null,
    [data],
  );
  const [formDraft, dispatchForm] = useReducer(marketplaceFormReducer, { form: null, baseline: null });
  const form = formDraft.form;
  const baseline = formDraft.baseline;
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dirtyRef = useRef(false);
  const trackedParsedRef = useRef<SkillsMarketplaceConfigState | null>(null);

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

  const dirty = form && baseline && JSON.stringify(form) !== JSON.stringify(baseline);
  const update = useCallback((patch: Partial<SkillsMarketplaceConfigState>) => {
    dirtyRef.current = true;
    dispatchForm({ type: 'patch', patch });
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
      <SettingsFormSectionHeader icon={Store} title={t.title} subtitle={t.hint} />
      <div className="mb-4 flex justify-end gap-2">
        <Button type="button" variant="secondary" disabled={!dirty || saving} onClick={() => dispatchForm({ type: 'discard' })}>
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
                await patchSkillsMarketplaceConfig(form);
                dirtyRef.current = false;
                dispatchForm({ type: 'saved', value: form });
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
        <div>
          <label className="mb-1 block text-sm font-medium text-fg">{t.provider}</label>
          <select className={inputClassName()} value={form.provider} onChange={(e) => update({ provider: e.target.value })}>
            {providers.map((id) => (
              <option key={id} value={id}>
                {id}
              </option>
            ))}
          </select>
          <p className="mt-1 text-xs text-fg-subtle">{t.providerHint}</p>
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-fg">{t.storeBaseUrl}</label>
          <input className={cn(inputClassName(), 'font-mono text-xs')} value={form.storeBaseUrl} onChange={(e) => update({ storeBaseUrl: e.target.value })} />
          <p className="mt-1 text-xs text-fg-subtle">{t.storeBaseUrlHint}</p>
        </div>
      </div>
    </SettingsFormSection>
  );
}
