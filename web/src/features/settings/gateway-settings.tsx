import {
  AlertCircle,
  ExternalLink,
  KeyRound,
  Loader2,
  Network,
  RefreshCw,
  RotateCw,
  Shield,
  SlidersHorizontal,
  type LucideIcon,
} from 'lucide-react';
import { useCallback, useMemo, useReducer, useRef, type ReactNode } from 'react';

import { uiPatchReducer } from '@/lib/settings-form-draft';
import { useSearchParams } from 'react-router-dom';

import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { SecretInput } from '@/components/ui/secret-input';
import { useGatewayConfigSwr } from '@/features/gateway/gateway-config-swr';
import {
  gatewaySettingsRequireRestart,
  normalizeGatewayFromConfig,
  patchGatewaySettings,
  revealGatewayAuthSecret,
  validateGatewaySettings,
  type GatewaySettingsState,
} from '@/features/settings/gateway-config-api';
import { GatewaySecurityAuditCard } from '@/features/settings/gateway-security-audit-card';
import { MAX_CHANNEL_DEFER_LIST_SIZE } from '@/features/settings/gateway-settings.types';
import { restartGatewayAfterConfigChange } from '@/features/tunnel/gateway-restart';
import { settingsInputFocusClass } from '@/lib/form-field-width';
import { cn } from '@/lib/cn';
import { secretInputLabelsFromGateway } from '@/lib/secret-input-labels';
import { interaction } from '@/lib/interaction';
import { messages, type GatewaySettingsMessages } from '@/i18n/messages';
import { docsGuidePageUrl } from '@/navigation';
import { useGatewayStore } from '@/stores/gateway-store';
import { useLocaleStore } from '@/stores/locale-store';

function inputClassName(): string {
  return cn(
    'w-full rounded-lg border border-edge bg-surface-panel px-3 py-2 text-sm text-fg',
    'placeholder:text-fg-subtle',
    settingsInputFocusClass,
    'dark:border-edge',
  );
}

type GatewaySettingsTabId = 'network' | 'access' | 'updates' | 'security' | 'advanced';

const GATEWAY_SETTINGS_TABS: readonly GatewaySettingsTabId[] = [
  'network',
  'access',
  'updates',
  'security',
  'advanced',
];

const GATEWAY_SETTINGS_TAB_ICONS: Record<GatewaySettingsTabId, LucideIcon> = {
  network: Network,
  access: KeyRound,
  updates: RefreshCw,
  security: Shield,
  advanced: SlidersHorizontal,
};

function parseGatewaySettingsTab(raw: string | null): GatewaySettingsTabId {
  if (raw && GATEWAY_SETTINGS_TABS.includes(raw as GatewaySettingsTabId)) {
    return raw as GatewaySettingsTabId;
  }
  return 'network';
}

function gatewaySettingsTabLabel(g: GatewaySettingsMessages, tab: GatewaySettingsTabId): string {
  if (tab === 'network') return g.tabNetwork;
  if (tab === 'access') return g.tabAccess;
  if (tab === 'updates') return g.tabUpdates;
  if (tab === 'security') return g.tabSecurity;
  return g.tabAdvanced;
}

function gatewaySettingsTabHint(g: GatewaySettingsMessages, tab: GatewaySettingsTabId): string {
  if (tab === 'network') return g.networkTabHint;
  if (tab === 'access') return g.accessTabHint;
  if (tab === 'updates') return g.updatesTabHint;
  if (tab === 'security') return g.securitySectionHint;
  return g.advancedSectionHint;
}

type GatewayFormDraft = {
  form: GatewaySettingsState | null;
  baseline: GatewaySettingsState | null;
  appliedBaseline: GatewaySettingsState | null;
};

type GatewayFormAction =
  | { type: 'reset' }
  | { type: 'init-applied'; value: GatewaySettingsState }
  | { type: 'sync'; value: GatewaySettingsState }
  | { type: 'set-form'; updater: (prev: GatewaySettingsState) => GatewaySettingsState }
  | { type: 'discard' }
  | { type: 'saved'; value: GatewaySettingsState };

function gatewayFormReducer(state: GatewayFormDraft, action: GatewayFormAction): GatewayFormDraft {
  switch (action.type) {
    case 'reset':
      return { form: null, baseline: null, appliedBaseline: null };
    case 'init-applied':
      return { ...state, appliedBaseline: structuredClone(action.value) };
    case 'sync': {
      const snapshot = structuredClone(action.value);
      return { form: snapshot, baseline: structuredClone(snapshot), appliedBaseline: state.appliedBaseline };
    }
    case 'set-form':
      return state.form ? { ...state, form: action.updater(state.form) } : state;
    case 'discard':
      return state.baseline ? { ...state, form: structuredClone(state.baseline) } : state;
    case 'saved': {
      const snapshot = structuredClone(action.value);
      return { form: snapshot, baseline: structuredClone(snapshot), appliedBaseline: state.appliedBaseline };
    }
  }
}

type GatewayUi = {
  saving: boolean;
  error: string | null;
  saveOk: boolean;
  auditRefreshToken: number;
  restarting: boolean;
  restartConfirmOpen: boolean;
};

const initialGatewayUi: GatewayUi = {
  saving: false,
  error: null,
  saveOk: false,
  auditRefreshToken: 0,
  restarting: false,
  restartConfirmOpen: false,
};

export function GatewaySettingsPanel() {
  const language = useLocaleStore((s) => s.language);
  const m = messages(language);
  const g = m.gatewaySettings;
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = parseGatewaySettingsTab(searchParams.get('tab'));

  const setActiveTab = useCallback(
    (tab: GatewaySettingsTabId) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (tab === 'network') next.delete('tab');
          else next.set('tab', tab);
          return next;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );
  const token = useGatewayStore((st) => st.token);
  const tokenExpired = useGatewayStore((st) => st.tokenExpired);
  const openTokenDialog = useGatewayStore((st) => st.openTokenDialog);
  const hasToken = Boolean(token);

  const [formDraft, dispatchForm] = useReducer(gatewayFormReducer, {
    form: null,
    baseline: null,
    appliedBaseline: null,
  });
  const form = formDraft.form;
  const baseline = formDraft.baseline;
  const appliedBaseline = formDraft.appliedBaseline;
  const [ui, dispatchUi] = useReducer(uiPatchReducer<GatewayUi>, initialGatewayUi);
  const {
    saving,
    error,
    saveOk,
    auditRefreshToken,
    restarting,
    restartConfirmOpen,
  } = ui;
  const dirtyRef = useRef(false);
  const trackedParsedRef = useRef<GatewaySettingsState | null>(null);
  const appliedBaselineInitializedRef = useRef(false);

  const { data, error: swrError, isLoading, mutate } = useGatewayConfigSwr(hasToken);

  const parsed = useMemo(
    () =>
      data?.payload?.config !== undefined
        ? structuredClone(normalizeGatewayFromConfig(data.payload.config))
        : null,
    [data],
  );

  if (!hasToken) {
    if (trackedParsedRef.current !== null || appliedBaselineInitializedRef.current) {
      trackedParsedRef.current = null;
      appliedBaselineInitializedRef.current = false;
      dispatchForm({ type: 'reset' });
      dirtyRef.current = false;
    }
  } else if (parsed !== null) {
    if (!appliedBaselineInitializedRef.current) {
      appliedBaselineInitializedRef.current = true;
      dispatchForm({ type: 'init-applied', value: parsed });
    }
    if (!dirtyRef.current && trackedParsedRef.current !== parsed) {
      trackedParsedRef.current = parsed;
      dispatchForm({ type: 'sync', value: parsed });
      dispatchUi({ type: 'patch', patch: { saveOk: false } });
    }
  }

  const loading = Boolean(hasToken && isLoading && data === undefined && !swrError);
  const fetchError =
    swrError instanceof Error ? swrError.message : swrError ? String(swrError) : null;

  const dirty = useMemo(() => {
    if (!form || !baseline) return false;
    return JSON.stringify(form) !== JSON.stringify(baseline);
  }, [form, baseline]);

  const showRestartPrompt = useMemo(() => {
    if (!baseline || !appliedBaseline) return false;
    return gatewaySettingsRequireRestart(appliedBaseline, baseline);
  }, [appliedBaseline, baseline]);

  const updateAuth = useCallback((patch: Partial<GatewaySettingsState['auth']>) => {
    dirtyRef.current = true;
    dispatchForm({ type: 'set-form', updater: (f) => ({ ...f, auth: { ...f.auth, ...patch } }) });
  }, []);

  const updateChannel = useCallback((channel: GatewaySettingsState['updateChannel']) => {
    dirtyRef.current = true;
    dispatchForm({ type: 'set-form', updater: (f) => ({ ...f, updateChannel: channel }) });
  }, []);

  const updateCorsOrigins = useCallback((corsOrigins: string[]) => {
    dirtyRef.current = true;
    dispatchForm({ type: 'set-form', updater: (f) => ({ ...f, corsOrigins }) });
  }, []);

  const updateBind = useCallback((bind: GatewaySettingsState['bind']) => {
    dirtyRef.current = true;
    dispatchForm({ type: 'set-form', updater: (f) => ({ ...f, bind }) });
  }, []);

  const updateCustomBindHost = useCallback((customBindHost: string) => {
    dirtyRef.current = true;
    dispatchForm({
      type: 'set-form',
      updater: (f) => ({ ...f, customBindHost, bind: 'custom' }),
    });
  }, []);

  const updatePort = useCallback((port: number) => {
    dirtyRef.current = true;
    dispatchForm({ type: 'set-form', updater: (f) => ({ ...f, port }) });
  }, []);

  const updateRateLimit = useCallback((patch: Partial<GatewaySettingsState['auth']['rateLimit']>) => {
    dirtyRef.current = true;
    dispatchForm({
      type: 'set-form',
      updater: (f) => ({ ...f, auth: { ...f.auth, rateLimit: { ...f.auth.rateLimit, ...patch } } }),
    });
  }, []);

  const updateMaxSseConnections = useCallback((maxSseConnections: number) => {
    dirtyRef.current = true;
    dispatchForm({ type: 'set-form', updater: (f) => ({ ...f, maxSseConnections }) });
  }, []);

  const updateChannelConnectDeferMode = useCallback(
    (channelConnectDeferMode: GatewaySettingsState['channelConnectDeferMode']) => {
      dirtyRef.current = true;
      dispatchForm({ type: 'set-form', updater: (f) => ({ ...f, channelConnectDeferMode }) });
    },
    [],
  );

  const updateChannelConnectDeferIds = useCallback((channelConnectDeferIds: string[]) => {
    dirtyRef.current = true;
    dispatchForm({ type: 'set-form', updater: (f) => ({ ...f, channelConnectDeferIds }) });
  }, []);

  const updateChannelConnectDeferSkipIds = useCallback((channelConnectDeferSkipIds: string[]) => {
    dirtyRef.current = true;
    dispatchForm({ type: 'set-form', updater: (f) => ({ ...f, channelConnectDeferSkipIds }) });
  }, []);

  const updateTrustedProxies = useCallback((trustedProxies: string[]) => {
    dirtyRef.current = true;
    dispatchForm({ type: 'set-form', updater: (f) => ({ ...f, trustedProxies }) });
  }, []);

  const updateTrustedProxy = useCallback((patch: Partial<GatewaySettingsState['auth']['trustedProxy']>) => {
    dirtyRef.current = true;
    dispatchForm({
      type: 'set-form',
      updater: (f) => ({ ...f, auth: { ...f.auth, trustedProxy: { ...f.auth.trustedProxy, ...patch } } }),
    });
  }, []);

  const updateSecurityStrict = useCallback((securityStrict: boolean) => {
    dirtyRef.current = true;
    dispatchForm({ type: 'set-form', updater: (f) => ({ ...f, securityStrict }) });
  }, []);

  const updateAllowRealIpFallback = useCallback((allowRealIpFallback: boolean) => {
    dirtyRef.current = true;
    dispatchForm({ type: 'set-form', updater: (f) => ({ ...f, allowRealIpFallback }) });
  }, []);

  const updateDangerouslyAllowHostHeaderOriginFallback = useCallback(
    (dangerouslyAllowHostHeaderOriginFallback: boolean) => {
      dirtyRef.current = true;
      dispatchForm({ type: 'set-form', updater: (f) => ({ ...f, dangerouslyAllowHostHeaderOriginFallback }) });
    },
    [],
  );

  const save = useCallback(async () => {
    if (!form || saving) return;
    const validationError = validateGatewaySettings(form);
    if (validationError) {
      dispatchUi({ type: 'patch', patch: { error: validationError } });
      return;
    }
    dispatchUi({ type: 'patch', patch: { saving: true, error: null, saveOk: false } });
    try {
      await patchGatewaySettings(form);
      dirtyRef.current = false;
      dispatchForm({ type: 'saved', value: form });
      dispatchUi({
        type: 'patch',
        patch: { saveOk: true, auditRefreshToken: auditRefreshToken + 1 },
      });
      window.setTimeout(() => dispatchUi({ type: 'patch', patch: { saveOk: false } }), 2500);
    } catch (e) {
      dispatchUi({ type: 'patch', patch: { error: e instanceof Error ? e.message : g.saveError } });
    } finally {
      dispatchUi({ type: 'patch', patch: { saving: false } });
    }
  }, [form, saving, g.saveError]);

  const discard = useCallback(() => {
    if (!baseline) return;
    dirtyRef.current = false;
    dispatchForm({ type: 'discard' });
    dispatchUi({ type: 'patch', patch: { error: null, saveOk: false } });
  }, [baseline]);

  const authSecretLabels = secretInputLabelsFromGateway(g);

  const executeRestart = useCallback(async () => {
    if (restarting) return;
    dispatchUi({ type: 'patch', patch: { restarting: true, restartConfirmOpen: false } });
    try {
      const res = await restartGatewayAfterConfigChange();
      if (res.ok) {
        window.dispatchEvent(new Event('gateway-restart-initiated'));
      } else {
        window.dispatchEvent(
          new CustomEvent('extension-notification', {
            detail: { type: 'error', title: g.restartGatewayFailed, message: res.message ?? '' },
          }),
        );
      }
    } catch (e) {
      window.dispatchEvent(
        new CustomEvent('extension-notification', {
          detail: {
            type: 'error',
            title: g.restartGatewayFailed,
            message: e instanceof Error ? e.message : String(e),
          },
        }),
      );
    } finally {
      dispatchUi({ type: 'patch', patch: { restarting: false } });
    }
  }, [restarting, g.restartGatewayFailed]);

  if (!hasToken) {
    return (
      <div className="mx-auto flex w-full max-w-app-main flex-col gap-3 px-4 py-8">
        <h1 className="text-lg font-semibold text-fg">{m.settingsSections.gateway}</h1>
        <p className="text-sm text-fg-muted">{g.needToken}</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="mx-auto flex w-full max-w-app-main flex-col gap-3 px-4 py-8">
        <div className="flex items-center gap-2 text-sm text-fg-muted">
          <Loader2 className="size-4 animate-spin" />
          {g.loading}
        </div>
      </div>
    );
  }

  if (!form) {
    return (
      <div className="mx-auto flex w-full max-w-app-main flex-col gap-3 px-4 py-8">
        <p className="text-sm text-fg-muted">{error ?? fetchError ?? g.loadError}</p>
        <Button type="button" variant="secondary" onClick={() => void mutate()}>
          {g.retry}
        </Button>
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-app-main flex-col gap-6 px-4 py-6">
      <header className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-lg font-semibold tracking-tight text-fg">{m.settingsSections.gateway}</h1>
          <p className="mt-1 text-sm text-fg-muted">{g.subtitle}</p>
          <a
            href={docsGuidePageUrl(language, 'gateway')}
            target="_blank"
            rel="noreferrer"
            className="mt-1 inline-flex items-center gap-1 text-sm text-accent hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
          >
            {g.docsLink}
            <ExternalLink className="size-3.5" />
          </a>
        </div>
        <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
          {saveOk ? <span className="text-sm text-fg-muted">{g.saved}</span> : null}
          <Button type="button" variant="secondary" disabled={!dirty || saving} onClick={discard}>
            {g.discard}
          </Button>
          <Button type="button" variant="primary" disabled={!dirty || saving} onClick={() => void save()}>
            {saving ? g.saving : g.save}
          </Button>
        </div>
      </header>

      {tokenExpired ? (
        <div
          className="flex flex-col gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 dark:border-red-900/50 dark:bg-red-950/40"
          role="alert"
        >
          <div className="flex items-start gap-2">
            <AlertCircle className="mt-0.5 size-4 shrink-0 text-red-600 dark:text-red-400" />
            <p className="text-sm text-red-900 dark:text-red-100">{g.tokenExpired}</p>
          </div>
          <div>
            <Button type="button" variant="secondary" className="text-sm" onClick={() => openTokenDialog()}>
              {g.updateToken}
            </Button>
          </div>
        </div>
      ) : null}

      {dirty ? <p className="text-xs text-amber-800 dark:text-amber-200">{g.unsavedHint}</p> : null}
      {error ? <p className="text-sm text-red-600 dark:text-red-400">{error}</p> : null}

      {showRestartPrompt ? (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 dark:border-amber-800 dark:bg-amber-950/40">
          <p className="text-xs text-amber-950 dark:text-amber-100">{g.restartHint}</p>
          <Button
            type="button"
            variant="secondary"
            className="shrink-0 gap-1.5 border-red-300 bg-red-50 text-xs text-red-700 hover:bg-red-100 dark:border-red-800 dark:bg-red-950/50 dark:text-red-300 dark:hover:bg-red-900/60"
            disabled={restarting}
            onClick={() => dispatchUi({ type: 'patch', patch: { restartConfirmOpen: true } })}
          >
            {restarting ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <RotateCw className="size-3.5" />
            )}
            {g.restartGatewayButton}
          </Button>
        </div>
      ) : null}

      <ConfirmDialog
        open={restartConfirmOpen}
        title={g.restartGatewayButton}
        description={g.restartGatewayConfirm}
        confirmLabel={g.restartGatewayButton}
        cancelLabel={g.discard}
        destructive
        onConfirm={() => void executeRestart()}
        onCancel={() => dispatchUi({ type: 'patch', patch: { restartConfirmOpen: false } })}
      />

      <GatewaySettingsTabs g={g} activeTab={activeTab} onChange={setActiveTab} />

      <GatewayTabPanel g={g} id="network" activeTab={activeTab}>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-sm font-medium text-fg" htmlFor="gateway-bind-mode">
              {g.bindMode}
            </label>
            <select
              id="gateway-bind-mode"
              className={inputClassName()}
              value={form.bind}
              onChange={(event) => updateBind(event.target.value as GatewaySettingsState['bind'])}
            >
              <option value="loopback">{g.bindLoopback}</option>
              <option value="lan">{g.bindLan}</option>
              <option value="auto">{g.bindAuto}</option>
              <option value="custom">{g.bindCustom}</option>
              <option value="tailnet">{g.bindTailnet}</option>
            </select>
          </div>
          {form.bind === 'custom' ? (
            <div>
              <label className="mb-1 block text-sm font-medium text-fg" htmlFor="gateway-custom-bind-host">
                {g.customBindHost}
              </label>
              <input
                id="gateway-custom-bind-host"
                className={cn(inputClassName(), 'font-mono text-xs')}
                value={form.customBindHost}
                onChange={(event) => updateCustomBindHost(event.target.value)}
                placeholder={g.customBindHostPlaceholder}
                autoComplete="off"
              />
            </div>
          ) : null}
          <div>
            <label className="mb-1 block text-sm font-medium text-fg" htmlFor="gateway-listen-port">
              {g.listenPort}
            </label>
            <input
              id="gateway-listen-port"
              type="number"
              min={1}
              max={65535}
              className={cn(inputClassName(), 'font-mono text-xs')}
              value={form.port}
              onChange={(event) => {
                const nextPort = Number(event.target.value);
                updatePort(
                  Number.isFinite(nextPort)
                    ? Math.max(1, Math.min(65535, Math.floor(nextPort)))
                    : form.port,
                );
              }}
            />
          </div>
          <p className="text-xs text-fg-subtle sm:col-span-2">{g.listenHint}</p>
        </div>

        <CorsOriginsField g={g} origins={form.corsOrigins} onChange={updateCorsOrigins} />
      </GatewayTabPanel>

      <GatewayTabPanel g={g} id="access" activeTab={activeTab}>
        {form.auth.mode === 'none' ? (
          <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-950 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100">
            {g.authModeNone}
          </p>
        ) : null}

        <div className="space-y-2">
          <label className="text-sm font-medium text-fg" htmlFor="gateway-auth-mode">
            {g.authMode}
          </label>
          <select
            id="gateway-auth-mode"
            value={form.auth.mode}
            onChange={(event) => updateAuth({ mode: event.target.value as GatewaySettingsState['auth']['mode'] })}
            className={inputClassName()}
          >
            <option value="token">{g.authModeToken}</option>
            <option value="password">{g.authModePassword}</option>
            <option value="trusted-proxy">{g.authModeTrustedProxy}</option>
            <option value="none">{g.authModeNoneLabel}</option>
          </select>
        </div>

        {form.auth.mode === 'trusted-proxy' ? (
          <TrustedProxyAuthFields
            g={g}
            form={form}
            onTrustedProxyChange={updateTrustedProxy}
            onTrustedProxiesChange={updateTrustedProxies}
            onAllowRealIpFallbackChange={updateAllowRealIpFallback}
          />
        ) : null}

        {form.auth.mode === 'token' ? (
          <>
            <SecretCredentialField
              id="gateway-access-token"
              label={g.accessToken}
              help={g.tokenHelp}
              placeholder={g.tokenPlaceholder}
              value={form.auth.token}
              labels={authSecretLabels}
              reveal={() => revealGatewayAuthSecret('token').then((payload) => payload.secret)}
              loadFailedLabel={g.saveError}
              onChange={(tokenValue) => updateAuth({ token: tokenValue })}
            />
            <Button type="button" variant="secondary" className="w-full sm:w-auto" onClick={() => openTokenDialog()}>
              {g.changeToken}
            </Button>
          </>
        ) : null}

        {form.auth.mode === 'password' ? (
          <SecretCredentialField
            id="gateway-auth-password"
            label={g.authPassword}
            help={g.authPasswordHelp}
            placeholder={g.authPasswordPlaceholder}
            value={form.auth.password}
            labels={authSecretLabels}
            reveal={() => revealGatewayAuthSecret('password').then((payload) => payload.secret)}
            loadFailedLabel={g.saveError}
            onChange={(passwordValue) => updateAuth({ password: passwordValue })}
          />
        ) : null}

        {form.auth.mode !== 'none' ? (
          <AuthRateLimitFields g={g} rateLimit={form.auth.rateLimit} onChange={updateRateLimit} />
        ) : null}
      </GatewayTabPanel>

      <GatewayTabPanel g={g} id="updates" activeTab={activeTab}>
        <div className="space-y-2">
          <label className="text-sm font-medium text-fg" htmlFor="gateway-update-channel">
            {g.updateChannel}
          </label>
          <select
            id="gateway-update-channel"
            value={form.updateChannel}
            onChange={(event) => updateChannel(event.target.value as GatewaySettingsState['updateChannel'])}
            className={inputClassName()}
          >
            <option value="stable">{g.channelStable}</option>
            <option value="beta">{g.channelBeta}</option>
            <option value="dev">{g.channelDev}</option>
          </select>
          <p className="text-xs text-fg-subtle">{g.updateChannelHint}</p>
        </div>

        <div className="space-y-4 border-t border-edge pt-4">
          <div className="text-sm font-medium text-fg">{g.updateAutoSection}</div>
          <p className="text-xs text-fg-subtle">{g.updateAutoSectionHint}</p>
          <label className="flex cursor-pointer items-start gap-2 text-sm text-fg">
            <input
              type="checkbox"
              className="ui-checkbox mt-0.5"
              checked={form.updateCheckOnStart}
              onChange={(event) => {
                dirtyRef.current = true;
                dispatchForm({
                  type: 'set-form',
                  updater: (currentForm) => ({ ...currentForm, updateCheckOnStart: event.target.checked }),
                });
              }}
            />
            <span>
              <span className="font-medium">{g.updateCheckOnStart}</span>
              <span className="mt-0.5 block text-xs text-fg-subtle">{g.updateCheckOnStartHint}</span>
            </span>
          </label>
          <label className="flex cursor-pointer items-start gap-2 text-sm text-fg">
            <input
              type="checkbox"
              className="ui-checkbox mt-0.5"
              checked={form.updateAutoEnabled}
              onChange={(event) => {
                dirtyRef.current = true;
                dispatchForm({
                  type: 'set-form',
                  updater: (currentForm) => ({ ...currentForm, updateAutoEnabled: event.target.checked }),
                });
              }}
            />
            <span>
              <span className="font-medium">{g.updateAutoEnabled}</span>
              <span className="mt-0.5 block text-xs text-fg-subtle">{g.updateAutoEnabledHint}</span>
            </span>
          </label>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-sm font-medium text-fg" htmlFor="update-auto-stable-delay">
                {g.updateAutoStableDelayHours}
              </label>
              <input
                id="update-auto-stable-delay"
                type="number"
                min={0}
                disabled={!form.updateAutoEnabled}
                className={inputClassName()}
                value={form.updateAutoStableDelayHours}
                onChange={(event) => {
                  dirtyRef.current = true;
                  dispatchForm({ type: 'set-form', updater: (currentForm) => ({
                          ...currentForm,
                          updateAutoStableDelayHours: Math.max(0, Math.floor(Number(event.target.value) || 0)),
                        }) });
                }}
              />
              <p className="mt-1 text-xs text-fg-subtle">{g.updateAutoStableDelayHoursHint}</p>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-fg" htmlFor="update-auto-stable-jitter">
                {g.updateAutoStableJitterHours}
              </label>
              <input
                id="update-auto-stable-jitter"
                type="number"
                min={0}
                disabled={!form.updateAutoEnabled}
                className={inputClassName()}
                value={form.updateAutoStableJitterHours}
                onChange={(event) => {
                  dirtyRef.current = true;
                  dispatchForm({ type: 'set-form', updater: (currentForm) => ({
                          ...currentForm,
                          updateAutoStableJitterHours: Math.max(0, Math.floor(Number(event.target.value) || 0)),
                        }) });
                }}
              />
              <p className="mt-1 text-xs text-fg-subtle">{g.updateAutoStableJitterHoursHint}</p>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-fg" htmlFor="update-auto-beta-interval">
                {g.updateAutoBetaCheckIntervalHours}
              </label>
              <input
                id="update-auto-beta-interval"
                type="number"
                min={0.25}
                step={0.25}
                disabled={!form.updateAutoEnabled}
                className={inputClassName()}
                value={form.updateAutoBetaCheckIntervalHours}
                onChange={(event) => {
                  dirtyRef.current = true;
                  dispatchForm({ type: 'set-form', updater: (currentForm) => ({
                          ...currentForm,
                          updateAutoBetaCheckIntervalHours: Math.max(0.25, Number(event.target.value) || 1),
                        }) });
                }}
              />
              <p className="mt-1 text-xs text-fg-subtle">{g.updateAutoBetaCheckIntervalHoursHint}</p>
            </div>
          </div>
        </div>
      </GatewayTabPanel>

      <GatewayTabPanel g={g} id="security" activeTab={activeTab}>
        <GatewaySecurityAuditCard enabled={hasToken} refreshToken={auditRefreshToken} />
        <GatewaySecurityFields
          g={g}
          form={form}
          onSecurityStrictChange={updateSecurityStrict}
          onDangerouslyAllowHostHeaderOriginFallbackChange={updateDangerouslyAllowHostHeaderOriginFallback}
        />
      </GatewayTabPanel>

      <GatewayTabPanel g={g} id="advanced" activeTab={activeTab}>
        <GatewayAdvancedFields
          g={g}
          form={form}
          onMaxSseConnectionsChange={updateMaxSseConnections}
          onDeferModeChange={updateChannelConnectDeferMode}
          onDeferIdsChange={updateChannelConnectDeferIds}
          onSkipIdsChange={updateChannelConnectDeferSkipIds}
        />
      </GatewayTabPanel>
    </div>
  );
}

function GatewaySettingsTabs({
  g,
  activeTab,
  onChange,
}: {
  g: GatewaySettingsMessages;
  activeTab: GatewaySettingsTabId;
  onChange: (tab: GatewaySettingsTabId) => void;
}) {
  return (
    <nav
      aria-label={g.tabsAriaLabel}
      className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1"
      role="tablist"
      onKeyDown={(event) => {
        if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
        event.preventDefault();
        const currentIndex = GATEWAY_SETTINGS_TABS.indexOf(activeTab);
        const delta = event.key === 'ArrowRight' ? 1 : -1;
        const nextIndex =
          (currentIndex + delta + GATEWAY_SETTINGS_TABS.length) % GATEWAY_SETTINGS_TABS.length;
        onChange(GATEWAY_SETTINGS_TABS[nextIndex]);
      }}
    >
      {GATEWAY_SETTINGS_TABS.map((tab) => {
        const Icon = GATEWAY_SETTINGS_TAB_ICONS[tab];
        const selected = tab === activeTab;
        return (
          <button
            key={tab}
            type="button"
            role="tab"
            aria-selected={selected}
            aria-controls={`gateway-settings-panel-${tab}`}
            id={`gateway-settings-tab-${tab}`}
            className={cn(
              'inline-flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
              interaction.press,
              selected ? 'bg-accent-soft text-accent-fg' : 'text-fg-muted hover:bg-surface-hover hover:text-fg',
            )}
            onClick={() => onChange(tab)}
          >
            <Icon className="size-3.5 shrink-0" strokeWidth={1.75} aria-hidden />
            <span>{gatewaySettingsTabLabel(g, tab)}</span>
          </button>
        );
      })}
    </nav>
  );
}

function GatewayTabPanel({
  g,
  id,
  activeTab,
  children,
}: {
  g: GatewaySettingsMessages;
  id: GatewaySettingsTabId;
  activeTab: GatewaySettingsTabId;
  children: ReactNode;
}) {
  if (activeTab !== id) return null;

  return (
    <section
      id={`gateway-settings-panel-${id}`}
      role="tabpanel"
      aria-labelledby={`gateway-settings-tab-${id}`}
      className="rounded-2xl border border-edge bg-surface-base px-4 py-5 sm:px-5"
    >
      <div className="mb-5">
        <div className="text-sm font-semibold text-fg">{gatewaySettingsTabLabel(g, id)}</div>
        <p className="mt-1 text-xs text-fg-subtle">{gatewaySettingsTabHint(g, id)}</p>
      </div>
      <div className="space-y-4">{children}</div>
    </section>
  );
}


function GatewaySecurityFields({
  g,
  form,
  onSecurityStrictChange,
  onDangerouslyAllowHostHeaderOriginFallbackChange,
}: {
  g: GatewaySettingsMessages;
  form: GatewaySettingsState;
  onSecurityStrictChange: (value: boolean) => void;
  onDangerouslyAllowHostHeaderOriginFallbackChange: (value: boolean) => void;
}) {
  return (
    <div className="space-y-4">
      <label className="flex cursor-pointer items-start gap-2 text-sm text-fg">
        <input
          type="checkbox"
          className="ui-checkbox mt-0.5"
          checked={form.securityStrict}
          onChange={(e) => onSecurityStrictChange(e.target.checked)}
        />
        <span>
          <span className="font-medium">{g.securityStrict}</span>
          <span className="mt-0.5 block text-xs text-fg-subtle">{g.securityStrictHint}</span>
        </span>
      </label>

      <label className="flex cursor-pointer items-start gap-2 text-sm text-fg">
        <input
          type="checkbox"
          className="ui-checkbox mt-0.5"
          checked={form.dangerouslyAllowHostHeaderOriginFallback}
          onChange={(e) => onDangerouslyAllowHostHeaderOriginFallbackChange(e.target.checked)}
        />
        <span>
          <span className="font-medium">{g.dangerouslyAllowHostHeaderOriginFallback}</span>
          <span className="mt-0.5 block text-xs text-fg-subtle">
            {g.dangerouslyAllowHostHeaderOriginFallbackHint}
          </span>
        </span>
      </label>

      {form.dangerouslyAllowHostHeaderOriginFallback ? (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-950 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100">
          {g.dangerouslyAllowHostHeaderOriginFallbackWarning}
        </p>
      ) : null}
    </div>
  );
}

function TrustedProxyAuthFields({
  g,
  form,
  onTrustedProxyChange,
  onTrustedProxiesChange,
  onAllowRealIpFallbackChange,
}: {
  g: GatewaySettingsMessages;
  form: GatewaySettingsState;
  onTrustedProxyChange: (patch: Partial<GatewaySettingsState['auth']['trustedProxy']>) => void;
  onTrustedProxiesChange: (values: string[]) => void;
  onAllowRealIpFallbackChange: (value: boolean) => void;
}) {
  const tp = form.auth.trustedProxy;

  return (
    <div className="space-y-4 border-t border-edge pt-4">
      <p className="text-xs text-fg-subtle">{g.authModeTrustedProxyHint}</p>

      <div>
        <label className="mb-1 block text-sm font-medium text-fg" htmlFor="gateway-trusted-proxy-user-header">
          {g.trustedProxyUserHeader}
        </label>
        <input
          id="gateway-trusted-proxy-user-header"
          className={cn(inputClassName(), 'font-mono text-xs')}
          value={tp.userHeader}
          onChange={(e) => onTrustedProxyChange({ userHeader: e.target.value })}
          placeholder={g.trustedProxyUserHeaderPlaceholder}
          autoComplete="off"
        />
        <p className="mt-1 text-xs text-fg-subtle">{g.trustedProxyUserHeaderHint}</p>
      </div>

      <GatewayStringListField
        title={g.trustedProxyRequiredHeaders}
        hint={g.trustedProxyRequiredHeadersHint}
        emptyText={g.channelIdListEmpty}
        placeholder={g.trustedProxyUserHeaderPlaceholder}
        values={tp.requiredHeaders}
        maxItems={32}
        onChange={(requiredHeaders) => onTrustedProxyChange({ requiredHeaders })}
      />

      <GatewayStringListField
        title={g.trustedProxyAllowUsers}
        hint={g.trustedProxyAllowUsersHint}
        emptyText={g.channelIdListEmpty}
        placeholder={g.trustedProxyUserHeaderPlaceholder}
        values={tp.allowUsers}
        maxItems={128}
        onChange={(allowUsers) => onTrustedProxyChange({ allowUsers })}
      />

      <label className="flex cursor-pointer items-start gap-2 text-sm text-fg">
        <input
          type="checkbox"
          className="ui-checkbox mt-0.5"
          checked={tp.allowLoopback}
          onChange={(e) => onTrustedProxyChange({ allowLoopback: e.target.checked })}
        />
        <span>
          <span className="font-medium">{g.trustedProxyAllowLoopback}</span>
          <span className="mt-0.5 block text-xs text-fg-subtle">{g.trustedProxyAllowLoopbackHint}</span>
        </span>
      </label>

      <GatewayStringListField
        title={g.trustedProxies}
        hint={g.trustedProxiesHint}
        emptyText={g.trustedProxiesEmpty}
        placeholder={g.trustedProxiesPlaceholder}
        values={form.trustedProxies}
        maxItems={64}
        onChange={onTrustedProxiesChange}
      />

      <label className="flex cursor-pointer items-start gap-2 text-sm text-fg">
        <input
          type="checkbox"
          className="ui-checkbox mt-0.5"
          checked={form.allowRealIpFallback}
          onChange={(e) => onAllowRealIpFallbackChange(e.target.checked)}
        />
        <span>
          <span className="font-medium">{g.allowRealIpFallback}</span>
          <span className="mt-0.5 block text-xs text-fg-subtle">{g.allowRealIpFallbackHint}</span>
        </span>
      </label>
    </div>
  );
}

function GatewayAdvancedFields({
  g,
  form,
  onMaxSseConnectionsChange,
  onDeferModeChange,
  onDeferIdsChange,
  onSkipIdsChange,
}: {
  g: GatewaySettingsMessages;
  form: GatewaySettingsState;
  onMaxSseConnectionsChange: (value: number) => void;
  onDeferModeChange: (mode: GatewaySettingsState['channelConnectDeferMode']) => void;
  onDeferIdsChange: (ids: string[]) => void;
  onSkipIdsChange: (ids: string[]) => void;
}) {
  return (
    <div className="space-y-4">
      <div>
        <label className="mb-1 block text-sm font-medium text-fg" htmlFor="gateway-max-sse">
          {g.maxSseConnections}
        </label>
        <input
          id="gateway-max-sse"
          type="number"
          min={1}
          className={cn(inputClassName(), 'max-w-xs font-mono text-xs')}
          value={form.maxSseConnections}
          onChange={(e) => {
            const n = Number(e.target.value);
            if (Number.isFinite(n)) onMaxSseConnectionsChange(Math.max(1, Math.floor(n)));
          }}
        />
        <p className="mt-1 text-xs text-fg-subtle">{g.maxSseConnectionsHint}</p>
      </div>

      <div className="space-y-2 border-t border-edge pt-4">
        <label className="text-sm font-medium text-fg" htmlFor="gateway-channel-defer-mode">
          {g.channelConnectDeferMode}
        </label>
        <select
          id="gateway-channel-defer-mode"
          value={form.channelConnectDeferMode}
          onChange={(e) =>
            onDeferModeChange(e.target.value as GatewaySettingsState['channelConnectDeferMode'])
          }
          className={inputClassName()}
        >
          <option value="auto">{g.channelConnectDeferModeAuto}</option>
          <option value="off">{g.channelConnectDeferModeOff}</option>
          <option value="explicit">{g.channelConnectDeferModeExplicit}</option>
        </select>
        <p className="text-xs text-fg-subtle">{g.channelConnectDeferModeHint}</p>
      </div>

      {form.channelConnectDeferMode === 'explicit' ? (
        <GatewayStringListField
          title={g.channelConnectDeferIds}
          hint={g.channelConnectDeferIdsHint}
          emptyText={g.channelIdListEmpty}
          placeholder={g.channelIdListPlaceholder}
          values={form.channelConnectDeferIds}
          maxItems={MAX_CHANNEL_DEFER_LIST_SIZE}
          onChange={onDeferIdsChange}
        />
      ) : null}

      {form.channelConnectDeferMode !== 'off' ? (
        <GatewayStringListField
          title={g.channelConnectDeferSkipIds}
          hint={g.channelConnectDeferSkipIdsHint}
          emptyText={g.channelIdListEmpty}
          placeholder={g.channelIdListPlaceholder}
          values={form.channelConnectDeferSkipIds}
          maxItems={MAX_CHANNEL_DEFER_LIST_SIZE}
          onChange={onSkipIdsChange}
        />
      ) : null}
    </div>
  );
}

function GatewayStringListField({
  title,
  hint,
  emptyText,
  placeholder,
  values,
  maxItems,
  onChange,
  children,
}: {
  title: string;
  hint: string;
  emptyText: string;
  placeholder: string;
  values: string[];
  maxItems: number;
  onChange: (values: string[]) => void;
  children?: ReactNode;
}) {
  const addValue = useCallback(
    (raw: string) => {
      const next = raw.trim();
      if (!next || values.includes(next) || values.length >= maxItems) return;
      onChange([...values, next]);
    },
    [maxItems, onChange, values],
  );

  return (
    <div className="space-y-2 border-t border-edge pt-4">
      <div className="text-sm font-medium text-fg">{title}</div>
      <p className="text-xs text-fg-subtle">{hint}</p>
      {values.length === 0 ? (
        <p className="text-xs text-fg-muted">{emptyText}</p>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {values.map((value) => (
            <span
              key={value}
              className="inline-flex items-center gap-1 rounded-md border border-edge bg-surface-panel px-2 py-0.5 font-mono text-xs text-fg"
            >
              {value}
              <button
                type="button"
                className={cn('text-fg-muted hover:text-fg', interaction.press)}
                aria-label={`Remove ${value}`}
                onClick={() => onChange(values.filter((x) => x !== value))}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}
      <input
        className={cn(inputClassName(), 'font-mono text-xs')}
        placeholder={placeholder}
        disabled={values.length >= maxItems}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            addValue((e.target as HTMLInputElement).value);
            (e.target as HTMLInputElement).value = '';
          }
        }}
      />
      {children}
    </div>
  );
}

function CorsOriginsField({
  g,
  origins,
  onChange,
}: {
  g: GatewaySettingsMessages;
  origins: string[];
  onChange: (origins: string[]) => void;
}) {
  const hasWildcard = origins.includes('*');

  return (
    <GatewayStringListField
      title={g.corsOrigins}
      hint={g.corsOriginsHint}
      emptyText={g.corsOriginsEmpty}
      placeholder={g.corsOriginsPlaceholder}
      values={origins}
      maxItems={128}
      onChange={onChange}
    >
      {hasWildcard ? (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-950 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100">
          {g.corsOriginsWildcardWarning}
        </p>
      ) : null}
    </GatewayStringListField>
  );
}

function AuthRateLimitFields({
  g,
  rateLimit,
  onChange,
}: {
  g: GatewaySettingsMessages;
  rateLimit: GatewaySettingsState['auth']['rateLimit'];
  onChange: (patch: Partial<GatewaySettingsState['auth']['rateLimit']>) => void;
}) {
  return (
    <div className="space-y-3 border-t border-edge pt-4">
      <div>
        <div className="text-sm font-medium text-fg">{g.rateLimitTitle}</div>
        <p className="mt-1 text-xs text-fg-subtle">{g.rateLimitHint}</p>
      </div>
      <label className="flex cursor-pointer items-center gap-2 text-sm text-fg">
        <input
          type="checkbox"
          className="ui-checkbox"
          checked={rateLimit.enabled}
          onChange={(e) => onChange({ enabled: e.target.checked })}
        />
        {g.rateLimitEnabled}
      </label>
      <label className="flex cursor-pointer items-center gap-2 text-sm text-fg">
        <input
          type="checkbox"
          className="ui-checkbox"
          checked={rateLimit.exemptLoopback}
          disabled={!rateLimit.enabled}
          onChange={(e) => onChange({ exemptLoopback: e.target.checked })}
        />
        {g.rateLimitExemptLoopback}
      </label>
      <div className="grid gap-3 sm:grid-cols-3">
        <div>
          <label className="mb-1 block text-xs font-medium text-fg-muted" htmlFor="gateway-rate-max">
            {g.rateLimitMaxAttempts}
          </label>
          <input
            id="gateway-rate-max"
            type="number"
            min={1}
            className={inputClassName()}
            value={rateLimit.maxAttempts}
            disabled={!rateLimit.enabled}
            onChange={(e) => {
              const n = Number(e.target.value);
              if (Number.isFinite(n)) onChange({ maxAttempts: Math.max(1, Math.floor(n)) });
            }}
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-fg-muted" htmlFor="gateway-rate-window">
            {g.rateLimitWindowMinutes}
          </label>
          <input
            id="gateway-rate-window"
            type="number"
            min={1}
            className={inputClassName()}
            value={Math.round(rateLimit.windowMs / 60_000)}
            disabled={!rateLimit.enabled}
            onChange={(e) => {
              const n = Number(e.target.value);
              if (Number.isFinite(n) && n > 0) onChange({ windowMs: Math.floor(n) * 60_000 });
            }}
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-fg-muted" htmlFor="gateway-rate-block">
            {g.rateLimitBlockMinutes}
          </label>
          <input
            id="gateway-rate-block"
            type="number"
            min={1}
            className={inputClassName()}
            value={Math.round(rateLimit.blockDurationMs / 60_000)}
            disabled={!rateLimit.enabled}
            onChange={(e) => {
              const n = Number(e.target.value);
              if (Number.isFinite(n) && n > 0) onChange({ blockDurationMs: Math.floor(n) * 60_000 });
            }}
          />
        </div>
      </div>
    </div>
  );
}

function SecretCredentialField({
  id,
  label,
  help,
  placeholder,
  value,
  labels,
  reveal,
  loadFailedLabel,
  onChange,
}: {
  id: string;
  label: string;
  help: string;
  placeholder: string;
  value: string;
  labels: ReturnType<typeof secretInputLabelsFromGateway>;
  reveal: () => Promise<string | null>;
  loadFailedLabel: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-sm font-medium text-fg" htmlFor={id}>
        {label}
      </label>
      <SecretInput
        id={id}
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        labels={labels}
        reveal={reveal}
        loadFailedLabel={loadFailedLabel}
        inputClassName="text-xs"
      />
      <p className="text-xs text-fg-subtle">{help}</p>
    </div>
  );
}
