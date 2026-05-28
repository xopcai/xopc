import { Ban, ExternalLink, Loader2, Plus, Search, Trash2 } from 'lucide-react';
import { useCallback, useMemo, useReducer, useRef, useState, type ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import { useGatewayConfigSwr } from '@/features/gateway/gateway-config-swr';
import {
  normalizeWebSearchSettingsFromConfig,
  patchWebSearchSettings,
  type SearchProviderRow,
  type WebSearchSettingsState,
} from '@/features/settings/web-search-config-api';
import { useSaveBarRegistration } from '@/features/settings/save-bar/use-save-bar-registration';
import { SettingsFormSection, SettingsFormSectionHeader } from '@/features/settings/settings-form-section';
import { isMaskedKey } from '@/features/settings/providers-api';
import { nativeSelectMaxWidthClass, selectControlBaseClass, settingsInputFocusClass } from '@/lib/form-field-width';
import { cn } from '@/lib/cn';
import { messages, type WebSearchSettingsMessages } from '@/i18n/messages';
import { docsGuidePageUrl } from '@/navigation';
import { createFormDraftReducer, syncFormDraftFromParsed } from '@/lib/settings-form-draft';
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

const webSearchFormReducer = createFormDraftReducer<WebSearchSettingsState>();

/**
 * `embedded` strips the outer `mx-auto max-w-app-main` page wrapper, the
 * page title/subtitle/docs block, and the duplicate vertical padding so the
 * panel slots cleanly into the M3.4 hub. Save / Discard / Configure-with-AI
 * stay because each section saves independently.
 */
export function WebSearchSettingsPanel({ embedded = false }: { embedded?: boolean } = {}) {
  const language = useLocaleStore((s) => s.language);
  const m = messages(language);
  const w = m.webSearchSettings;
  const logs = m.logs;
  const token = useGatewayStore((st) => st.token);
  const hasToken = Boolean(token);

  const [formDraft, dispatchForm] = useReducer(webSearchFormReducer, { form: null, baseline: null });
  const form = formDraft.form;
  const baseline = formDraft.baseline;
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saveOk, setSaveOk] = useState(false);
  const dirtyRef = useRef(false);
  const trackedParsedRef = useRef<WebSearchSettingsState | null>(null);

  const { data, error: swrError, isLoading, mutate } = useGatewayConfigSwr(hasToken);

  const parsed = useMemo(
    () =>
      data?.payload?.config !== undefined
        ? normalizeWebSearchSettingsFromConfig(data.payload.config)
        : null,
    [data],
  );

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

  const loading = Boolean(hasToken && isLoading && data === undefined && !swrError);
  const fetchError =
    swrError instanceof Error ? swrError.message : swrError ? String(swrError) : null;

  const dirty = useMemo(() => {
    if (!form || !baseline) return false;
    return JSON.stringify(form) !== JSON.stringify(baseline);
  }, [form, baseline]);

  const update = useCallback((patch: Partial<WebSearchSettingsState>) => {
    dirtyRef.current = true;
    dispatchForm({ type: 'patch', patch });
  }, []);

  const save = useCallback(async () => {
    if (!form || saving) return;
    setSaving(true);
    setError(null);
    setSaveOk(false);
    try {
      await patchWebSearchSettings(form);
      dirtyRef.current = false;
      dispatchForm({ type: 'saved', value: form });
      setSaveOk(true);
      window.setTimeout(() => setSaveOk(false), 2500);
    } catch (e) {
      setError(e instanceof Error ? e.message : w.saveError);
    } finally {
      setSaving(false);
    }
  }, [form, saving, w.saveError]);

  const discard = useCallback(() => {
    if (!baseline) return;
    dirtyRef.current = false;
    dispatchForm({ type: 'discard' });
    setError(null);
    setSaveOk(false);
  }, [baseline]);

  // Coordinate with the hub-level Save bar (no-op when this panel is opened
  // standalone since no provider wraps it).
  useSaveBarRegistration({ id: 'search', dirty, saving, save, discard });

  const outerClass = embedded
    ? 'flex flex-col gap-4'
    : 'mx-auto flex w-full max-w-app-main flex-col gap-6 px-4 py-6';
  const compactClass = embedded
    ? 'flex flex-col gap-3'
    : 'mx-auto flex w-full max-w-app-main flex-col gap-3 px-4 py-8';

  if (!hasToken) {
    return (
      <div className={compactClass}>
        {embedded ? null : <h1 className="text-lg font-semibold text-fg">{w.title}</h1>}
        <p className="text-sm text-fg-muted">{w.needToken}</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className={cn(compactClass, 'items-center')}>
        <Loader2 className="size-8 animate-spin text-fg-muted" aria-hidden />
        <p className="text-sm text-fg-muted">{w.loading}</p>
      </div>
    );
  }

  if (!form) {
    return (
      <div className={compactClass}>
        <p className="text-sm text-fg-muted">{error ?? fetchError ?? w.loadError}</p>
        <Button type="button" variant="secondary" onClick={() => void mutate()}>
          {logs.refresh}
        </Button>
      </div>
    );
  }

  return (
    <div className={outerClass}>
      <header className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        {embedded ? (
          <div className="min-w-0" aria-hidden />
        ) : (
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
        )}
        {/*
         * In `embedded` mode the hub's `<SaveBarControls />` aggregates
         * save/discard across every section, so rendering them here too
         * would give users two competing buttons. Keep the in-panel
         * controls only when this panel is opened standalone.
         */}
        {embedded ? null : (
          <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
            {saveOk ? <span className="text-sm text-fg-muted">{w.saved}</span> : null}
            <Button type="button" variant="secondary" disabled={!dirty || saving} onClick={discard}>
              {w.discard}
            </Button>
            <Button type="button" variant="primary" disabled={!dirty || saving} onClick={() => void save()}>
              {saving ? w.saving : w.save}
            </Button>
          </div>
        )}
      </header>

      {dirty && !embedded ? <p className="text-xs text-amber-800 dark:text-amber-200">{w.unsavedHint}</p> : null}
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
        <SettingsFormSectionHeader icon={Ban} title={w.sectionBlocklist} subtitle={w.sectionBlocklistHint} />
        <div className="flex max-w-xl flex-col gap-4">
          <label className="flex cursor-pointer items-start gap-2 text-sm text-fg">
            <input
              type="checkbox"
              className="ui-checkbox mt-0.5"
              checked={form.blocklistEnabled}
              onChange={(e) => update({ blocklistEnabled: e.target.checked })}
            />
            <span>
              <span className="font-medium">{w.blocklistEnabled}</span>
              <span className="mt-0.5 block text-xs text-fg-subtle">{w.blocklistEnabledDesc}</span>
            </span>
          </label>
          <Field label={w.blocklistDomains} description={w.blocklistDomainsDesc}>
            <textarea
              className={cn(inputClassName(), 'min-h-[6rem] font-mono text-xs')}
              value={form.blocklistDomains.join('\n')}
              placeholder={w.blocklistDomainsPlaceholder}
              disabled={!form.blocklistEnabled}
              onChange={(e) => {
                const domains = e.target.value.split(/\r?\n/).flatMap((line) => {
                  const v = line.trim().toLowerCase();
                  return v ? [v] : [];
                });
                update({ blocklistDomains: domains });
              }}
            />
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
                key={`${row.type}:${row.url}:${row.apiKey}:${row.disabled}`}
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
