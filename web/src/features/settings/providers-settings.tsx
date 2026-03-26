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
  X,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import {
  cancelOAuth,
  cleanupOAuthSession,
  fetchOAuthSessionStatus,
  revokeOAuth,
  startAsyncOAuthLogin,
  submitOAuthCode,
} from '@/features/settings/oauth-api';
import {
  isMaskedKey,
  loadProviderRows,
  patchProviderApiKeys,
  type ProviderCategory,
  type ProviderRowModel,
} from '@/features/settings/providers-api';
import { cn } from '@/lib/cn';
import { interaction } from '@/lib/interaction';
import { messages, type ProvidersSettingsMessages } from '@/i18n/messages';
import { useGatewayStore } from '@/stores/gateway-store';
import { useLocaleStore } from '@/stores/locale-store';

const CATEGORY_ORDER: ProviderCategory[] = ['common', 'specialty', 'enterprise', 'oauth'];
const DOCS_URL = 'https://github.com/xopc/xopcbot/blob/main/docs/models.md';

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

export function ProvidersSettingsPanel() {
  const language = useLocaleStore((s) => s.language);
  const m = messages(language);
  const p = m.providersSettings;
  const token = useGatewayStore((st) => st.token);
  const hasToken = Boolean(token);

  const [metaRows, setMetaRows] = useState<ProviderRowModel[]>([]);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [baseline, setBaseline] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saveOk, setSaveOk] = useState(false);
  const [expandedCats, setExpandedCats] = useState<Set<string>>(() => new Set());

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const rows = await loadProviderRows();
      setMetaRows(rows);
      const d: Record<string, string> = {};
      for (const r of rows) d[r.id] = r.apiKey;
      setDraft(d);
      setBaseline({ ...d });
    } catch (e) {
      setError(e instanceof Error ? e.message : p.loadError);
      setMetaRows([]);
      setDraft({});
      setBaseline({});
    } finally {
      setLoading(false);
    }
  }, [p.loadError]);

  useEffect(() => {
    if (!hasToken) {
      setLoading(false);
      return;
    }
    void load();
  }, [hasToken, load]);

  const dirty = useMemo(
    () => JSON.stringify(draft) !== JSON.stringify(baseline),
    [draft, baseline],
  );

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
      setSaveOk(true);
      window.setTimeout(() => setSaveOk(false), 2500);
      return;
    }
    setSaving(true);
    setError(null);
    setSaveOk(false);
    try {
      await patchProviderApiKeys(toPatch);
      await load();
      setSaveOk(true);
      window.setTimeout(() => setSaveOk(false), 2500);
    } catch (e) {
      setError(e instanceof Error ? e.message : p.saveError);
    } finally {
      setSaving(false);
    }
  }, [draft, saving, load, p.saveError]);

  const toggleCat = (cat: string) => {
    setExpandedCats((prev) => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat);
      else next.add(cat);
      return next;
    });
  };

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
        <p className="text-sm text-fg-muted">{error ?? p.empty}</p>
        <Button type="button" variant="secondary" onClick={() => void load()}>
          {m.logs.refresh}
        </Button>
      </div>
    );
  }

  const groups = groupByCategory(metaRows);

  return (
    <div className="mx-auto flex w-full max-w-app-main flex-col gap-6 px-4 py-6">
      <header className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-lg font-semibold tracking-tight text-fg">{m.settingsSections.providers}</h1>
          <p className="mt-1 text-sm text-fg-muted">{p.subtitle}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {saveOk ? <span className="text-sm text-fg-muted">{p.saved}</span> : null}
          <Button type="button" variant="primary" disabled={!dirty || saving} onClick={() => void save()}>
            {saving ? p.saving : p.save}
          </Button>
        </div>
      </header>

      <p className="text-sm leading-relaxed text-fg-muted">
        {p.intro}{' '}
        <a
          href={DOCS_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="font-medium text-accent-fg hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          {p.docsLink}
        </a>
      </p>

      {error ? (
        <div
          className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/50 dark:text-red-400"
          role="alert"
        >
          {error}
        </div>
      ) : null}

      <div className="flex flex-col gap-3">
        {CATEGORY_ORDER.map((cat) => {
          const list = groups.get(cat) ?? [];
          if (list.length === 0) return null;
          const expanded = expandedCats.has(cat);
          const configuredCount = list.filter((r) => r.configured).length;
          return (
            <section
              key={cat}
              className="overflow-hidden rounded-2xl bg-surface-base"
            >
              <button
                type="button"
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
                <div className="divide-y divide-edge-subtle">
                  {list.map((row) => (
                    <ProviderCredentialRow
                      key={row.id}
                      row={row}
                      value={draft[row.id] ?? ''}
                      labels={p}
                      onChange={(id, v) => setDraft((d) => ({ ...d, [id]: v }))}
                      onReload={() => void load()}
                    />
                  ))}
                </div>
              ) : null}
            </section>
          );
        })}
      </div>
    </div>
  );
}

function interpolate(template: string, params: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => String(params[key] ?? ''));
}

function ProviderCredentialRow({
  row,
  value,
  labels,
  onChange,
  onReload,
}: {
  row: ProviderRowModel;
  value: string;
  labels: ProvidersSettingsMessages;
  onChange: (id: string, v: string) => void;
  onReload: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [showKey, setShowKey] = useState(false);
  const [copied, setCopied] = useState(false);
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
  const lastOpenedAuthUrl = useRef<string | undefined>(undefined);

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
            if (st.authUrl && st.authUrl !== lastOpenedAuthUrl.current) {
              lastOpenedAuthUrl.current = st.authUrl;
              window.open(st.authUrl, '_blank', 'noopener,noreferrer');
            }
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
    lastOpenedAuthUrl.current = undefined;
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
    void revokeOAuth(row.id)
      .then(() => onReload())
      .catch((e) => alert(e instanceof Error ? e.message : 'Revoke failed'));
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
            <span className="rounded bg-surface-hover px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-fg-subtle">
              {row.category}
            </span>
          </div>
          <p className="mt-0.5 text-xs text-fg-muted">
            {row.configured
              ? masked
                ? labels.metaMasked
                : labels.metaWillSave
              : labels.metaNotConfigured}
          </p>
        </div>
        <Button
          type="button"
          variant="ghost"
          className="h-9 w-9 shrink-0 p-0"
          aria-expanded={expanded}
          onClick={() => setExpanded((e) => !e)}
        >
          <ChevronDown className={cn('size-4 transition-transform', expanded && 'rotate-180')} />
        </Button>
      </div>

      {expanded ? (
        <div className="space-y-3 border-t border-edge-subtle bg-surface-base/40 px-3 py-3 dark:bg-surface-base/20 sm:px-4">
          {row.supportsApiKey !== false ? (
            <div className="relative flex gap-2">
              <div className="relative min-w-0 flex-1">
                <input
                  type={showKey || !masked ? 'text' : 'password'}
                  className={cn(
                    'w-full rounded-lg border border-edge bg-surface-panel py-2 pl-3 pr-20 font-mono text-sm text-fg',
                    'placeholder:text-fg-subtle focus:border-edge-strong focus:outline-none focus:ring-2 focus:ring-accent/30',
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
              {row.supportsOAuth ? (
                isOAuthConfigured ? (
                  <Button type="button" variant="secondary" className="shrink-0 gap-1 text-red-600 dark:text-red-400" onClick={doRevoke}>
                    <LogOut className="size-4" />
                    {labels.revoke}
                  </Button>
                ) : (
                  <Button type="button" variant="secondary" className="shrink-0 gap-1" disabled={oauthLoading} onClick={() => void startOAuth()}>
                    {oauthLoading ? <Loader2 className="size-4 animate-spin" /> : <LogIn className="size-4" />}
                    {labels.oauth}
                  </Button>
                )
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
                <AlertCircle className="mt-0.5 size-4 shrink-0" />
              ) : oauthStatus === 'success' ? (
                <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-600" />
              ) : (
                <Info className="mt-0.5 size-4 shrink-0" />
              )}
              <span>{oauthMessage}</span>
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
                  <ExternalLink className="size-4" />
                  {labels.openAuthPage}
                </a>
              ) : null}
              <Button type="button" variant="secondary" className="gap-1" onClick={() => void cancelFlow()}>
                <X className="size-4" />
                {labels.cancelOAuth}
              </Button>
            </div>
          )}

          {instructions ? (
            <div className="flex gap-2 rounded-md bg-surface-hover/60 px-3 py-2 text-xs text-fg-muted dark:bg-surface-hover/40">
              <Info className="mt-0.5 size-4 shrink-0" />
              <span>{instructions}</span>
            </div>
          ) : null}

          {oauthStatus === 'waiting_code' ? (
            <div className="flex flex-col gap-2 sm:flex-row">
              <input
                type="text"
                className={cn(
                  'min-w-0 flex-1 rounded-lg border border-edge bg-surface-panel px-3 py-2 text-sm text-fg',
                  'focus:border-edge-strong focus:outline-none focus:ring-2 focus:ring-accent/30 dark:border-edge',
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
              <Info className="mt-0.5 size-4 shrink-0" />
              <span>{labels.envHint}</span>
            </div>
          ) : null}

          {row.supportsOAuth && !masked && !isOAuthConfigured ? (
            <p className="text-xs text-fg-subtle">{labels.oauthHint}</p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
