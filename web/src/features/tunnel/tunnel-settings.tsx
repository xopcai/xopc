import { Globe, Loader2 } from 'lucide-react';
import { useCallback, useEffect, useMemo, useReducer, useRef } from 'react';

import { uiPatchReducer } from '@/lib/settings-form-draft';
import useSWR from 'swr';

import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { useGatewayConfigSwr } from '@/features/gateway/gateway-config-swr';
import { revalidateGatewayConfig } from '@/features/gateway/gateway-config-swr';
import { isMaskedKey } from '@/features/settings/providers-api';
import { SettingsCollapsibleSection } from '@/features/settings/settings-collapsible-section';
import { SettingsFormSection } from '@/features/settings/settings-form-section';
import { MobilePairQrSection } from '@/features/tunnel/mobile-pair-qr-section';
import { TunnelConsentDialog } from '@/features/tunnel/tunnel-consent-dialog';
import { TunnelControlCard } from '@/features/tunnel/tunnel-control-card';
import { BrokerSecretSetupSection } from '@/features/tunnel/tunnel-broker-secret-section';
import { RemoteAccessDocsLink } from '@/features/remote-access/remote-access-docs-link';
import {
  fetchTunnelStatus,
  patchTunnelConfig,
  recordTunnelConsent,
  startTunnel,
  stopTunnel,
} from '@/features/tunnel/tunnel-api';
import { useMobilePairQr } from '@/features/tunnel/use-mobile-pair-qr';
import { cn } from '@/lib/cn';
import { messages } from '@/i18n/messages';
import { useGatewayStore } from '@/stores/gateway-store';
import { useLocaleStore } from '@/stores/locale-store';

type TunnelUi = {
  actionError: string | null;
  starting: boolean;
  stopping: boolean;
  savingAutoStart: boolean;
  consentOpen: boolean;
  autoStartConfirmOpen: boolean;
  releaseConfirmOpen: boolean;
  releasing: boolean;
  brokerSecretDraft: string;
  savingBrokerSecret: boolean;
  brokerSecretNotice: string | null;
};

const initialTunnelUi: TunnelUi = {
  actionError: null,
  starting: false,
  stopping: false,
  savingAutoStart: false,
  consentOpen: false,
  autoStartConfirmOpen: false,
  releaseConfirmOpen: false,
  releasing: false,
  brokerSecretDraft: '',
  savingBrokerSecret: false,
  brokerSecretNotice: null,
};

export function TunnelSettingsPanel({ embedded = false }: { embedded?: boolean }) {
  const language = useLocaleStore((s) => s.language);
  const t = messages(language).tunnelSettings;
  const token = useGatewayStore((st) => st.token);
  const hasToken = Boolean(token);

  const [ui, dispatchUi] = useReducer(uiPatchReducer<TunnelUi>, initialTunnelUi);
  const {
    actionError,
    starting,
    stopping,
    savingAutoStart,
    consentOpen,
    autoStartConfirmOpen,
    releaseConfirmOpen,
    releasing,
    brokerSecretDraft,
    savingBrokerSecret,
    brokerSecretNotice,
  } = ui;
  const brokerSecretSectionRef = useRef<HTMLDivElement>(null);

  const pairQr = useMobilePairQr(token ?? '');

  const { data: cfgData } = useGatewayConfigSwr(hasToken);

  const {
    data: status,
    error: statusErr,
    isLoading,
    mutate: mutStatus,
  } = useSWR(hasToken ? 'tunnel-status' : null, fetchTunnelStatus, {
    refreshInterval: (latest) => {
      if (starting) return 1000;
      if (latest?.frpcDownload || latest?.state === 'connecting' || latest?.state === 'reconnecting') {
        return 2000;
      }
      return 60_000;
    },
  });

  const autoStartEnabled = useMemo(() => {
    const c = cfgData?.payload?.config;
    if (c && typeof c === 'object' && !Array.isArray(c)) {
      const tunnel = (c as { tunnel?: unknown }).tunnel;
      if (tunnel && typeof tunnel === 'object' && !Array.isArray(tunnel)) {
        if ((tunnel as { autoStart?: unknown }).autoStart === true) return true;
      }
    }
    return status?.config?.autoStart === true;
  }, [cfgData, status?.config?.autoStart]);

  const brokerSecretFromConfig = useMemo(() => {
    const c = cfgData?.payload?.config;
    if (c && typeof c === 'object' && !Array.isArray(c)) {
      const tunnel = (c as { tunnel?: unknown }).tunnel;
      if (tunnel && typeof tunnel === 'object' && !Array.isArray(tunnel)) {
        const secret = (tunnel as { registrationSecret?: unknown }).registrationSecret;
        if (typeof secret === 'string') return secret;
      }
    }
    return '';
  }, [cfgData]);

  const brokerSecretConfiguredInConfig = isMaskedKey(brokerSecretFromConfig);
  const brokerSecretFromEnv = status?.registrationSecret?.source === 'env';
  const brokerSecretMissing = status?.registrationSecret?.source === 'missing';
  const brokerReady = status?.registrationSecret?.configured === true;

  useEffect(() => {
    const onTunnelStatus = () => {
      void mutStatus();
    };
    window.addEventListener('tunnel-status', onTunnelStatus);
    return () => window.removeEventListener('tunnel-status', onTunnelStatus);
  }, [mutStatus]);

  const consentBullets = useMemo(
    () => [t.consentBullet1, t.consentBullet2, t.consentBullet3] as const,
    [t.consentBullet1, t.consentBullet2, t.consentBullet3],
  );

  const runStart = useCallback(async () => {
    dispatchUi({ type: 'patch', patch: { actionError: null } });
    dispatchUi({ type: 'patch', patch: { starting: true } });
    try {
      const res = await startTunnel();
      await mutStatus();
      void revalidateGatewayConfig();
      await pairQr.refreshQr(res.qrPayload);
    } catch (e) {
      dispatchUi({
        type: 'patch',
        patch: { actionError: e instanceof Error ? e.message : String(e) },
      });
    } finally {
      dispatchUi({ type: 'patch', patch: { starting: false } });
    }
  }, [mutStatus, pairQr.refreshQr]);

  const handleStartClick = useCallback(() => {
    if (!brokerReady) {
      dispatchUi({ type: 'patch', patch: { actionError: t.brokerSecretRequiredBeforeStart } });
      brokerSecretSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }
    if (status?.consentRequired) {
      dispatchUi({ type: 'patch', patch: { consentOpen: true } });
      return;
    }
    void runStart();
  }, [brokerReady, status?.consentRequired, runStart, t.brokerSecretRequiredBeforeStart]);

  const handleConsentConfirm = useCallback(async () => {
    dispatchUi({ type: 'patch', patch: { consentOpen: false } });
    dispatchUi({ type: 'patch', patch: { actionError: null } });
    try {
      await recordTunnelConsent();
      await Promise.all([mutStatus(), runStart()]);
    } catch (e) {
      dispatchUi({
        type: 'patch',
        patch: { actionError: e instanceof Error ? e.message : String(e) },
      });
    }
  }, [mutStatus, runStart]);

  const handleStop = useCallback(async () => {
    dispatchUi({ type: 'patch', patch: { actionError: null } });
    dispatchUi({ type: 'patch', patch: { stopping: true } });
    try {
      await stopTunnel();
      await Promise.all([pairQr.refreshQr(), mutStatus()]);
      void revalidateGatewayConfig();
    } catch (e) {
      dispatchUi({
        type: 'patch',
        patch: { actionError: e instanceof Error ? e.message : String(e) },
      });
    } finally {
      dispatchUi({ type: 'patch', patch: { stopping: false } });
    }
  }, [mutStatus, pairQr.refreshQr]);

  const applyAutoStart = useCallback(
    async (next: boolean) => {
      dispatchUi({ type: 'patch', patch: { savingAutoStart: true } });
      dispatchUi({ type: 'patch', patch: { actionError: null } });
      try {
        await patchTunnelConfig({ autoStart: next });
        void revalidateGatewayConfig();
      } catch (e) {
        dispatchUi({
        type: 'patch',
        patch: { actionError: e instanceof Error ? e.message : String(e) },
      });
      } finally {
        dispatchUi({ type: 'patch', patch: { savingAutoStart: false } });
      }
    },
    [],
  );

  const toggleAutoStart = useCallback(() => {
    if (autoStartEnabled) {
      void applyAutoStart(false);
      return;
    }
    if (status?.consentRequired) {
      dispatchUi({ type: 'patch', patch: { actionError: t.consentExpiredBanner } });
      return;
    }
    if (!status?.canAutoStart) {
      dispatchUi({ type: 'patch', patch: { actionError: t.autoStartHint } });
      return;
    }
    dispatchUi({ type: 'patch', patch: { autoStartConfirmOpen: true } });
  }, [applyAutoStart, status?.canAutoStart, status?.consentRequired, t, autoStartEnabled]);

  const saveBrokerSecret = useCallback(async () => {
    const trimmed = brokerSecretDraft.trim();
    if (!trimmed) return;
    dispatchUi({
      type: 'patch',
      patch: { savingBrokerSecret: true, actionError: null, brokerSecretNotice: null },
    });
    try {
      await patchTunnelConfig({ registrationSecret: trimmed });
      dispatchUi({
        type: 'patch',
        patch: { brokerSecretDraft: '', brokerSecretNotice: t.brokerSecretSaved },
      });
      void revalidateGatewayConfig();
      await mutStatus();
      dispatchUi({ type: 'patch', patch: { actionError: null } });
    } catch (e) {
      dispatchUi({
        type: 'patch',
        patch: { actionError: e instanceof Error ? e.message : String(e) },
      });
    } finally {
      dispatchUi({ type: 'patch', patch: { savingBrokerSecret: false } });
    }
  }, [brokerSecretDraft, mutStatus, t.brokerSecretSaved]);

  const clearBrokerSecret = useCallback(async () => {
    dispatchUi({
      type: 'patch',
      patch: { savingBrokerSecret: true, actionError: null, brokerSecretNotice: null },
    });
    try {
      await patchTunnelConfig({ registrationSecret: null });
      dispatchUi({
        type: 'patch',
        patch: { brokerSecretDraft: '', brokerSecretNotice: t.brokerSecretCleared },
      });
      void revalidateGatewayConfig();
      await mutStatus();
    } catch (e) {
      dispatchUi({
        type: 'patch',
        patch: { actionError: e instanceof Error ? e.message : String(e) },
      });
    } finally {
      dispatchUi({ type: 'patch', patch: { savingBrokerSecret: false } });
    }
  }, [mutStatus, t.brokerSecretCleared]);

  const handleRelease = useCallback(async () => {
    dispatchUi({ type: 'patch', patch: { releaseConfirmOpen: false, actionError: null, releasing: true } });
    try {
      await stopTunnel({ release: true });
      await Promise.all([pairQr.refreshQr(), mutStatus()]);
      void revalidateGatewayConfig();
    } catch (e) {
      dispatchUi({
        type: 'patch',
        patch: { actionError: e instanceof Error ? e.message : String(e) },
      });
    } finally {
      dispatchUi({ type: 'patch', patch: { releasing: false } });
    }
  }, [mutStatus, pairQr.refreshQr]);

  const copyLabels = useMemo(
    () => ({
      copy: t.copyUrl,
      copied: t.copied,
      copyFailed: messages(language).clipboard.copyFailed,
    }),
    [language, t.copyUrl, t.copied],
  );

  if (!hasToken) {
    return (
      <div className={embedded ? undefined : 'w-full px-3 py-8 sm:px-5 xl:px-6'}>
        <p className="text-sm text-fg-muted">{t.needToken}</p>
      </div>
    );
  }

  const st = status ?? {
    enabled: false,
    state: 'disconnected' as const,
    subdomain: null,
    publicUrl: null,
    connectedSince: null,
    frpcPid: null,
    lastHeartbeatAt: null,
    lastError: null,
    consentRequired: true,
    config: { autoStart: autoStartEnabled, brokerUrl: 'https://frp.xopc.ai/api' },
  };

  const showConsentExpired =
    status?.consentRequired && (st.enabled || autoStartEnabled || status?.consent?.acceptedAt);

  const brokerSecretBlock = (
    <BrokerSecretSetupSection
      t={t}
      brokerSecretFromEnv={brokerSecretFromEnv}
      brokerSecretMissing={brokerSecretMissing}
      brokerSecretConfiguredInConfig={brokerSecretConfiguredInConfig}
      brokerSecretMaskedValue={brokerSecretConfiguredInConfig ? brokerSecretFromConfig : ''}
      brokerSecretDraft={brokerSecretDraft}
      savingBrokerSecret={savingBrokerSecret}
      brokerSecretNotice={brokerSecretNotice}
      copyFailedLabel={messages(language).clipboard.copyFailed}
      onDraftChange={(value) => dispatchUi({ type: 'patch', patch: { brokerSecretDraft: value } })}
      onSave={() => void saveBrokerSecret()}
      onClear={() => void clearBrokerSecret()}
      sectionRef={brokerSecretSectionRef}
    />
  );

  const dialogs = (
    <>
      <TunnelConsentDialog
        key={consentOpen ? 'consent-open' : 'consent-closed'}
        open={consentOpen}
        title={t.consentTitle}
        intro={t.consentIntro}
        bullets={consentBullets}
        checkboxLabel={t.consentCheckbox}
        confirmLabel={showConsentExpired ? t.consentReconfirm : t.consentConfirm}
        cancelLabel={t.consentCancel}
        onConfirm={() => void handleConsentConfirm()}
        onCancel={() => dispatchUi({ type: 'patch', patch: { consentOpen: false } })}
      />

      <ConfirmDialog
        open={autoStartConfirmOpen}
        title={t.autoStartConfirmTitle}
        description={t.autoStartConfirmBody}
        confirmLabel={t.autoStartConfirmLabel}
        cancelLabel={t.consentCancel}
        onConfirm={() => {
          dispatchUi({ type: 'patch', patch: { autoStartConfirmOpen: false } });
          void applyAutoStart(true);
        }}
        onCancel={() => dispatchUi({ type: 'patch', patch: { autoStartConfirmOpen: false } })}
      />

      <ConfirmDialog
        open={releaseConfirmOpen}
        title={t.releaseConfirmTitle}
        description={t.releaseConfirmBody}
        confirmLabel={t.releaseConfirmLabel}
        cancelLabel={t.consentCancel}
        destructive
        onConfirm={() => void handleRelease()}
        onCancel={() => dispatchUi({ type: 'patch', patch: { releaseConfirmOpen: false } })}
      />
    </>
  );

  if (embedded) {
    return (
      <div className="flex w-full flex-col gap-4">
        {actionError ? <p className="text-sm text-red-600 dark:text-red-400">{actionError}</p> : null}

        {brokerSecretBlock}

        <TunnelControlCard
          t={t}
          status={st}
          isLoading={isLoading}
          statusErr={statusErr}
          starting={starting}
          stopping={stopping}
          showConsentExpired={Boolean(showConsentExpired)}
          copyLabels={copyLabels}
          startDisabled={!brokerReady}
          startDisabledReason={!brokerReady ? t.brokerSecretRequiredBeforeStart : undefined}
          stepLabel={t.flowStepStart}
          onStart={handleStartClick}
          onStop={() => void handleStop()}
        />

        <MobilePairQrSection
          pairQr={pairQr}
          gatewayToken={token ?? ''}
          streamlined
          onRefreshQr={() => void pairQr.refreshQr()}
        />

        <SettingsCollapsibleSection showLabel={t.showOptions} hideLabel={t.hideOptions}>
          <label
            className={cn(
              'flex items-center gap-3 text-sm text-fg',
              !autoStartEnabled && !status?.canAutoStart ? 'cursor-not-allowed opacity-60' : 'cursor-pointer',
            )}
          >
            <input
              type="checkbox"
              className="size-4 rounded border-edge accent-accent"
              checked={autoStartEnabled}
              disabled={savingAutoStart || (!autoStartEnabled && !status?.canAutoStart)}
              onChange={toggleAutoStart}
            />
            {t.autoStart}
          </label>
          {!status?.canAutoStart && !autoStartEnabled ? (
            <p className="text-xs text-fg-subtle">{t.autoStartHint}</p>
          ) : null}

          {st.subdomain || st.publicUrl ? (
            <div className="space-y-2 border-t border-edge-subtle pt-4">
              <Button
                type="button"
                variant="secondary"
                disabled={releasing || stopping}
                className="border-danger/40 text-danger hover:bg-danger/10"
                onClick={() => dispatchUi({ type: 'patch', patch: { releaseConfirmOpen: true } })}
              >
                {releasing ? <Loader2 className="size-4 animate-spin" /> : null}
                {t.release}
              </Button>
              <p className="text-xs text-fg-subtle">{t.releaseHint}</p>
            </div>
          ) : null}
        </SettingsCollapsibleSection>

        <SettingsCollapsibleSection showLabel={t.showAdvanced} hideLabel={t.hideAdvanced}>
          <div className="flex flex-col gap-2 border-t border-edge-subtle pt-4 text-xs text-fg-subtle">
            <p className="flex items-start gap-2">
              <Globe className="mt-0.5 size-4 shrink-0 text-accent" />
              <span>{t.brokerNote}</span>
            </p>
            <RemoteAccessDocsLink
              language={language}
              label={t.brokerDocsLink}
              section="public-tunnel"
              className="text-xs"
            />
          </div>
        </SettingsCollapsibleSection>

        {dialogs}
      </div>
    );
  }

  return (
    <div
      className={
        embedded
          ? 'flex w-full flex-col gap-6'
          : 'flex w-full flex-col gap-6 px-3 py-8 sm:px-5 xl:px-6'
      }
    >
      {!embedded ? (
        <div>
          <h1 className="text-lg font-semibold text-fg">{t.title}</h1>
          <p className="mt-1 text-sm text-fg-muted">{t.subtitle}</p>
        </div>
      ) : null}

      {actionError ? <p className="text-sm text-red-600 dark:text-red-400">{actionError}</p> : null}

      {brokerSecretBlock}

      <TunnelControlCard
        t={t}
        status={st}
        isLoading={isLoading}
        statusErr={statusErr}
        starting={starting}
        stopping={stopping}
        showConsentExpired={Boolean(showConsentExpired)}
        copyLabels={copyLabels}
        startDisabled={!brokerReady}
        startDisabledReason={!brokerReady ? t.brokerSecretRequiredBeforeStart : undefined}
        onStart={handleStartClick}
        onStop={() => void handleStop()}
      />

      <MobilePairQrSection pairQr={pairQr} gatewayToken={token ?? ''} />

      {st.subdomain || st.publicUrl ? (
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="secondary"
            disabled={releasing || stopping}
            className="border-danger/40 text-danger hover:bg-danger/10"
            onClick={() => dispatchUi({ type: 'patch', patch: { releaseConfirmOpen: true } })}
          >
            {releasing ? <Loader2 className="size-4 animate-spin" /> : null}
            {t.release}
          </Button>
        </div>
      ) : null}

      {st.subdomain || st.publicUrl ? (
        <p className="text-xs text-fg-subtle">{t.releaseHint}</p>
      ) : null}

      <SettingsFormSection>
        <h2 className="mb-3 text-sm font-semibold text-fg">{t.optionsTitle}</h2>
        <label
          className={cn(
            'flex items-center gap-3 text-sm text-fg',
            !autoStartEnabled && !status?.canAutoStart ? 'cursor-not-allowed opacity-60' : 'cursor-pointer',
          )}
        >
          <input
            type="checkbox"
            className="size-4 rounded border-edge accent-accent"
            checked={autoStartEnabled}
            disabled={savingAutoStart || (!autoStartEnabled && !status?.canAutoStart)}
            onChange={toggleAutoStart}
          />
          {t.autoStart}
        </label>
        {!status?.canAutoStart && !autoStartEnabled ? (
          <p className="mt-2 text-xs text-fg-subtle">{t.autoStartHint}</p>
        ) : null}
      </SettingsFormSection>

      <div className="flex flex-col gap-2 rounded-lg bg-surface-panel/80 px-3 py-2 text-xs text-fg-subtle shadow-surface">
        <p className="flex items-start gap-2">
          <Globe className="mt-0.5 size-4 shrink-0 text-accent" />
          <span>{t.brokerNote}</span>
        </p>
        <RemoteAccessDocsLink
          language={language}
          label={t.brokerDocsLink}
          section="public-tunnel"
          className="text-xs"
        />
      </div>

      {dialogs}
    </div>
  );
}
