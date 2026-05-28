import {
  CheckCircle2,
  ChevronDown,
  KeyRound,
  Search,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import useSWR from 'swr';

import { Button } from '@/components/ui/button';
import { CONFIGURED_MODELS_SWR_KEY, fetchConfiguredModelsCached } from '@/features/chat/api/registry-api';
import { useSaveBarRegistration } from '@/features/settings/save-bar/use-save-bar-registration';
import { useGatewayConfigSwr } from '@/features/gateway/gateway-config-swr';
import {
  isMaskedKey,
  mergeProviderRows,
  patchProviderApiKeys,
  providersKeysFromConfigRoot,
  type ProviderMeta,
  type ProviderRowModel,
} from '@/features/settings/providers-api';
import { PROVIDER_ENRICHMENT } from '@/features/settings/provider-enrichment';
import { ProviderCredentialRow } from './provider-credential-row';
import { CATEGORY_ORDER, groupByCategory, interpolate } from './providers-settings-lib';
import { fetchJson } from '@/lib/fetch';
import { apiUrl } from '@/lib/url';
import { settingsInputFocusClass } from '@/lib/form-field-width';
import { cn } from '@/lib/cn';
import { interaction } from '@/lib/interaction';
import { messages } from '@/i18n/messages';
import { useGatewayStore } from '@/stores/gateway-store';
import { useLocaleStore } from '@/stores/locale-store';

type ProvidersDraft = {
  draft: Record<string, string>;
  baseline: Record<string, string>;
};

type ProvidersDraftAction =
  | { type: 'reset' }
  | { type: 'sync'; rows: ProviderRowModel[] }
  | { type: 'patch'; id: string; value: string }
  | { type: 'discard' }
  | { type: 'commitDraft' }
  | { type: 'saved'; rows: ProviderRowModel[] };

function providersDraftReducer(state: ProvidersDraft, action: ProvidersDraftAction): ProvidersDraft {
  switch (action.type) {
    case 'reset':
      return { draft: {}, baseline: {} };
    case 'sync': {
      const d: Record<string, string> = {};
      for (const r of action.rows) d[r.id] = r.apiKey;
      return { draft: d, baseline: { ...d } };
    }
    case 'patch':
      return { ...state, draft: { ...state.draft, [action.id]: action.value } };
    case 'discard':
      return { ...state, draft: { ...state.baseline } };
    case 'commitDraft':
      return { ...state, baseline: { ...state.draft } };
    case 'saved': {
      const d: Record<string, string> = {};
      for (const r of action.rows) d[r.id] = r.apiKey;
      return { draft: d, baseline: { ...d } };
    }
  }
}

/** See `WebSearchSettingsPanel` for the embedded-mode contract. */
export function ProvidersSettingsPanel({ embedded = false }: { embedded?: boolean } = {}) {
  const language = useLocaleStore((s) => s.language);
  const m = messages(language);
  const p = m.providersSettings;
  const token = useGatewayStore((st) => st.token);
  const hasToken = Boolean(token);

  const [draftState, dispatchDraft] = useReducer(providersDraftReducer, { draft: {}, baseline: {} });
  const draft = draftState.draft;
  const baseline = draftState.baseline;
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saveNotice, setSaveNotice] = useState<null | 'saved' | 'noChanges'>(null);
  const [expandedCats, setExpandedCats] = useState<Set<string>>(() => new Set(['common']));
  const [searchQuery, setSearchQuery] = useState('');
  const [unconfiguredOnly, setUnconfiguredOnly] = useState(false);
  const [savedProviderIds, setSavedProviderIds] = useState<Set<string>>(() => new Set());
  const [quickStartProviderId, setQuickStartProviderId] = useState<string | null>(null);
  const dirtyRef = useRef(false);

  const metaUrl = apiUrl('/api/providers/meta');
  const fetchMetaList = useCallback(async (url: string) => {
    const data = await fetchJson<{ ok?: boolean; payload?: { providers?: ProviderMeta[] } }>(url);
    return data.payload?.providers ?? [];
  }, []);

  const {
    data: cfgData,
    error: cfgErr,
    isLoading: cfgLoading,
    mutate: mutCfg,
  } = useGatewayConfigSwr(hasToken);
  const {
    data: metaList,
    error: metaErr,
    isLoading: metaLoading,
    mutate: mutMeta,
  } = useSWR(hasToken ? metaUrl : null, fetchMetaList, { revalidateOnFocus: false });
  const { data: models, mutate: mutModels } = useSWR(
    hasToken ? CONFIGURED_MODELS_SWR_KEY : null,
    () => fetchConfiguredModelsCached(),
    { revalidateOnFocus: false },
  );

  const mergedRows = useMemo((): ProviderRowModel[] | null => {
    if (!metaList || cfgData === undefined) return null;
    const keys = providersKeysFromConfigRoot(cfgData.payload?.config);
    return mergeProviderRows(metaList, keys, models ?? []);
  }, [metaList, cfgData, models]);

  const fetchError =
    cfgErr instanceof Error
      ? cfgErr.message
      : cfgErr
        ? String(cfgErr)
        : metaErr instanceof Error
          ? metaErr.message
          : metaErr
            ? String(metaErr)
            : null;

  const loading = Boolean(
    hasToken && mergedRows === null && (cfgLoading || metaLoading) && !fetchError,
  );

  const dirty = useMemo(
    () => JSON.stringify(draft) !== JSON.stringify(baseline),
    [draft, baseline],
  );

  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [dirty]);

  useEffect(() => {
    if (!hasToken || mergedRows === null) return;
    if (!dirtyRef.current) {
      dispatchDraft({ type: 'sync', rows: mergedRows });
    }
  }, [hasToken, mergedRows]);

  const metaRows = mergedRows ?? [];

  const filteredRows = useMemo(() => {
    let rows = metaRows;
    const q = searchQuery.trim().toLowerCase();
    if (q) {
      rows = rows.filter((r) => {
        const enrichment = PROVIDER_ENRICHMENT[r.id];
        const aliases = enrichment?.aliases ?? [];
        return (
          r.id.toLowerCase().includes(q) ||
          r.name.toLowerCase().includes(q) ||
          aliases.some((alias) => alias.toLowerCase().includes(q))
        );
      });
    }
    if (unconfiguredOnly) {
      rows = rows.filter((r) => !r.configured);
    }
    return rows;
  }, [metaRows, searchQuery, unconfiguredOnly]);

  const groups = useMemo(() => groupByCategory(filteredRows), [filteredRows]);

  const searchTrim = searchQuery.trim();
  const effectiveExpandedCats = useMemo(() => {
    if (searchTrim) {
      const next = new Set<string>();
      for (const c of CATEGORY_ORDER) {
        if ((groups.get(c) ?? []).length > 0) next.add(c);
      }
      return next;
    }
    return expandedCats;
  }, [searchTrim, groups, expandedCats]);

  const save = useCallback(async () => {
    if (saving) return;
    const toPatch: Record<string, string> = {};
    for (const id of Object.keys(draft)) {
      const v = draft[id]?.trim() ?? '';
      if (!v || isMaskedKey(v)) continue;
      toPatch[id] = v;
    }
    if (Object.keys(toPatch).length === 0) {
      dispatchDraft({ type: 'commitDraft' });
      dirtyRef.current = false;
      setSaveNotice('noChanges');
      window.setTimeout(() => setSaveNotice(null), 2500);
      return;
    }
    setSaving(true);
    setError(null);
    setSaveNotice(null);
    try {
      await patchProviderApiKeys(toPatch);
      setSavedProviderIds(new Set(Object.keys(toPatch)));
      const freshModels = (await mutModels(fetchConfiguredModelsCached(true))) ?? models ?? [];
      const [nextCfg, nextMeta] = await Promise.all([mutCfg(), mutMeta()]);
      const list = Array.isArray(nextMeta) ? nextMeta : metaList ?? [];
      const cfg = nextCfg ?? cfgData;
      if (cfg?.payload) {
        const keys = providersKeysFromConfigRoot(cfg.payload.config);
        const rows = mergeProviderRows(list, keys, freshModels);
        dispatchDraft({ type: 'saved', rows });
        dirtyRef.current = false;
      }
      setSaveNotice('saved');
      window.setTimeout(() => setSaveNotice(null), 2500);
    } catch (e) {
      setError(e instanceof Error ? e.message : p.saveError);
    } finally {
      setSaving(false);
    }
  }, [cfgData, draft, metaList, models, mutCfg, mutMeta, mutModels, p.saveError, saving]);

  const discard = useCallback(() => {
    dirtyRef.current = false;
    dispatchDraft({ type: 'discard' });
    setError(null);
    setSaveNotice(null);
    setSavedProviderIds(new Set());
  }, [baseline]);

  useSaveBarRegistration({ id: 'providers', dirty, saving, save, discard });

  const toggleCat = (cat: string) => {
    setExpandedCats((prev) => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat);
      else next.add(cat);
      return next;
    });
  };

  const refreshProviders = useCallback(() => {
    void mutCfg();
    void mutMeta();
  }, [mutCfg, mutMeta]);

  const filtersActive = Boolean(searchQuery.trim() || unconfiguredOnly);

  const outerClass = embedded
    ? 'flex flex-col gap-4'
    : 'mx-auto flex w-full max-w-app-main flex-col gap-6 px-4 py-6';
  const compactClass = embedded
    ? 'flex flex-col gap-3'
    : 'mx-auto flex w-full max-w-app-main flex-col gap-3 px-4 py-10';
  const skeletonClass = embedded
    ? 'w-full'
    : 'mx-auto w-full max-w-app-main px-4 py-8';

  if (!hasToken) {
    return (
      <div className={compactClass}>
        <div className="flex items-start gap-3 rounded-2xl bg-surface-base p-6">
          <KeyRound className="mt-0.5 size-5 shrink-0 text-fg-subtle" strokeWidth={1.75} />
          <div>
            {embedded ? null : (
              <h1 className="text-base font-semibold text-fg">{m.settingsSections.providers}</h1>
            )}
            <p className={cn('text-sm text-fg-muted', !embedded && 'mt-1')}>{p.needToken}</p>
          </div>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className={skeletonClass}>
        <div className="h-8 w-48 animate-pulse rounded bg-surface-hover" />
        <div className="mt-6 h-32 animate-pulse rounded-xl bg-surface-hover" />
        <p className="mt-4 text-sm text-fg-muted">{m.logs.loading}</p>
      </div>
    );
  }

  if (metaRows.length === 0) {
    return (
      <div className={compactClass}>
        <div className="rounded-xl border border-edge-subtle bg-surface-base px-4 py-3">
          <p className="text-sm font-medium text-fg">{p.loadError}</p>
          <p className="mt-1 text-sm text-fg-muted">{error ?? fetchError ?? p.empty}</p>
        </div>
        <Button
          type="button"
          variant="secondary"
          onClick={() => {
            void mutCfg();
            void mutMeta();
          }}
        >
          {m.logs.refresh}
        </Button>
      </div>
    );
  }

  return (
    <div className={outerClass}>
      <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        {embedded ? (
          <div className="min-w-0" aria-hidden />
        ) : (
          <div className="min-w-0">
            <h1 className="text-lg font-semibold tracking-tight text-fg">{m.settingsSections.providers}</h1>
            <p className="mt-1 text-sm text-fg-muted">{p.subtitle}</p>
            <p className="mt-2 text-xs text-fg-subtle">{p.rotateHint}</p>
          </div>
        )}
        {/* See WebSearchSettingsPanel — global Save bar replaces these in embedded mode. */}
        {embedded ? null : (
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {saveNotice === 'saved' ? <span className="text-sm text-fg-muted">{p.saved}</span> : null}
          {saveNotice === 'noChanges' ? <span className="text-sm text-fg-muted">{p.noChangesSaved}</span> : null}
          <Button type="button" variant="secondary" disabled={!dirty || saving} onClick={discard}>
            {p.discard}
          </Button>
          <Button type="button" variant="primary" disabled={!dirty || saving} onClick={() => void save()}>
            {saving ? p.saving : p.save}
          </Button>
        </div>
        )}
      </header>

      {dirty && !embedded ? <p className="text-xs text-amber-800 dark:text-amber-200">{p.unsavedHint}</p> : null}

      {/*
       * Empty-state shortcut: when nothing is configured, surface 4 popular
       * providers as big quick-start buttons so users don't have to scan
       * 30 rows to find OpenAI / DeepSeek / Anthropic / Google. Clicking a
       * button just filters the list to that provider; the existing row
       * machinery (key input + Save) takes over from there.
       */}
      {metaRows.length > 0 && metaRows.every((r) => !r.configured) ? (
        <ProviderQuickStart
          intro={p.quickStartIntro ?? p.intro}
          recommended={['deepseek', 'openai', 'anthropic', 'google']}
          metaRows={metaRows}
          onPick={(id) => {
            setSearchQuery(id);
            setQuickStartProviderId(id);
            // Expand the category containing this provider
            const row = metaRows.find((r) => r.id === id);
            if (row) {
              const cat = row.category || 'specialty';
              setExpandedCats((prev) => new Set([...prev, cat]));
            }
          }}
        />
      ) : null}

      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
        <div className="relative min-w-0 flex-1 sm:max-w-md">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-fg-subtle"
            strokeWidth={1.75}
            aria-hidden
          />
          <input
            type="search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={p.searchPlaceholder}
            autoComplete="off"
            className={cn(
              'w-full rounded-lg border border-edge bg-surface-panel py-2 pl-10 pr-3 text-sm text-fg placeholder:text-fg-subtle',
              settingsInputFocusClass,
              'dark:border-edge',
            )}
            aria-label={p.searchPlaceholder}
          />
        </div>
        <label className="flex cursor-pointer items-center gap-2 text-sm text-fg-muted">
          <input
            type="checkbox"
            checked={unconfiguredOnly}
            onChange={(e) => setUnconfiguredOnly(e.target.checked)}
            className="size-4 rounded border-edge text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          />
          {p.unconfiguredOnly}
        </label>
        {filtersActive ? (
          <Button
            type="button"
            variant="ghost"
            className="h-9 w-fit self-start text-fg-muted"
            onClick={() => {
              setSearchQuery('');
              setUnconfiguredOnly(false);
            }}
          >
            {p.clearFilters}
          </Button>
        ) : null}
      </div>

      {error ? (
        <div
          className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/50 dark:text-red-400"
          role="alert"
        >
          {error}
        </div>
      ) : null}

      {filteredRows.length === 0 ? (
        <div className="rounded-xl border border-dashed border-edge-subtle bg-surface-base px-4 py-8 text-center text-sm text-fg-muted">
          <p>{p.noMatches}</p>
          <Button
            type="button"
            variant="secondary"
            className="mt-4"
            onClick={() => {
              setSearchQuery('');
              setUnconfiguredOnly(false);
            }}
          >
            {p.clearFilters}
          </Button>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {CATEGORY_ORDER.map((cat) => {
            const list = groups.get(cat) ?? [];
            if (list.length === 0) return null;
            const expanded = effectiveExpandedCats.has(cat);
            const configuredCount = list.filter((r) => r.configured).length;
            const panelId = `providers-cat-${cat}`;
            return (
              <section key={cat} className="overflow-hidden rounded-2xl bg-surface-base">
                <button
                  type="button"
                  id={`${panelId}-trigger`}
                  aria-expanded={expanded}
                  aria-controls={panelId}
                  className={cn(
                    'flex w-full items-center justify-between gap-2 border-b border-edge-subtle px-4 py-3 text-left transition-colors hover:bg-surface-hover/60 dark:border-edge-subtle',
                    interaction.pressCard,
                  )}
                  onClick={() => toggleCat(cat)}
                >
                  <span className="flex min-w-0 items-center gap-2 text-sm font-semibold text-fg">
                    <span className="truncate">{p.categories[cat]}</span>
                    <span className="shrink-0 rounded bg-surface-hover px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-fg-subtle">
                      {list.length}
                    </span>
                  </span>
                  <span className="flex shrink-0 items-center gap-2">
                    {configuredCount > 0 ? (
                      <span className="flex items-center gap-1 text-xs text-fg-subtle">
                        <CheckCircle2 className="size-3.5 text-emerald-600 dark:text-emerald-400" aria-hidden />
                        {interpolate(p.configuredCount, { count: String(configuredCount) })}
                      </span>
                    ) : null}
                    <ChevronDown
                      className={cn('size-4 text-fg-subtle transition-transform', expanded && 'rotate-180')}
                      aria-hidden
                    />
                  </span>
                </button>
                {expanded ? (
                  <div id={panelId} role="region" aria-labelledby={`${panelId}-trigger`} className="divide-y divide-edge-subtle">
                    {list.map((row) => {
                      const isQuickTarget = quickStartProviderId === row.id;
                      return (
                        <div id={`provider-row-${row.id}`} key={row.id}>
                          <ProviderCredentialRow
                            row={row}
                            value={draft[row.id] ?? ''}
                            rowDirty={(draft[row.id] ?? '') !== (baseline[row.id] ?? '')}
                            labels={p}
                            language={language}
                            onChange={(id, v) => {
                              dirtyRef.current = true;
                              dispatchDraft({ type: 'patch', id, value: v });
                            }}
                            onReload={refreshProviders}
                            justSaved={savedProviderIds.has(row.id)}
                            availableModels={models ?? []}
                            autoExpand={isQuickTarget}
                            autoFocusInput={isQuickTarget}
                          />
                        </div>
                      );
                    })}
                  </div>
                ) : null}
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}

/**
 * Empty-state shortcut for the Providers panel — 4 prominent buttons that
 * filter the list down to the picked provider so users don't have to scan
 * 30 categorised rows to find the one they want.
 */
function ProviderQuickStart({
  intro,
  recommended,
  metaRows,
  onPick,
}: {
  intro: string;
  recommended: readonly string[];
  metaRows: ProviderRowModel[];
  onPick: (providerId: string) => void;
}) {
  const available = recommended.filter((id) => metaRows.some((r) => r.id === id));
  if (available.length === 0) return null;
  const lookup = new Map(metaRows.map((r) => [r.id, r]));
  return (
    <div className="rounded-2xl border border-edge-subtle bg-surface-panel/40 p-4">
      <p className="mb-3 text-sm text-fg-muted">{intro}</p>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {available.map((id) => {
          const meta = lookup.get(id);
          const label = meta?.name ?? id;
          return (
            <Button
              key={id}
              type="button"
              variant="secondary"
              className="justify-start"
              onClick={() => onPick(id)}
            >
              <span className="truncate">{label}</span>
            </Button>
          );
        })}
      </div>
    </div>
  );
}
