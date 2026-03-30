import { ExternalLink, Loader2, Plus, Search, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import {
  fetchWebSearchSettings,
  patchWebSearchSettings,
  type SearchProviderRow,
  type WebSearchSettingsState,
} from '@/features/settings/web-search-config-api';
import { SettingsFormSection, SettingsFormSectionHeader } from '@/features/settings/settings-form-section';
import { isMaskedKey } from '@/features/settings/providers-api';
import { nativeSelectMaxWidthClass, selectControlBaseClass, settingsInputFocusClass } from '@/lib/form-field-width';
import { cn } from '@/lib/cn';
import { messages, type WebSearchSettingsMessages } from '@/i18n/messages';
import { docsGuidePageUrl } from '@/navigation';
import { useGatewayStore } from '@/stores/gateway-store';
import { useLocaleStore } from '@/stores/locale-store';

function Field({
  label,
  description,
  children,
}: {
  label: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="text-sm font-medium text-fg">{label}</div>
      {children}
      <p className="text-xs leading-relaxed text-fg-subtle">{description}</p>
    </div>
  );
}

function inputClassName(): string {
  return cn(
    'w-full rounded-lg border border-edge bg-surface-panel px-3 py-2 text-sm text-fg',
    'placeholder:text-fg-subtle',
    settingsInputFocusClass,
    'dark:border-edge',
  );
}

function selectClassName(): string {
  return cn(selectControlBaseClass, nativeSelectMaxWidthClass);
}

const PROVIDER_TYPES: SearchProviderRow['type'][] = ['brave', 'tavily', 'bing', 'searxng'];

function emptyProviderRow(): SearchProviderRow {
  return { type: 'brave', apiKey: '', url: '', disabled: false };
}

export function WebSearchSettingsPanel() {
  const language = useLocaleStore((s) => s.language);
  const m = messages(language);
  const w = m.webSearchSettings;
  const token = useGatewayStore((st) => st.token);
  const hasToken = Boolean(token);

  const [form, setForm] = useState<WebSearchSettingsState | null>(null);
  const [baseline, setBaseline] = useState<WebSearchSettingsState | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saveOk, setSaveOk] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchWebSearchSettings();
      setForm(data);
      setBaseline(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : w.loadError);
      setForm(null);
      setBaseline(null);
    } finally {
      setLoading(false);
    }
  }, [w.loadError]);

  useEffect(() => {
    if (!hasToken) {
      setLoading(false);
      setForm(null);
      setBaseline(null);
      return;
    }
    void load();
  }, [hasToken, load]);

  const dirty = useMemo(() => {
    if (!form || !baseline) return false;
    return JSON.stringify(form) !== JSON.stringify(baseline);
  }, [form, baseline]);

  const update = useCallback((patch: Partial<WebSearchSettingsState>) => {
    setForm((f) => (f ? { ...f, ...patch } : null));
  }, []);

  const save = useCallback(async () => {
    if (!form || saving) return;
    setSaving(true);
    setError(null);
    setSaveOk(false);
    try {
      await patchWebSearchSettings(form);
      const next = await fetchWebSearchSettings();
      setForm(next);
      setBaseline(next);
      setSaveOk(true);
      window.setTimeout(() => setSaveOk(false), 2500);
    } catch (e) {
      setError(e instanceof Error ? e.message : w.saveError);
    } finally {
      setSaving(false);
    }
  }, [form, saving, w.saveError]);

  if (!hasToken) {
    return (
      <div className="mx-auto flex w-full max-w-app-main flex-col gap-4 px-4 py-6">
        <h1 className="text-lg font-semibold text-fg">{w.title}</h1>
        <p className="text-sm text-fg-muted">{w.needToken}</p>
      </div>
    );
  }

  if (loading || !form) {
    return (
      <div className="mx-auto flex w-full max-w-app-main flex-col items-center gap-3 px-4 py-8">
        <Loader2 className="size-8 animate-spin text-fg-muted" aria-hidden />
        <p className="text-sm text-fg-muted">{w.loading}</p>
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-app-main flex-col gap-6 px-4 py-6">
      <header className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-lg font-semibold tracking-tight text-fg">{w.title}</h1>
          <p className="mt-1 text-sm text-fg-muted">{w.subtitle}</p>
          <a
            href={docsGuidePageUrl(language, 'gateway')}
            target="_blank"
            rel="noreferrer"
            className="mt-1 inline-flex items-center gap-1 text-sm text-accent hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
          >
            {w.docsLink}
            <ExternalLink className="size-3.5" />
          </a>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {saveOk ? <span className="text-sm text-fg-muted">{w.saved}</span> : null}
          <Button type="button" variant="primary" disabled={!dirty || saving} onClick={() => void save()}>
            {saving ? w.saving : w.save}
          </Button>
        </div>
      </header>

      {dirty ? <p className="text-xs text-amber-800 dark:text-amber-200">{w.unsavedHint}</p> : null}
      {error ? <p className="text-sm text-red-600 dark:text-red-400">{error}</p> : null}

      <SettingsFormSection>
        <SettingsFormSectionHeader icon={Search} title={w.sectionRegion} subtitle={w.sectionRegionHint} />
        <div className="flex max-w-md flex-col gap-4">
          <Field label={w.regionLabel} description={w.regionDesc}>
            <select
              className={selectClassName()}
              value={form.regionMode}
              onChange={(e) =>
                update({
                  regionMode: e.target.value as WebSearchSettingsState['regionMode'],
                })
              }
            >
              <option value="auto">{w.regionAuto}</option>
              <option value="cn">{w.regionCn}</option>
              <option value="global">{w.regionGlobal}</option>
            </select>
          </Field>
        </div>
      </SettingsFormSection>

      <SettingsFormSection>
        <SettingsFormSectionHeader icon={Search} title={w.sectionSearch} subtitle={w.sectionSearchHint} />
        <div className="flex max-w-xl flex-col gap-6">
          <Field label={w.maxResultsLabel} description={w.maxResultsDesc}>
            <input
              type="number"
              min={1}
              max={50}
              className={inputClassName()}
              value={form.maxResults}
              onChange={(e) => update({ maxResults: Math.max(1, Math.min(50, Number(e.target.value) || 5)) })}
            />
          </Field>

          <div className="flex flex-col gap-3">
            <div className="text-sm font-medium text-fg">{w.providersTitle}</div>
            {form.providers.map((row, index) => (
              <ProviderRowEditor
                key={index}
                row={row}
                labels={w}
                onChange={(next) => {
                  const nextRows = [...form.providers];
                  nextRows[index] = next;
                  update({ providers: nextRows });
                }}
                onRemove={() => {
                  update({ providers: form.providers.filter((_, i) => i !== index) });
                }}
              />
            ))}
            <Button
              type="button"
              variant="secondary"
              className="w-fit gap-1.5 text-sm"
              onClick={() => update({ providers: [...form.providers, emptyProviderRow()] })}
            >
              <Plus className="size-4" />
              {w.addProvider}
            </Button>
          </div>
        </div>
      </SettingsFormSection>

      <p className="text-xs leading-relaxed text-fg-subtle">{w.footerHint}</p>
    </div>
  );
}

function ProviderRowEditor({
  row,
  labels,
  onChange,
  onRemove,
}: {
  row: SearchProviderRow;
  labels: WebSearchSettingsMessages;
  onChange: (r: SearchProviderRow) => void;
  onRemove: () => void;
}) {
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-edge-subtle bg-surface-panel/60 p-4 dark:border-edge-subtle">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <select
          className={cn(selectClassName(), 'min-w-[8rem]')}
          value={row.type}
          onChange={(e) =>
            onChange({
              ...row,
              type: e.target.value as SearchProviderRow['type'],
              url: e.target.value === 'searxng' ? row.url : '',
            })
          }
        >
          {PROVIDER_TYPES.map((t) => (
            <option key={t} value={t}>
              {labels.providerTypes[t]}
            </option>
          ))}
        </select>
        <div className="flex items-center gap-2">
          <label className="flex cursor-pointer items-center gap-1.5 text-xs text-fg-muted">
            <input
              type="checkbox"
              className="size-3.5 rounded border-edge"
              checked={row.disabled}
              onChange={(e) => onChange({ ...row, disabled: e.target.checked })}
            />
            {labels.disabled}
          </label>
          <Button type="button" variant="ghost" className="h-8 px-2 text-fg-muted" onClick={onRemove}>
            <Trash2 className="size-4" />
          </Button>
        </div>
      </div>
      {row.type === 'searxng' ? (
        <Field label={labels.urlLabel} description={labels.urlDesc}>
          <input
            type="url"
            className={inputClassName()}
            value={row.url}
            placeholder="http://localhost:8080"
            onChange={(e) => onChange({ ...row, url: e.target.value })}
          />
        </Field>
      ) : null}
      <Field label={labels.apiKeyLabel} description={labels.apiKeyDesc}>
        <input
          type="password"
          autoComplete="off"
          className={inputClassName()}
          value={isMaskedKey(row.apiKey) ? '' : row.apiKey}
          placeholder={isMaskedKey(row.apiKey) ? labels.keyPlaceholderMasked : labels.keyPlaceholder}
          onChange={(e) => onChange({ ...row, apiKey: e.target.value })}
        />
      </Field>
    </div>
  );
}
