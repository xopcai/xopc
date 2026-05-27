import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import useSWR, { useSWRConfig } from 'swr';

import {
  createTunnelPair,
  fetchTunnelPairContext,
  fetchTunnelQr,
  fetchTunnelStatus,
  type MobilePairContextResponse,
  type TunnelQrResponse,
  type TunnelStatusResponse,
} from '@/features/tunnel/tunnel-api';
import { encodeMobilePairQr } from '@/features/tunnel/mobile-pair-qr';
import { buildMobileGatewayPairDeepLink, isLoopbackHttpOrigin } from '@/lib/url';

function pickLanCandidateUrl(context?: MobilePairContextResponse): string {
  const candidates = context?.candidates ?? [];
  const reachable = candidates.find((c) => c.kind === 'lan' && c.reachable);
  const anyLan = candidates.find((c) => c.kind === 'lan');
  return (reachable ?? anyLan)?.url?.trim() ?? '';
}

function isTunnelCandidateUrl(context: MobilePairContextResponse | undefined, url: string): boolean {
  const trimmed = url.trim();
  if (!trimmed || !context) return false;
  return context.candidates.some((c) => c.kind === 'tunnel' && c.url.trim() === trimmed);
}

function resolveSuggestedPairBaseUrl(
  context: MobilePairContextResponse | undefined,
  preferLan: boolean,
): string {
  if (!context) return '';
  if (preferLan) {
    return pickLanCandidateUrl(context) || context.recommended.url?.trim() || '';
  }
  return context.recommended.url?.trim() || '';
}

export type MobilePairQrState = {
  tunnelActive: boolean;
  tunnelStatus: TunnelStatusResponse | undefined;
  tunnelQr: TunnelQrResponse | undefined;
  pairContext: MobilePairContextResponse | undefined;
  pairBaseUrl: string;
  setPairBaseUrl: (value: string) => void;
  applySuggestedPairUrl: () => void;
  applyCandidateUrl: (url: string) => void;
  baseOk: boolean;
  localhostWarn: boolean;
  pairingBlocked: boolean;
  deepLink: string;
  qrPayload: string;
  qrDataUrl: string | null;
  qrGenFailed: boolean;
  encoding: boolean;
  refreshQr: (payload?: string) => Promise<void>;
  resetPairBaseFromContext: (url?: string | null) => void;
};

export type UseMobilePairQrOptions = {
  /** Prefer LAN pairing QR even when a public tunnel is connected. */
  preferLan?: boolean;
};

export function useMobilePairQr(
  gatewayToken: string,
  options?: UseMobilePairQrOptions,
): MobilePairQrState {
  const preferLan = options?.preferLan === true;
  const hasToken = Boolean(gatewayToken);
  const { mutate: globalMutate } = useSWRConfig();
  const userEditedBaseRef = useRef(false);

  const { data: tunnelStatus } = useSWR(hasToken ? 'tunnel-status' : null, fetchTunnelStatus, {
    refreshInterval: 60_000,
  });

  const { data: pairContext, mutate: mutPairContext } = useSWR(
    hasToken ? 'tunnel-pair-context' : null,
    fetchTunnelPairContext,
    { refreshInterval: 60_000 },
  );

  useEffect(() => {
    const onTunnelStatus = () => {
      void globalMutate('tunnel-status');
      void globalMutate('tunnel-qr');
      void globalMutate('tunnel-pair');
      void globalMutate('tunnel-pair-context');
    };
    window.addEventListener('tunnel-status', onTunnelStatus);
    return () => window.removeEventListener('tunnel-status', onTunnelStatus);
  }, [globalMutate]);

  const tunnelActive =
    tunnelStatus?.state === 'connected' && Boolean(tunnelStatus.publicUrl?.trim());
  const useTunnelQr = tunnelActive && !preferLan;

  const { data: tunnelQr, mutate: mutTunnelQr } = useSWR(
    useTunnelQr && hasToken ? 'tunnel-qr' : null,
    fetchTunnelQr,
    { refreshInterval: 4 * 60_000 },
  );

  const { data: lanPair, mutate: mutLanPair } = useSWR(
    !useTunnelQr && hasToken && pairContext?.pairingReady ? 'tunnel-pair' : null,
    createTunnelPair,
    { refreshInterval: 4 * 60_000 },
  );

  const [pairBaseUrl, setPairBaseUrlState] = useState('');
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [qrGenFailed, setQrGenFailed] = useState(false);
  const [manualPayload, setManualPayload] = useState('');

  const setPairBaseUrl = useCallback((value: string) => {
    userEditedBaseRef.current = true;
    setPairBaseUrlState(value);
  }, []);

  useEffect(() => {
    if (userEditedBaseRef.current || !pairContext) return;
    const suggested = resolveSuggestedPairBaseUrl(pairContext, preferLan);
    if (suggested) {
      setPairBaseUrlState(suggested);
      return;
    }
    setPairBaseUrlState('');
  }, [pairContext, preferLan]);

  const applySuggestedPairUrl = useCallback(() => {
    const suggested = resolveSuggestedPairBaseUrl(pairContext, preferLan);
    if (!suggested) return;
    userEditedBaseRef.current = true;
    setPairBaseUrlState(suggested);
  }, [pairContext, preferLan]);

  const applyCandidateUrl = useCallback((url: string) => {
    const trimmed = url.trim();
    if (!trimmed) return;
    userEditedBaseRef.current = true;
    setPairBaseUrlState(trimmed);
  }, []);

  const resetPairBaseFromContext = useCallback(
    (url?: string | null) => {
      userEditedBaseRef.current = false;
      const suggested =
        url?.trim() || resolveSuggestedPairBaseUrl(pairContext, preferLan);
      setPairBaseUrlState(suggested);
    },
    [pairContext, preferLan],
  );

  const trimmedBase = pairBaseUrl.trim();
  const baseOk = useMemo(() => {
    try {
      const u = new URL(trimmedBase);
      return u.protocol === 'http:' || u.protocol === 'https:';
    } catch {
      return false;
    }
  }, [trimmedBase]);

  const localhostWarn = baseOk && isLoopbackHttpOrigin(trimmedBase);
  const pairingBlocked =
    !useTunnelQr &&
    Boolean(pairContext && !pairContext.pairingReady && pairContext.blockReason === 'GATEWAY_LOOPBACK_ONLY');

  const lanPairReady =
    !useTunnelQr &&
    baseOk &&
    !localhostWarn &&
    Boolean(lanPair?.pairingSecret) &&
    (pairContext?.pairingReady === true || !pairingBlocked);

  const lanBaseUrl = useMemo(() => {
    const fromCandidates = pickLanCandidateUrl(pairContext);
    if (preferLan) {
      if (fromCandidates) return fromCandidates;
      if (trimmedBase && !isTunnelCandidateUrl(pairContext, trimmedBase)) return trimmedBase;
      return '';
    }
    return trimmedBase;
  }, [pairContext, preferLan, trimmedBase]);

  const deepLink = useMemo(() => {
    if (!gatewayToken) return '';
    if (manualPayload.trim()) return manualPayload.trim();
    if (useTunnelQr && tunnelQr?.qrPayload?.trim()) {
      return tunnelQr.qrPayload.trim();
    }
    if (!lanPairReady || !lanPair?.pairingSecret) return '';
    const tunnelCandidate = pairContext?.candidates.find((c) => c.kind === 'tunnel' && c.reachable);
    const lanCandidate = pairContext?.candidates.find((c) => c.kind === 'lan' && c.reachable);
    const baseUrl = preferLan
      ? lanBaseUrl
      : (tunnelCandidate?.url ?? trimmedBase);
    if (!baseUrl) return '';
    return buildMobileGatewayPairDeepLink({
      baseUrl,
      pairingSecret: lanPair.pairingSecret,
      lanUrl: preferLan ? null : (tunnelCandidate && lanCandidate ? lanCandidate.url : null),
    });
  }, [
    gatewayToken,
    lanBaseUrl,
    lanPair?.pairingSecret,
    lanPairReady,
    manualPayload,
    preferLan,
    trimmedBase,
    useTunnelQr,
    tunnelQr?.qrPayload,
    pairContext?.candidates,
  ]);

  useEffect(() => {
    if (!deepLink) {
      setQrDataUrl(null);
      setQrGenFailed(false);
      return;
    }
    let cancelled = false;
    setQrGenFailed(false);
    void encodeMobilePairQr(deepLink)
      .then((url) => {
        if (!cancelled) setQrDataUrl(url);
      })
      .catch(() => {
        if (!cancelled) {
          setQrGenFailed(true);
          setQrDataUrl(null);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [deepLink]);

  const refreshQr = useCallback(
    async (payload?: string) => {
      if (payload?.trim()) {
        setManualPayload(payload.trim());
        void mutTunnelQr(
          { qrPayload: payload.trim(), publicUrl: tunnelStatus?.publicUrl ?? '', lanUrl: tunnelQr?.lanUrl ?? null },
          false,
        );
        return;
      }
      setManualPayload('');
      await mutPairContext();
      if (useTunnelQr) {
        await mutTunnelQr();
      } else if (pairContext?.pairingReady) {
        await mutLanPair();
      }
    },
    [mutLanPair, mutPairContext, mutTunnelQr, pairContext?.pairingReady, tunnelQr?.lanUrl, tunnelStatus?.publicUrl, useTunnelQr],
  );

  const encoding = Boolean(deepLink && !qrDataUrl && !qrGenFailed);

  return {
    tunnelActive,
    tunnelStatus,
    tunnelQr,
    pairContext,
    pairBaseUrl,
    setPairBaseUrl,
    applySuggestedPairUrl,
    applyCandidateUrl,
    baseOk,
    localhostWarn,
    pairingBlocked,
    deepLink,
    qrPayload: deepLink,
    qrDataUrl,
    qrGenFailed,
    encoding,
    refreshQr,
    resetPairBaseFromContext,
  };
}
