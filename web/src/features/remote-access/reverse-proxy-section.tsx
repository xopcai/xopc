import { Globe, Loader2, RefreshCw } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import useSWR, { useSWRConfig } from 'swr';

import { Button } from '@/components/ui/button';
import { CopyTextRow } from '@/components/ui/copy-text-row';
import {
  SettingsFormSection,
  SettingsFormSectionHeader,
} from '@/features/settings/settings-form-section';
import { encodeMobilePairQr } from '@/features/tunnel/mobile-pair-qr';
import {
  createTunnelPair,
  fetchTunnelPairContext,
  type MobilePairContextResponse,
} from '@/features/tunnel/tunnel-api';
import {
  patchReverseProxyPublicUrl,
  probeReverseProxyUrl,
  type ProbeReverseProxyResponse,
} from '@/features/remote-access/reverse-proxy-api';
import { useDetectedReverseProxyOrigin } from '@/features/remote-access/use-detected-reverse-proxy-origin';
import { useAsyncResource } from '@/lib/use-async-resource';
import { settingsInputFocusClass } from '@/lib/form-field-width';
import { buildMobileGatewayPairDeepLink } from '@/lib/url';
import { cn } from '@/lib/cn';
import { messages } from '@/i18n/messages';
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

function pickReverseProxyCandidateUrl(context?: MobilePairContextResponse): string | null {
  const hit = context?.candidates.find((c) => c.kind === 'reverse-proxy');
  return hit?.url?.trim() || null;
}

function pickLanFallback(context?: MobilePairContextResponse): string | null {
  const lan = context?.candidates.find((c) => c.kind === 'lan' && c.reachable);
  return lan?.url?.trim() || null;
}

export function ReverseProxySection() {
  const language = useLocaleStore((s) => s.language);
  const rp = messages(language).remoteAccess.reverseProxy;
  const token = useGatewayStore((s) => s.token);
  const hasToken = Boolean(token);
  const detected = useDetectedReverseProxyOrigin();
  const { mutate: globalMutate } = useSWRConfig();

  const { data: pairContext, mutate: mutPairContext } = useSWR(
    hasToken ? 'tunnel-pair-context' : null,
    fetchTunnelPairContext,
    { refreshInterval: 60_000 },
  );

  const configuredUrl = pickReverseProxyCandidateUrl(pairContext);
  // Effective URL the QR will use, in priority order: user override, server config, detected.
  const [draftUrl, setDraftUrl] = useState<string>('');
  const [probeState, setProbeState] = useState<{
    busy: boolean;
    result: ProbeReverseProxyResponse | null;
  }>({ busy: false, result: null });
  const [savingState, setSavingState] = useState<{ busy: boolean; error: string | null }>({
    busy: false,
    error: null,
  });

  // Initialize draftUrl from configured value on first load; otherwise auto-detected.
  useEffect(() => {
    if (draftUrl) return;
    if (configuredUrl) {
      setDraftUrl(configuredUrl);
    } else if (detected) {
      setDraftUrl(detected);
    }
  }, [configuredUrl, detected, draftUrl]);

  const effectiveUrl = useMemo(() => {
    const v = draftUrl.trim();
    if (v) return v;
    return configuredUrl ?? detected ?? '';
  }, [configuredUrl, detected, draftUrl]);

  const isAutoDetectedOnly = !configuredUrl && Boolean(detected) && effectiveUrl === detected;
  const lanFallback = pickLanFallback(pairContext);

  // Mint a pairing secret once we have a URL and a gateway token.
  const { data: pair, mutate: mutPair } = useSWR(
    hasToken && effectiveUrl ? ['reverse-proxy-pair', effectiveUrl] : null,
    () => createTunnelPair(),
    { refreshInterval: 4 * 60_000, revalidateOnFocus: false },
  );

  const deepLink = useMemo(() => {
    if (!effectiveUrl || !pair?.pairingSecret) return '';
    return buildMobileGatewayPairDeepLink({
      baseUrl: effectiveUrl,
      pairingSecret: pair.pairingSecret,
      lanUrl: lanFallback,
    });
  }, [effectiveUrl, lanFallback, pair?.pairingSecret]);

  const qrImage = useAsyncResource(
    () => encodeMobilePairQr(deepLink),
    [deepLink],
    { enabled: Boolean(deepLink), initial: null as string | null, errorData: null },
  );

  const handleProbe = useCallback(async () => {
    const url = draftUrl.trim() || effectiveUrl;
    if (!url) return;
    setProbeState({ busy: true, result: null });
    try {
      const result = await probeReverseProxyUrl(url);
      setProbeState({ busy: false, result });
    } catch (error) {
      setProbeState({
        busy: false,
        result: {
          ok: false,
          code: 'NETWORK_ERROR',
          message: error instanceof Error ? error.message : String(error),
        },
      });
    }
  }, [draftUrl, effectiveUrl]);

  const handleSaveAsDefault = useCallback(async () => {
    const url = effectiveUrl.trim();
    if (!url) return;
    setSavingState({ busy: true, error: null });
    try {
      await patchReverseProxyPublicUrl(url);
      await mutPairContext();
      await globalMutate('tunnel-pair-context');
      setSavingState({ busy: false, error: null });
    } catch (error) {
      setSavingState({
        busy: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }, [effectiveUrl, globalMutate, mutPairContext]);

  const handleClear = useCallback(async () => {
    setSavingState({ busy: true, error: null });
    try {
      await patchReverseProxyPublicUrl(null);
      await mutPairContext();
      await globalMutate('tunnel-pair-context');
      setDraftUrl('');
      setProbeState({ busy: false, result: null });
      setSavingState({ busy: false, error: null });
    } catch (error) {
      setSavingState({
        busy: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }, [globalMutate, mutPairContext]);

  const handleRefreshQr = useCallback(async () => {
    await mutPair();
  }, [mutPair]);

  if (!hasToken) {
    return null;
  }

  return (
    <div className="flex flex-col gap-4">
      <SettingsFormSection>
        <SettingsFormSectionHeader icon={Globe} title={rp.title} subtitle={rp.subtitle} />

        <div className="mt-4 space-y-3">
          <label className="text-sm font-medium text-fg" htmlFor="reverse-proxy-url">
            {rp.urlLabel}
          </label>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-stretch">
            <input
              id="reverse-proxy-url"
              className={cn(inputClassName(), 'font-mono text-xs sm:flex-1 sm:min-w-0 sm:w-auto')}
              type="text"
              autoComplete="off"
              spellCheck={false}
              placeholder={rp.urlPlaceholder}
              value={draftUrl}
              onChange={(e) => {
                setDraftUrl(e.target.value);
                setProbeState({ busy: false, result: null });
              }}
            />
            <Button
              type="button"
              variant="secondary"
              className="shrink-0 whitespace-nowrap"
              onClick={() => void handleProbe()}
              disabled={probeState.busy || !draftUrl.trim()}
            >
              {probeState.busy ? <Loader2 className="size-3.5 animate-spin" /> : null}
              {probeState.busy ? rp.probing : rp.probeButton}
            </Button>
          </div>
          <p className="text-xs text-fg-subtle">{rp.urlHint}</p>

          {isAutoDetectedOnly && detected ? (
            <div className="rounded-lg border border-accent/40 bg-accent-soft/50 px-3 py-2 text-xs leading-relaxed text-accent-fg">
              <div className="font-medium">{rp.autoDetectedTitle}</div>
              <div className="mt-1 break-all font-mono text-[11px]">{detected}</div>
              <p className="mt-1">{rp.autoDetectedHint}</p>
            </div>
          ) : null}

          {probeState.result ? (
            <ProbeResultPill
              result={probeState.result}
              labels={rp.probeStatus}
            />
          ) : null}

          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
            {effectiveUrl && (configuredUrl !== effectiveUrl) ? (
              <Button
                type="button"
                onClick={() => void handleSaveAsDefault()}
                disabled={savingState.busy}
              >
                {savingState.busy ? <Loader2 className="size-3.5 animate-spin" /> : null}
                {savingState.busy ? rp.saving : rp.saveAsDefault}
              </Button>
            ) : null}
            {configuredUrl ? (
              <Button
                type="button"
                variant="ghost"
                onClick={() => void handleClear()}
                disabled={savingState.busy}
              >
                {rp.clear}
              </Button>
            ) : null}
          </div>
          {savingState.error ? (
            <p className="text-xs text-red-800 dark:text-red-200">{savingState.error}</p>
          ) : null}

          <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-950 dark:border-amber-800/60 dark:bg-amber-950/30 dark:text-amber-100">
            {rp.certWarning}
          </div>
        </div>
      </SettingsFormSection>

      <SettingsFormSection>
        <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
          <div>
            <div className="flex items-center gap-2 text-sm font-semibold text-fg">{rp.qrTitle}</div>
            <p className="mt-1 text-xs text-fg-subtle">{rp.qrSubtitle}</p>
          </div>
          {deepLink ? (
            <Button type="button" variant="ghost" className="shrink-0" onClick={() => void handleRefreshQr()}>
              <RefreshCw className="size-4" />
              {rp.refreshQr}
            </Button>
          ) : null}
        </div>

        {!effectiveUrl ? (
          <p className="text-sm text-fg-muted">{rp.noUrlYet}</p>
        ) : !pair?.pairingSecret ? (
          <p className="text-sm text-fg-muted">{rp.mintingSecret}</p>
        ) : (
          <div className="flex flex-col items-center gap-3 sm:items-start">
            <div className="break-all font-mono text-[11px] text-fg-muted">
              <span className="font-medium text-fg">baseUrl:</span> {effectiveUrl}
              {lanFallback ? (
                <>
                  <br />
                  <span className="font-medium text-fg">lanUrl:</span> {lanFallback}
                </>
              ) : null}
            </div>
            {qrImage.data ? (
              <img
                src={qrImage.data}
                alt=""
                className="size-56 rounded-lg border border-edge-subtle bg-white object-contain p-3 dark:border-edge"
              />
            ) : qrImage.loading ? (
              <p className="text-sm text-fg-muted">{rp.encoding}</p>
            ) : null}
            <CopyTextRow
              text={deepLink}
              labels={{
                copy: rp.copyLink,
                copied: rp.copied,
                copyFailed: messages(language).clipboard.copyFailed,
              }}
            />
          </div>
        )}
      </SettingsFormSection>
    </div>
  );
}

type ProbeStatusLabels = {
  ok: string;
  mobileReady: string;
  codeUnknown: string;
  [code: `code_${string}`]: string;
};

function ProbeResultPill({
  result,
  labels,
}: {
  result: ProbeReverseProxyResponse;
  labels: ProbeStatusLabels;
}) {
  if (result.ok) {
    return (
      <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-900 dark:border-emerald-800/60 dark:bg-emerald-950/30 dark:text-emerald-100">
        <span className="font-medium">{labels.ok}</span>
        {' · '}
        <span className="font-mono">{result.latencyMs}ms</span>
        {result.mobilePairing ? (
          <>
            {' · '}
            <span>{labels.mobileReady}</span>
          </>
        ) : null}
      </div>
    );
  }
  const key = `code_${result.code}` as const;
  const codeLabel = (labels as Record<string, string>)[key] ?? labels.codeUnknown;
  return (
    <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-900 dark:border-red-800/60 dark:bg-red-950/30 dark:text-red-100">
      <span className="font-medium">{codeLabel}</span>
      {result.message ? (
        <>
          {' — '}
          <span className="font-mono break-all">{result.message}</span>
        </>
      ) : null}
    </div>
  );
}
