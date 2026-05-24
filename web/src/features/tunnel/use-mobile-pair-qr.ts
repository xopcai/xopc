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
import { copyTextToClipboard } from '@/lib/copy-to-clipboard';

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
  linkCopied: boolean;
  copyDeepLink: () => Promise<void>;
  refreshQr: (payload?: string) => Promise<void>;
  resetPairBaseFromContext: (url?: string | null) => void;
};

export function useMobilePairQr(gatewayToken: string): MobilePairQrState {
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

  const { data: tunnelQr, mutate: mutTunnelQr } = useSWR(
    tunnelActive && hasToken ? 'tunnel-qr' : null,
    fetchTunnelQr,
    { refreshInterval: 4 * 60_000 },
  );

  const { data: lanPair, mutate: mutLanPair } = useSWR(
    !tunnelActive && hasToken && pairContext?.pairingReady ? 'tunnel-pair' : null,
    createTunnelPair,
    { refreshInterval: 4 * 60_000 },
  );

  const [pairBaseUrl, setPairBaseUrlState] = useState('');
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [qrGenFailed, setQrGenFailed] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);
  const [manualPayload, setManualPayload] = useState('');

  const setPairBaseUrl = useCallback((value: string) => {
    userEditedBaseRef.current = true;
    setPairBaseUrlState(value);
  }, []);

  useEffect(() => {
    if (userEditedBaseRef.current || !pairContext) return;
    const suggested = pairContext.recommended.url?.trim();
    if (suggested) {
      setPairBaseUrlState(suggested);
      return;
    }
    setPairBaseUrlState('');
  }, [pairContext]);

  const applySuggestedPairUrl = useCallback(() => {
    const suggested = pairContext?.recommended.url?.trim();
    if (!suggested) return;
    userEditedBaseRef.current = true;
    setPairBaseUrlState(suggested);
  }, [pairContext?.recommended.url]);

  const applyCandidateUrl = useCallback((url: string) => {
    const trimmed = url.trim();
    if (!trimmed) return;
    userEditedBaseRef.current = true;
    setPairBaseUrlState(trimmed);
  }, []);

  const resetPairBaseFromContext = useCallback((url?: string | null) => {
    userEditedBaseRef.current = false;
    const suggested = url?.trim() || pairContext?.recommended.url?.trim();
    setPairBaseUrlState(suggested ?? '');
  }, [pairContext?.recommended.url]);

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
    !tunnelActive &&
    Boolean(pairContext && !pairContext.pairingReady && pairContext.blockReason === 'GATEWAY_LOOPBACK_ONLY');

  const lanPairReady =
    !tunnelActive &&
    baseOk &&
    !localhostWarn &&
    Boolean(lanPair?.pairingSecret) &&
    (pairContext?.pairingReady === true || !pairingBlocked);

  const deepLink = useMemo(() => {
    if (!gatewayToken) return '';
    if (manualPayload.trim()) return manualPayload.trim();
    if (tunnelActive && tunnelQr?.qrPayload?.trim()) {
      return tunnelQr.qrPayload.trim();
    }
    if (!lanPairReady || !lanPair?.pairingSecret) return '';
    const tunnelCandidate = pairContext?.candidates.find((c) => c.kind === 'tunnel' && c.reachable);
    const lanCandidate = pairContext?.candidates.find((c) => c.kind === 'lan' && c.reachable);
    return buildMobileGatewayPairDeepLink({
      baseUrl: tunnelCandidate?.url ?? trimmedBase,
      pairingSecret: lanPair.pairingSecret,
      lanUrl: tunnelCandidate && lanCandidate ? lanCandidate.url : null,
    });
  }, [
    gatewayToken,
    lanPair?.pairingSecret,
    lanPairReady,
    manualPayload,
    trimmedBase,
    tunnelActive,
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
      if (tunnelActive) {
        await mutTunnelQr();
      } else if (pairContext?.pairingReady) {
        await mutLanPair();
      }
    },
    [mutLanPair, mutPairContext, mutTunnelQr, pairContext?.pairingReady, tunnelActive, tunnelQr?.lanUrl, tunnelStatus?.publicUrl],
  );

  const encoding = Boolean(deepLink && !qrDataUrl && !qrGenFailed);

  const copyDeepLink = useCallback(async () => {
    if (!deepLink) return;
    const ok = await copyTextToClipboard(deepLink);
    if (!ok) return;
    setLinkCopied(true);
    window.setTimeout(() => setLinkCopied(false), 2000);
  }, [deepLink]);

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
    linkCopied,
    copyDeepLink,
    refreshQr,
    resetPairBaseFromContext,
  };
}
