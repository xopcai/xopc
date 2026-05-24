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
  Trash2,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import type { ConfiguredModel } from '@/features/chat/registry-api';
import {
  cancelOAuth,
  cleanupOAuthSession,
  fetchOAuthSessionStatus,
  revokeOAuth,
  startAsyncOAuthLogin,
  submitOAuthCode,
} from '@/features/settings/oauth-api';
import {
  deleteProviderApiKey,
  isMaskedKey,
  testProviderKeyResolution,
  type ProviderRowModel,
} from '@/features/settings/providers-api';
import {
  getOrderedApiKeyLinks,
  PROVIDER_ENRICHMENT,
  providerApiKeyLinkLabel,
} from '@/features/settings/provider-enrichment';
import { ProviderInfoPopover } from '@/features/settings/provider-info-popover';
import { activeSourceLabel, interpolate } from './providers-settings-lib';
import { settingsInputFocusClass } from '@/lib/form-field-width';
import { cn } from '@/lib/cn';
import { interaction } from '@/lib/interaction';
import type { StoredLanguage } from '@/lib/storage';
import type { ProvidersSettingsMessages } from '@/i18n/messages';

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
        className={cn(
          'rounded p-0.5 text-fg-subtle hover:bg-surface-hover hover:text-fg',
          interaction.press,
        )}
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

export function ProviderCredentialRow({
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
  const [removeLoading, setRemoveLoading] = useState(false);
  const [removeMessage, setRemoveMessage] = useState<string | null>(null);
  const [removeConfirmOpen, setRemoveConfirmOpen] = useState(false);
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

  const doRemoveKey = async () => {
    setRemoveConfirmOpen(false);
    setRemoveLoading(true);
    setRemoveMessage(null);
    try {
      await deleteProviderApiKey(row.id);
      setRemoveMessage(labels.removeKeySuccess);
      onChange(row.id, '');
      window.setTimeout(() => onReload(), 600);
    } catch (error) {
      setRemoveMessage(error instanceof Error ? error.message : labels.removeKeyFailed);
    } finally {
      setRemoveLoading(false);
    }
  };

  const canRemoveKey =
    row.configured && masked && activeSrc !== 'env' && activeSrc !== 'extension' && activeSrc !== 'models_json';

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
      <div className="flex items-center gap-3 p-3 sm:px-4">
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
          className="size-9 shrink-0 p-0"
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
          className="space-y-3 border-t border-edge-subtle bg-surface-base/40 p-3 dark:bg-surface-base/20 sm:px-4"
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
                  {canRemoveKey ? (
                    <>
                      <Button
                        type="button"
                        variant="secondary"
                        className="gap-1 text-red-600 dark:text-red-400"
                        disabled={removeLoading}
                        onClick={() => setRemoveConfirmOpen(true)}
                      >
                        {removeLoading ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Trash2 className="size-4" aria-hidden />}
                        {labels.removeKey}
                      </Button>
                      <ConfirmDialog
                        open={removeConfirmOpen}
                        title={labels.removeKey}
                        description={interpolate(labels.removeKeyConfirm, { name: row.name })}
                        confirmLabel={labels.removeKey}
                        cancelLabel={labels.cancelOAuth}
                        destructive
                        onConfirm={() => void doRemoveKey()}
                        onCancel={() => setRemoveConfirmOpen(false)}
                      />
                    </>
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

          {removeMessage ? (
            <div
              className={cn(
                'flex gap-2 rounded-md px-3 py-2 text-xs',
                removeMessage === labels.removeKeySuccess
                  ? 'bg-surface-hover/60 text-fg-muted dark:bg-surface-hover/40'
                  : 'border border-red-200 bg-red-50 text-red-700 dark:border-red-900/50 dark:bg-red-950/50 dark:text-red-400',
              )}
              role="status"
            >
              {removeMessage === labels.removeKeySuccess ? (
                <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden />
              ) : (
                <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
              )}
              <span>{removeMessage}</span>
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
