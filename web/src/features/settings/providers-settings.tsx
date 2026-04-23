import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  Copy,
  ExternalLink,
  Eye,
  EyeOff,
  Info,
  KeyRound,
  Loader2,
  LogIn,
  LogOut,
  Search,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import useSWR from 'swr';

import { Button } from '@/components/ui/button';
import {
  cancelOAuth,
  cleanupOAuthSession,
  fetchOAuthSessionStatus,
  revokeOAuth,
  startAsyncOAuthLogin,
  submitOAuthCode,
} from '@/features/settings/oauth-api';
import { fetchConfiguredModelsCached, type ConfiguredModel } from '@/features/chat/registry-api';
import { useGatewayConfigSwr } from '@/features/gateway/gateway-config-swr';
import {
  isMaskedKey,
  mergeProviderRows,
  patchProviderApiKeys,
  providersKeysFromConfigRoot,
  testProviderKeyResolution,
  type ProviderActiveKeySource,
  type ProviderCategory,
  type ProviderMeta,
  type ProviderRowModel,
} from '@/features/settings/providers-api';
import {
  getOrderedApiKeyLinks,
  PROVIDER_ENRICHMENT,
  providerApiKeyLinkLabel,
} from '@/features/settings/provider-enrichment';
import { ProviderInfoPopover } from '@/features/settings/provider-info-popover';
import { fetchJson } from '@/lib/fetch';
import { apiUrl } from '@/lib/url';
import { settingsInputFocusClass } from '@/lib/form-field-width';
import { cn } from '@/lib/cn';
import { interaction } from '@/lib/interaction';
import type { StoredLanguage } from '@/lib/storage';
import { messages, type ProvidersSettingsMessages } from '@/i18n/messages';
import { docsGuidePageUrl } from '@/navigation';
import { useGatewayStore } from '@/stores/gateway-store';
import { useLocaleStore } from '@/stores/locale-store';

const CATEGORY_ORDER: ProviderCategory[] = ['common', 'specialty', 'enterprise', 'oauth', 'extension'];

function groupByCategory(rows: ProviderRowModel[]): Map<ProviderCategory, ProviderRowModel[]> {
  const map = new Map<ProviderCategory, ProviderRowModel[]>();
  for (const c of CATEGORY_ORDER) map.set(c, []);
  for (const r of rows) {
    const cat = r.category || 'specialty';
    const list = map.get(cat) ?? [];
    list.push(r);
    map.set(cat, list);
  }
  return map;
}

function interpolate(template: string, params: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => String(params[key] ?? ''));
}

function activeSourceLabel(labels: ProvidersSettingsMessages, src: ProviderActiveKeySource | undefined): string {
  switch (src) {
    case 'agent':
      return labels.sourceAgent;
    case 'gateway':
      return labels.sourceGateway;
    case 'oauth':
      return labels.sourceOauth;
    case 'env':
      return labels.sourceEnv;
    case 'models_json':
      return labels.sourceModelsJson;
    case 'extension':
      return labels.sourceExtension;
    default:
      return labels.sourceNone;
  }
}

export function ProvidersSettingsPanel() {
  const language = useLocaleStore((s) => s.language);
  const m = messages(language);
  const p = m.providersSettings;
  const token = useGatewayStore((st) => st.token);
  const hasToken = Boolean(token);

  const [draft, setDraft] = useState<Record<string, string>>({});
  const [baseline, setBaseline] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saveNotice, setSaveNotice] = useState<null | 'saved' | 'noChanges'>(null);
  const [expandedCats, setExpandedCats] = useState<Set<string>>(() => new Set(['common']));
  const [searchQuery, setSearchQuery] = useState('');
  const [unconfiguredOnly, setUnconfiguredOnly] = useState(false);
  const [savedProviderIds, setSavedProviderIds] = useState<Set<string>>(() => new Set());
  const prevSearchRef = useRef('');

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
    hasToken ? 'gateway-configured-models' : null,
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
    if (!dirty) {
      const d: Record<string, string> = {};
      for (const r of mergedRows) d[r.id] = r.apiKey;
      setDraft(d);
      setBaseline({ ...d });
    }
  }, [hasToken, mergedRows, dirty]);

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

  useEffect(() => {
    const prev = prevSearchRef.current;
    prevSearchRef.current = searchQuery;
    if (searchQuery.trim()) {
      const next = new Set<string>();
      for (const c of CATEGORY_ORDER) {
        if ((groups.get(c) ?? []).length > 0) next.add(c);
      }
      setExpandedCats(next);
      return;
    }
    if (prev.trim()) {
      setExpandedCats(new Set(['common']));
    }
  }, [searchQuery, groups]);

  const save = useCallback(async () => {
    if (saving) return;
    const toPatch: Record<string, string> = {};
    for (const id of Object.keys(draft)) {
      const v = draft[id]?.trim() ?? '';
      if (!v || isMaskedKey(v)) continue;
      toPatch[id] = v;
    }
    if (Object.keys(toPatch).length === 0) {
      setBaseline({ ...draft });
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
        const d: Record<string, string> = {};
        for (const r of rows) d[r.id] = r.apiKey;
        setDraft(d);
        setBaseline({ ...d });
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
    setDraft({ ...baseline });
    setError(null);
    setSaveNotice(null);
    setSavedProviderIds(new Set());
  }, [baseline]);

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

  if (!hasToken) {
    return (
      <div className="mx-auto flex w-full max-w-app-main flex-col gap-3 px-4 py-10">
        <div className="flex items-start gap-3 rounded-2xl bg-surface-base p-6">
          <KeyRound className="mt-0.5 size-5 shrink-0 text-fg-subtle" strokeWidth={1.75} />
          <div>
            <h1 className="text-base font-semibold text-fg">{m.settingsSections.providers}</h1>
            <p className="mt-1 text-sm text-fg-muted">{p.needToken}</p>
          </div>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="mx-auto w-full max-w-app-main px-4 py-8">
        <div className="h-8 w-48 animate-pulse rounded bg-surface-hover" />
        <div className="mt-6 h-32 animate-pulse rounded-xl bg-surface-hover" />
        <p className="mt-4 text-sm text-fg-muted">{m.logs.loading}</p>
      </div>
    );
  }

  if (metaRows.length === 0) {
    return (
      <div className="mx-auto flex w-full max-w-app-main flex-col gap-3 px-4 py-10">
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
    <div className="mx-auto flex w-full max-w-app-main flex-col gap-6 px-4 py-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-lg font-semibold tracking-tight text-fg">{m.settingsSections.providers}</h1>
          <p className="mt-1 text-sm text-fg-muted">{p.subtitle}</p>
          <p className="mt-2 text-xs text-fg-subtle">{p.rotateHint}</p>
        </div>
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
      </header>

      {dirty ? <p className="text-xs text-amber-800 dark:text-amber-200">{p.unsavedHint}</p> : null}

      <p className="text-sm leading-relaxed text-fg-muted">
        {p.intro}{' '}
        <a
          href={docsGuidePageUrl(language, 'models')}
          target="_blank"
          rel="noopener noreferrer"
          className="font-medium text-accent-fg hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          {p.docsLink}
        </a>
        {' · '}
        <Link
          to="/settings/models"
          className="font-medium text-accent-fg hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          {p.modelsLink}
        </Link>
      </p>

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
            const expanded = expandedCats.has(cat);
            const configuredCount = list.filter((r) => r.configured).length;
            const panelId = `providers-cat-${cat}`;
            return (
              <section key={cat} className="overflow-hidden rounded-2xl bg-surface-base">
                <button
                  type="button"
                  id={`${panelId}-trigger`}
                  aria-expanded={expanded}
                  aria-controls={panelId}
                  className="flex w-full items-center justify-between gap-2 border-b border-edge-subtle px-4 py-3 text-left transition-colors hover:bg-surface-hover/60 dark:border-edge-subtle"
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
                    {list.map((row) => (
                      <div id={`provider-row-${row.id}`} key={row.id}>
                        <ProviderCredentialRow
                          row={row}
                          value={draft[row.id] ?? ''}
                          rowDirty={(draft[row.id] ?? '') !== (baseline[row.id] ?? '')}
                          labels={p}
                          language={language}
                          onChange={(id, v) => setDraft((d) => ({ ...d, [id]: v }))}
                          onReload={refreshProviders}
                          justSaved={savedProviderIds.has(row.id)}
                          availableModels={models ?? []}
                        />
                      </div>
                    ))}
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

function EnvVarCopyRow({
  envVar,
  labels,
}: {
  envVar: string;
  labels: ProvidersSettingsMessages;
}) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(envVar);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      /* ignore clipboard errors */
    }
  };

  return (
    <div className="flex items-center gap-2">
      <code className="rounded bg-surface-hover px-1.5 py-0.5 font-mono text-[11px] text-fg-muted">{envVar}</code>
      <button
        type="button"
        onClick={() => void handleCopy()}
        className="rounded p-0.5 text-fg-subtle hover:bg-surface-hover hover:text-fg"
        title={copied ? labels.copied : labels.copy}
        aria-label={copied ? labels.copied : labels.copy}
      >
        {copied ? (
          <CheckCircle2 className="size-3.5 text-emerald-600 dark:text-emerald-400" aria-hidden />
        ) : (
          <Copy className="size-3.5" aria-hidden />
        )}
      </button>
    </div>
  );
}

function ProviderCredentialRow({
  row,
  value,
  rowDirty,
  labels,
  language,
  onChange,
  onReload,
  justSaved,
  availableModels,
}: {
  row: ProviderRowModel;
  value: string;
  rowDirty: boolean;
  labels: ProvidersSettingsMessages;
  language: StoredLanguage;
  onChange: (id: string, v: string) => void;
  onReload: () => void;
  justSaved: boolean;
  availableModels: ConfiguredModel[];
}) {
  const [expanded, setExpanded] = useState(false);
  const [showKey, setShowKey] = useState(false);
  const [copied, setCopied] = useState(false);
  const [revokeError, setRevokeError] = useState<string | null>(null);
  const masked = isMaskedKey(value);
  const inputValue = masked && !showKey ? '' : value;
  const isOAuthConfigured = row.configured && !masked && Boolean(value);

  const [oauthLoading, setOauthLoading] = useState(false);
  const [sessionId, setSessionId] = useState<string | undefined>();
  const [oauthStatus, setOauthStatus] = useState<
    'idle' | 'waiting' | 'waiting_code' | 'success' | 'error' | undefined
  >();
  const [oauthMessage, setOauthMessage] = useState<string | undefined>();
  const [authUrl, setAuthUrl] = useState<string | undefined>();
  const [instructions, setInstructions] = useState<string | undefined>();
  const [codeInput, setCodeInput] = useState('');

  const [testLoading, setTestLoading] = useState(false);
  const [testMessage, setTestMessage] = useState<string | null>(null);
  const [testOk, setTestOk] = useState<boolean | null>(null);

  const activeSrc = row.activeKeySource ?? 'none';

  const apiKeyLinks = useMemo(() => getOrderedApiKeyLinks(row.id, language), [row.id, language]);

  useEffect(() => {
    return () => {
      if (sessionId) {
        void cleanupOAuthSession(sessionId).catch(() => {});
      }
    };
  }, [sessionId]);

  useEffect(() => {
    if (!sessionId || !oauthLoading) return;
    const id = window.setInterval(() => {
      void (async () => {
        try {
          const st = await fetchOAuthSessionStatus(sessionId);
          setOauthMessage(st.message);
          setAuthUrl(st.authUrl);
          setInstructions(st.instructions);
          if (st.status === 'waiting_auth' || st.status === 'waiting_code') {
            setOauthStatus(st.status === 'waiting_code' ? 'waiting_code' : 'waiting');
          } else if (st.status === 'completed') {
            window.clearInterval(id);
            setOauthLoading(false);
            setOauthStatus('success');
            setOauthMessage(st.message);
            window.setTimeout(() => onReload(), 800);
          } else if (st.status === 'failed' || st.status === 'cancelled') {
            window.clearInterval(id);
            setOauthLoading(false);
            setOauthStatus('error');
            setOauthMessage(st.error || st.message || 'OAuth failed');
          }
        } catch {
          /* ignore poll errors */
        }
      })();
    }, 1000);
    return () => window.clearInterval(id);
  }, [sessionId, oauthLoading, onReload]);

  const startOAuth = async () => {
    setOauthLoading(true);
    setOauthStatus('waiting');
    setOauthMessage(labels.oauthStarting);
    setSessionId(undefined);
    setAuthUrl(undefined);
    setInstructions(undefined);
    try {
      const res = await startAsyncOAuthLogin(row.id);
      setSessionId(res.sessionId);
    } catch (e) {
      setOauthStatus('error');
      setOauthMessage(e instanceof Error ? e.message : 'OAuth failed');
      setOauthLoading(false);
    }
  };

  const cancelFlow = async () => {
    if (!sessionId) return;
    try {
      await cancelOAuth(sessionId);
    } catch {
      /* ignore */
    }
    setSessionId(undefined);
    setOauthLoading(false);
    setOauthStatus('idle');
    setOauthMessage(undefined);
  };

  const submitCode = async () => {
    if (!sessionId || !codeInput.trim()) return;
    try {
      await submitOAuthCode(sessionId, codeInput.trim());
      setCodeInput('');
      setOauthMessage(labels.oauthProcessingCode);
    } catch (e) {
      setOauthStatus('error');
      setOauthMessage(e instanceof Error ? e.message : 'Failed');
    }
  };

  const doRevoke = () => {
    if (!window.confirm(interpolate(labels.revokeConfirm, { name: row.name }))) return;
    setRevokeError(null);
    void revokeOAuth(row.id)
      .then(() => onReload())
      .catch((e) => setRevokeError(e instanceof Error ? e.message : labels.revokeFailed));
  };

  const copyKey = async () => {
    if (!value || masked) return;
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      /* ignore */
    }
  };

  const runTest = async () => {
    const v = value.trim();
    if (!v || isMaskedKey(v)) return;
    setTestLoading(true);
    setTestMessage(null);
    setTestOk(null);
    try {
      const res = await testProviderKeyResolution(v);
      if (res.error) {
        setTestOk(false);
        setTestMessage(`${labels.testFailed} ${res.error}`);
        return;
      }
      setTestOk(true);
      if (res.type === 'env') setTestMessage(labels.testOkEnv);
      else if (res.type === 'command') setTestMessage(labels.testOkCommand);
      else setTestMessage(labels.testOkLiteral);
    } catch (e) {
      setTestOk(false);
      setTestMessage(e instanceof Error ? e.message : labels.testFailed);
    } finally {
      setTestLoading(false);
    }
  };

  const secondaryLine = rowDirty
    ? labels.metaWillSave
    : row.configured
      ? masked
        ? `${labels.metaMasked} · ${labels.runtimeLabelPrefix} ${activeSourceLabel(labels, activeSrc)}`
        : `${labels.runtimeLabelPrefix} ${activeSourceLabel(labels, activeSrc)}`
      : labels.metaNotConfigured;

  const detailsId = `provider-details-${row.id}`;

  return (
    <div className="bg-surface-panel">
      <div className="flex items-center gap-3 px-3 py-3 sm:px-4">
        <div
          className="flex size-8 shrink-0 items-center justify-center rounded-md bg-surface-hover/80 dark:bg-surface-hover/50"
          aria-hidden
        >
          {row.configured ? (
            <CheckCircle2 className="size-4 text-emerald-600 dark:text-emerald-400" />
          ) : (
            <KeyRound className="size-4 text-fg-subtle" strokeWidth={1.75} />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold text-fg">{row.name}</span>
            <ProviderInfoPopover providerId={row.id} language={language} />
            <span className="rounded bg-surface-hover px-1.5 py-0.5 font-mono text-[10px] font-medium uppercase tracking-wide text-fg-subtle">
              {row.id}
            </span>
            <span className="rounded bg-surface-hover px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-fg-subtle">
              {row.category}
            </span>
          </div>
          <p className="mt-0.5 text-xs text-fg-muted">{secondaryLine}</p>
        </div>
        <Button
          type="button"
          variant="ghost"
          className="h-9 w-9 shrink-0 p-0"
          aria-expanded={expanded}
          aria-controls={detailsId}
          aria-label={labels.expandRowDetails}
          onClick={() => setExpanded((e) => !e)}
        >
          <ChevronDown className={cn('size-4 transition-transform', expanded && 'rotate-180')} aria-hidden />
        </Button>
      </div>

      {expanded ? (
        <div
          id={detailsId}
          role="region"
          className="space-y-3 border-t border-edge-subtle bg-surface-base/40 px-3 py-3 dark:bg-surface-base/20 sm:px-4"
        >
          {row.supportsApiKey !== false ? (
            <div className="flex flex-col gap-2">
              <div className="relative flex flex-col gap-2 sm:flex-row sm:gap-2">
                <div className="relative min-w-0 flex-1">
                  <input
                    type={showKey || !masked ? 'text' : 'password'}
                    className={cn(
                      'w-full rounded-lg border border-edge bg-surface-panel py-2 pl-3 pr-20 font-mono text-sm text-fg',
                      'placeholder:text-fg-subtle',
                      settingsInputFocusClass,
                      'dark:border-edge',
                    )}
                    value={inputValue}
                    placeholder={
                      masked ? labels.placeholderOverride : row.configured ? labels.placeholderKeep : labels.placeholderKey
                    }
                    disabled={oauthLoading}
                    onChange={(e) => onChange(row.id, e.target.value)}
                    autoComplete="off"
                    spellCheck={false}
                  />
                  <div className="absolute right-1 top-1/2 flex -translate-y-1/2 gap-0.5">
                    {value && !masked ? (
                      <button
                        type="button"
                        className={cn(
                          'rounded p-1.5 text-fg-subtle hover:bg-surface-hover hover:text-fg',
                          interaction.transition,
                          interaction.press,
                          interaction.focusRingPanel,
                        )}
                        title={copied ? labels.copied : labels.copy}
                        aria-label={copied ? labels.copied : labels.copy}
                        onClick={() => void copyKey()}
                      >
                        {copied ? <CheckCircle2 className="size-4" /> : <Copy className="size-4" />}
                      </button>
                    ) : null}
                    <button
                      type="button"
                      className={cn(
                        'rounded p-1.5 text-fg-subtle hover:bg-surface-hover hover:text-fg disabled:opacity-40',
                        interaction.transition,
                        interaction.press,
                        interaction.focusRingPanel,
                      )}
                      title={showKey ? labels.hide : labels.show}
                      aria-label={showKey ? labels.hide : labels.show}
                      disabled={masked}
                      onClick={() => setShowKey((s) => !s)}
                    >
                      {showKey ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                    </button>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2 sm:shrink-0">
                  <Button
                    type="button"
                    variant="secondary"
                    className="gap-1"
                    disabled={oauthLoading || testLoading || !value.trim() || isMaskedKey(value)}
                    onClick={() => void runTest()}
                  >
                    {testLoading ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
                    {testLoading ? labels.testingKey : labels.testKey}
                  </Button>
                  {row.supportsOAuth ? (
                    isOAuthConfigured ? (
                      <Button
                        type="button"
                        variant="secondary"
                        className="gap-1 text-red-600 dark:text-red-400"
                        onClick={doRevoke}
                      >
                        <LogOut className="size-4" aria-hidden />
                        {labels.revoke}
                      </Button>
                    ) : (
                      <Button
                        type="button"
                        variant="secondary"
                        className="gap-1"
                        disabled={oauthLoading}
                        onClick={() => void startOAuth()}
                      >
                        {oauthLoading ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <LogIn className="size-4" aria-hidden />}
                        {labels.oauth}
                      </Button>
                    )
                  ) : null}
                </div>
              </div>
              {testMessage ? (
                <p
                  className={cn(
                    'text-xs',
                    testOk === false ? 'text-red-600 dark:text-red-400' : 'text-fg-muted',
                  )}
                  role="status"
                >
                  {testMessage}
                </p>
              ) : null}
              {apiKeyLinks.length > 0 ? (
                <div className="flex flex-col gap-1">
                  {apiKeyLinks.map((link) => (
                    <a
                      key={`${link.kind}-${link.href}`}
                      href={link.href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex w-fit items-center gap-1 text-xs font-medium text-accent-fg hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                    >
                      {providerApiKeyLinkLabel(link.kind, labels)}
                      <ExternalLink className="size-3" aria-hidden />
                    </a>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}

          {oauthMessage ? (
            <div
              className={cn(
                'flex gap-2 rounded-md px-3 py-2 text-xs',
                oauthStatus === 'error'
                  ? 'border border-red-200 bg-red-50 text-red-700 dark:border-red-900/50 dark:bg-red-950/50 dark:text-red-400'
                  : 'bg-surface-base text-fg-muted',
              )}
            >
              {oauthStatus === 'error' ? (
                <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
              ) : oauthStatus === 'success' ? (
                <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-600" aria-hidden />
              ) : (
                <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
              )}
              <span>{oauthMessage}</span>
            </div>
          ) : null}

          {revokeError ? (
            <div
              className="flex gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900/50 dark:bg-red-950/50 dark:text-red-400"
              role="alert"
            >
              <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
              <span>{revokeError}</span>
            </div>
          ) : null}

          {(oauthStatus === 'waiting' || oauthStatus === 'waiting_code') && (
            <div className="flex flex-wrap gap-2">
              {authUrl ? (
                <a
                  href={authUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 rounded-md bg-accent px-3 py-2 text-sm font-medium text-white hover:bg-accent-hover"
                >
                  <ExternalLink className="size-4" aria-hidden />
                  {labels.openAuthPage}
                </a>
              ) : null}
              <Button type="button" variant="secondary" className="gap-1" onClick={() => void cancelFlow()}>
                <X className="size-4" aria-hidden />
                {labels.cancelOAuth}
              </Button>
            </div>
          )}

          {instructions ? (
            <div className="flex gap-2 rounded-md bg-surface-hover/60 px-3 py-2 text-xs text-fg-muted dark:bg-surface-hover/40">
              <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
              <span>{instructions}</span>
            </div>
          ) : null}

          {oauthStatus === 'waiting_code' ? (
            <div className="flex flex-col gap-2 sm:flex-row">
              <input
                type="text"
                className={cn(
                  'min-w-0 flex-1 rounded-lg border border-edge bg-surface-panel px-3 py-2 text-sm text-fg',
                  settingsInputFocusClass,
                  'dark:border-edge',
                )}
                value={codeInput}
                placeholder={labels.pasteRedirectUrl}
                onChange={(e) => setCodeInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && void submitCode()}
              />
              <Button type="button" variant="primary" className="shrink-0" onClick={() => void submitCode()}>
                {labels.submitCode}
              </Button>
            </div>
          ) : null}

          {masked ? (
            <div className="flex gap-2 rounded-md bg-surface-hover/60 px-3 py-2 text-xs text-fg-muted dark:bg-surface-hover/40">
              <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
              <span>{activeSrc === 'env' ? labels.envHint : labels.maskedStoredHint}</span>
            </div>
          ) : null}

          {row.supportsOAuth && !masked && !isOAuthConfigured ? (
            <p className="text-xs text-fg-subtle">{labels.oauthHint}</p>
          ) : null}

          {justSaved ? (
            <div className="flex items-start gap-2 rounded-md bg-surface-hover/60 px-3 py-2 text-xs text-fg-muted dark:bg-surface-hover/40">
              <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden />
              <span>
                {(() => {
                  const providerModels = availableModels.filter((m) => m.provider === row.id);
                  if (providerModels.length === 0) return labels.savedNoModels;
                  const preview = providerModels
                    .slice(0, 3)
                    .map((m) => m.name || m.id)
                    .join(', ');
                  const suffix = providerModels.length > 3 ? `… (+${providerModels.length - 3})` : '';
                  return `${providerModels.length} ${labels.savedModelsAvailable}: ${preview}${suffix}`;
                })()}
              </span>
            </div>
          ) : null}

          {(PROVIDER_ENRICHMENT[row.id]?.envVars ?? []).length > 0 ? (
            <details>
              <summary className="cursor-pointer select-none list-none text-xs text-fg-subtle hover:text-fg-muted">
                {labels.envVarAlt}
              </summary>
              <div className="mt-1.5 flex flex-col gap-1">
                {(PROVIDER_ENRICHMENT[row.id]?.envVars ?? []).map((envVar) => (
                  <EnvVarCopyRow key={envVar} envVar={envVar} labels={labels} />
                ))}
              </div>
            </details>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
