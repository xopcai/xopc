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
import { useCallback, useEffect, useEffectEvent, useMemo, useReducer, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import type { ConfiguredModel } from '@/features/chat/api/registry-api';
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
import { copyTextToClipboard } from '@/lib/copy-to-clipboard';
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
    const ok = await copyTextToClipboard(envVar);
    if (!ok) return;
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
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

/**
 * Accessible collapsible section replacing the native `<details>` element.
 * Uses controlled state + CSS transitions so keyboard focus, screen readers,
 * and animation all work consistently within the Radix-oriented component set.
 */
type OAuthState = {
  loading: boolean;
  sessionId?: string;
  status?: 'idle' | 'waiting' | 'waiting_code' | 'success' | 'error';
  message?: string;
  authUrl?: string;
  instructions?: string;
  codeInput: string;
};

type OAuthAction =
  | { type: 'start'; message: string }
  | { type: 'session'; sessionId: string }
  | { type: 'poll'; message?: string; authUrl?: string; instructions?: string; status: 'waiting' | 'waiting_code' }
  | { type: 'complete'; message?: string }
  | { type: 'fail'; message: string }
  | { type: 'cancel' }
  | { type: 'setCode'; value: string }
  | { type: 'clearCode' };

const initialOAuthState: OAuthState = { loading: false, codeInput: '' };

function oauthReducer(state: OAuthState, action: OAuthAction): OAuthState {
  switch (action.type) {
    case 'start':
      return {
        loading: true,
        status: 'waiting',
        message: action.message,
        codeInput: '',
        sessionId: undefined,
        authUrl: undefined,
        instructions: undefined,
      };
    case 'session':
      return { ...state, sessionId: action.sessionId };
    case 'poll':
      return {
        ...state,
        message: action.message ?? state.message,
        authUrl: action.authUrl,
        instructions: action.instructions,
        status: action.status,
      };
    case 'complete':
      return {
        ...state,
        loading: false,
        status: 'success',
        message: action.message ?? state.message,
      };
    case 'fail':
      return { ...state, loading: false, status: 'error', message: action.message };
    case 'cancel':
      return initialOAuthState;
    case 'setCode':
      return { ...state, codeInput: action.value };
    case 'clearCode':
      return { ...state, codeInput: '' };
  }
}

type RowUiState = {
  showKey: boolean;
  copied: boolean;
  revokeError: string | null;
  removeLoading: boolean;
  removeMessage: string | null;
  removeConfirmOpen: boolean;
  testLoading: boolean;
  testMessage: string | null;
  testOk: boolean | null;
};

type RowUiAction =
  | { type: 'toggleShowKey' }
  | { type: 'copied' }
  | { type: 'clearCopied' }
  | { type: 'revokeError'; message: string | null }
  | { type: 'removeStart' }
  | { type: 'removeDone'; message: string | null }
  | { type: 'removeConfirm'; open: boolean }
  | { type: 'testStart' }
  | { type: 'testDone'; ok: boolean | null; message: string | null };

const initialRowUi: RowUiState = {
  showKey: false,
  copied: false,
  revokeError: null,
  removeLoading: false,
  removeMessage: null,
  removeConfirmOpen: false,
  testLoading: false,
  testMessage: null,
  testOk: null,
};

function rowUiReducer(state: RowUiState, action: RowUiAction): RowUiState {
  switch (action.type) {
    case 'toggleShowKey':
      return { ...state, showKey: !state.showKey };
    case 'copied':
      return { ...state, copied: true };
    case 'clearCopied':
      return { ...state, copied: false };
    case 'revokeError':
      return { ...state, revokeError: action.message };
    case 'removeStart':
      return { ...state, removeLoading: true, removeMessage: null, removeConfirmOpen: false };
    case 'removeDone':
      return { ...state, removeLoading: false, removeMessage: action.message };
    case 'removeConfirm':
      return { ...state, removeConfirmOpen: action.open };
    case 'testStart':
      return { ...state, testLoading: true, testMessage: null, testOk: null };
    case 'testDone':
      return { ...state, testLoading: false, testOk: action.ok, testMessage: action.message };
  }
}

function MoreOptionsSection({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const toggle = useCallback(() => setOpen((v) => !v), []);

  return (
    <div className="rounded-md">
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        className="cursor-pointer select-none text-xs text-fg-subtle hover:text-fg-muted"
      >
        <span className="inline-flex items-center gap-1">
          <ChevronDown
            className={cn('size-3 transition-transform', open && 'rotate-180')}
            aria-hidden
          />
          {label}
        </span>
      </button>
      {open ? (
        <div className="mt-2 flex flex-col gap-2 pl-4">
          {children}
        </div>
      ) : null}
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
  autoExpand = false,
  autoFocusInput = false,
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
  /** When true, the row opens automatically on mount. */
  autoExpand?: boolean;
  /** When true, the key input receives focus after expanding. */
  autoFocusInput?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const keyInputRef = useRef<HTMLInputElement>(null);
  const trackedAutoExpandRef = useRef(autoExpand);
  if (autoExpand && !trackedAutoExpandRef.current && !expanded) {
    trackedAutoExpandRef.current = autoExpand;
    setExpanded(true);
  } else if (autoExpand !== trackedAutoExpandRef.current) {
    trackedAutoExpandRef.current = autoExpand;
  }

  const bindKeyInputRef = useCallback(
    (el: HTMLInputElement | null) => {
      keyInputRef.current = el;
      if (autoFocusInput && expanded && el) {
        el.focus();
      }
    },
    [autoFocusInput, expanded],
  );

  const [ui, dispatchUi] = useReducer(rowUiReducer, initialRowUi);
  const {
    showKey,
    copied,
    revokeError,
    removeLoading,
    removeMessage,
    removeConfirmOpen,
    testLoading,
    testMessage,
    testOk,
  } = ui;

  const [oauth, dispatchOAuth] = useReducer(oauthReducer, initialOAuthState);
  const {
    loading: oauthLoading,
    sessionId: oauthSessionId,
    status: oauthStatus,
    message: oauthMessage,
    authUrl,
    instructions,
    codeInput,
  } = oauth;

  const oauthSessionIdRef = useRef<string | undefined>(undefined);
  oauthSessionIdRef.current = oauthSessionId;

  const masked = isMaskedKey(value);
  const inputValue = masked && !showKey ? '' : value;
  const isOAuthConfigured = row.configured && !masked && Boolean(value);

  const activeSrc = row.activeKeySource ?? 'none';

  const apiKeyLinks = useMemo(() => getOrderedApiKeyLinks(row.id, language), [row.id, language]);

  useEffect(() => {
    return () => {
      const sessionId = oauthSessionIdRef.current;
      if (sessionId) {
        void cleanupOAuthSession(sessionId).catch(() => {});
      }
    };
  }, []);

  const reloadProviders = useEffectEvent(() => {
    onReload();
  });

  useEffect(() => {
    if (!oauthSessionId || !oauthLoading) return;
    const id = window.setInterval(() => {
      void (async () => {
        try {
          const st = await fetchOAuthSessionStatus(oauthSessionId);
          if (st.status === 'waiting_auth' || st.status === 'waiting_code') {
            dispatchOAuth({
              type: 'poll',
              message: st.message,
              authUrl: st.authUrl,
              instructions: st.instructions,
              status: st.status === 'waiting_code' ? 'waiting_code' : 'waiting',
            });
          } else if (st.status === 'completed') {
            window.clearInterval(id);
            dispatchOAuth({ type: 'complete', message: st.message });
            window.setTimeout(() => reloadProviders(), 800);
          } else if (st.status === 'failed' || st.status === 'cancelled') {
            window.clearInterval(id);
            dispatchOAuth({
              type: 'fail',
              message: st.error || st.message || 'OAuth failed',
            });
          }
        } catch {
          /* ignore poll errors */
        }
      })();
    }, 1000);
    return () => window.clearInterval(id);
  }, [oauthSessionId, oauthLoading]);

  const startOAuth = async () => {
    dispatchOAuth({ type: 'start', message: labels.oauthStarting });
    try {
      const res = await startAsyncOAuthLogin(row.id);
      dispatchOAuth({ type: 'session', sessionId: res.sessionId });
    } catch (e) {
      dispatchOAuth({
        type: 'fail',
        message: e instanceof Error ? e.message : 'OAuth failed',
      });
    }
  };

  const cancelFlow = async () => {
    const sessionId = oauthSessionId;
    if (!sessionId) return;
    try {
      await cancelOAuth(sessionId);
    } catch {
      /* ignore */
    }
    dispatchOAuth({ type: 'cancel' });
  };

  const submitCode = async () => {
    const sessionId = oauthSessionId;
    if (!sessionId || !codeInput.trim()) return;
    try {
      await submitOAuthCode(sessionId, codeInput.trim());
      dispatchOAuth({ type: 'clearCode' });
      dispatchOAuth({
        type: 'poll',
        message: labels.oauthProcessingCode,
        status: oauthStatus === 'waiting_code' ? 'waiting_code' : 'waiting',
      });
    } catch (e) {
      dispatchOAuth({
        type: 'fail',
        message: e instanceof Error ? e.message : 'Failed',
      });
    }
  };

  const doRevoke = () => {
    if (!window.confirm(interpolate(labels.revokeConfirm, { name: row.name }))) return;
    dispatchUi({ type: 'revokeError', message: null });
    void revokeOAuth(row.id)
      .then(() => onReload())
      .catch((e) =>
        dispatchUi({
          type: 'revokeError',
          message: e instanceof Error ? e.message : labels.revokeFailed,
        }),
      );
  };

  const doRemoveKey = async () => {
    dispatchUi({ type: 'removeStart' });
    try {
      await deleteProviderApiKey(row.id);
      dispatchUi({ type: 'removeDone', message: labels.removeKeySuccess });
      onChange(row.id, '');
      window.setTimeout(() => onReload(), 600);
    } catch (error) {
      dispatchUi({
        type: 'removeDone',
        message: error instanceof Error ? error.message : labels.removeKeyFailed,
      });
    }
  };

  const canRemoveKey =
    row.configured && masked && activeSrc !== 'env' && activeSrc !== 'extension' && activeSrc !== 'models_json';

  const copyKey = async () => {
    if (!value || masked) return;
    const ok = await copyTextToClipboard(value);
    if (!ok) return;
    dispatchUi({ type: 'copied' });
    window.setTimeout(() => dispatchUi({ type: 'clearCopied' }), 2000);
  };

  const runTest = async () => {
    const v = value.trim();
    if (!v || isMaskedKey(v)) return;
    dispatchUi({ type: 'testStart' });
    try {
      const res = await testProviderKeyResolution(v);
      if (res.error) {
        dispatchUi({ type: 'testDone', ok: false, message: `${labels.testFailed} ${res.error}` });
        return;
      }
      const message =
        res.type === 'env'
          ? labels.testOkEnv
          : res.type === 'command'
            ? labels.testOkCommand
            : labels.testOkLiteral;
      dispatchUi({ type: 'testDone', ok: true, message });
    } catch (e) {
      dispatchUi({
        type: 'testDone',
        ok: false,
        message: e instanceof Error ? e.message : labels.testFailed,
      });
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
                    ref={bindKeyInputRef}
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
                      onClick={() => dispatchUi({ type: 'toggleShowKey' })}
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
                        data-oauth-session={oauthSessionId ?? ''}
                        onClick={() => void startOAuth()}
                      >
                        {oauthLoading ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <LogIn className="size-4" aria-hidden />}
                        {labels.oauth}
                      </Button>
                    )
                  ) : null}
                  {/* Remove key moves into the "More" details block below — it's destructive and rarely-used. */}
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
                onChange={(e) => dispatchOAuth({ type: 'setCode', value: e.target.value })}
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

          {/* `oauthHint` removed — the OAuth button right above conveys the same affordance. */}

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

          {(() => {
            // "More" section consolidates the rarely-used or destructive
            // controls so the primary key + Test + OAuth flow stays clean:
            //   • API key console links — most users open these once to grab
            //     a key and never again
            //   • Environment variable alternatives — for users who'd rather
            //     export `OPENAI_API_KEY` than paste it here
            //   • Remove key — destructive, lives behind a confirm dialog
            const envVars = PROVIDER_ENRICHMENT[row.id]?.envVars ?? [];
            const hasMore = apiKeyLinks.length > 0 || envVars.length > 0 || canRemoveKey;
            if (!hasMore) return null;
            return (
              <MoreOptionsSection label={labels.moreOptions ?? labels.envVarAlt}>
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
                {envVars.length > 0 ? (
                  <div className="flex flex-col gap-1">
                    <p className="text-[10px] font-medium uppercase tracking-wide text-fg-subtle">
                      {labels.envVarAlt}
                    </p>
                    {envVars.map((envVar) => (
                      <EnvVarCopyRow key={envVar} envVar={envVar} labels={labels} />
                    ))}
                  </div>
                ) : null}
                {canRemoveKey ? (
                  <>
                    <Button
                      type="button"
                      variant="secondary"
                      className="gap-1 self-start text-red-600 dark:text-red-400"
                      disabled={removeLoading}
                      onClick={() => dispatchUi({ type: 'removeConfirm', open: true })}
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
                      onCancel={() => dispatchUi({ type: 'removeConfirm', open: false })}
                    />
                  </>
                ) : null}
              </MoreOptionsSection>
            );
          })()}
        </div>
      ) : null}
    </div>
  );
}
