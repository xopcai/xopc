import { useCallback, useEffect, useMemo, useState } from 'react';
import useSWR, { useSWRConfig } from 'swr';

import { fetchTunnelQr, fetchTunnelStatus, type TunnelQrResponse, type TunnelStatusResponse } from '@/features/tunnel/tunnel-api';
import { encodeMobilePairQr } from '@/features/tunnel/mobile-pair-qr';
import {
  buildMobileGatewayPairDeepLink,
  getBaseUrl,
  isLoopbackHttpOrigin,
} from '@/lib/url';

export type MobilePairQrState = {
  tunnelActive: boolean;
  tunnelStatus: TunnelStatusResponse | undefined;
  tunnelQr: TunnelQrResponse | undefined;
  pairBaseUrl: string;
  setPairBaseUrl: (value: string) => void;
  baseOk: boolean;
  localhostWarn: boolean;
  deepLink: string;
  qrPayload: string;
  qrDataUrl: string | null;
  qrGenFailed: boolean;
  encoding: boolean;
  linkCopied: boolean;
  copyDeepLink: () => Promise<void>;
  refreshQr: (payload?: string) => Promise<void>;
};

export function useMobilePairQr(gatewayToken: string): MobilePairQrState {
  const hasToken = Boolean(gatewayToken);
  const { mutate: globalMutate } = useSWRConfig();

  const { data: tunnelStatus } = useSWR(hasToken ? 'tunnel-status' : null, fetchTunnelStatus, {
    refreshInterval: 60_000,
  });

  useEffect(() => {
    const onTunnelStatus = () => {
      void globalMutate('tunnel-status');
      void globalMutate('tunnel-qr');
    };
    window.addEventListener('tunnel-status', onTunnelStatus);
    return () => window.removeEventListener('tunnel-status', onTunnelStatus);
  }, [globalMutate]);

  const tunnelActive =
    tunnelStatus?.state === 'connected' && Boolean(tunnelStatus.publicUrl?.trim());

  const { data: tunnelQr, mutate: mutTunnelQr } = useSWR(
    tunnelActive && hasToken ? 'tunnel-qr' : null,
    fetchTunnelQr,
    { refreshInterval: 15_000 },
  );

  const [pairBaseUrl, setPairBaseUrl] = useState(getBaseUrl);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [qrGenFailed, setQrGenFailed] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);
  const [manualPayload, setManualPayload] = useState('');

  const trimmedBase = pairBaseUrl.trim();
  const baseOk = useMemo(() => {
    try {
      const u = new URL(trimmedBase);
      return u.protocol === 'http:' || u.protocol === 'https:';
    } catch {
      return false;
    }
  }, [trimmedBase]);

  const deepLink = useMemo(() => {
    if (!gatewayToken) return '';
    if (manualPayload.trim()) return manualPayload.trim();
    if (tunnelActive && tunnelQr?.qrPayload?.trim()) {
      return tunnelQr.qrPayload.trim();
    }
    if (!baseOk) return '';
    return buildMobileGatewayPairDeepLink({
      baseUrl: trimmedBase,
      gatewayToken,
      lanUrl: null,
    });
  }, [baseOk, gatewayToken, manualPayload, trimmedBase, tunnelActive, tunnelQr?.qrPayload]);

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
        void mutTunnelQr({ qrPayload: payload.trim(), publicUrl: tunnelStatus?.publicUrl ?? '', lanUrl: tunnelQr?.lanUrl ?? null }, false);
        return;
      }
      setManualPayload('');
      if (tunnelActive) {
        await mutTunnelQr();
      }
    },
    [mutTunnelQr, tunnelActive, tunnelQr?.lanUrl, tunnelStatus?.publicUrl],
  );

  const localhostWarn = baseOk && isLoopbackHttpOrigin(trimmedBase);
  const encoding = Boolean(deepLink && !qrDataUrl && !qrGenFailed);

  const copyDeepLink = useCallback(async () => {
    if (!deepLink) return;
    await navigator.clipboard.writeText(deepLink).catch(() => {});
    setLinkCopied(true);
    window.setTimeout(() => setLinkCopied(false), 2000);
  }, [deepLink]);

  return {
    tunnelActive,
    tunnelStatus,
    tunnelQr,
    pairBaseUrl,
    setPairBaseUrl,
    baseOk,
    localhostWarn,
    deepLink,
    qrPayload: deepLink,
    qrDataUrl,
    qrGenFailed,
    encoding,
    linkCopied,
    copyDeepLink,
    refreshQr,
  };
}
