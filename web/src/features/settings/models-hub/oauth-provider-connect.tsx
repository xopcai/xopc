import { CheckCircle2, Cloud, Loader2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import { isElectron } from '@/lib/electron-env';
import { useLocaleStore } from '@/stores/locale-store';
import {
  cleanupOAuthSession,
  fetchOAuthSessionStatus,
  startAsyncOAuthLogin,
} from '@/features/settings/oauth-api';

import { revalidateModelsHubCaches } from './models-hub-cache';

export function OAuthProviderConnect({
  providerId,
  displayName,
  connected,
  onConnected,
}: {
  providerId: string;
  displayName: string;
  connected: boolean;
  onConnected?: () => void;
}) {
  const language = useLocaleStore((state) => state.language);
  const zh = language === 'zh';
  const [status, setStatus] = useState<'idle' | 'waiting' | 'connected'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [authorizationUrl, setAuthorizationUrl] = useState<string | null>(null);
  const cancelledRef = useRef(false);
  const popupRef = useRef<Window | null>(null);

  useEffect(() => () => {
    cancelledRef.current = true;
    popupRef.current?.close();
    popupRef.current = null;
  }, []);

  const connect = async () => {
    cancelledRef.current = false;
    setError(null);
    setAuthorizationUrl(null);
    setStatus('waiting');
    const electron = isElectron();
    if (!electron) {
      popupRef.current?.close();
      popupRef.current = window.open('about:blank', 'xopc-oauth');
      if (popupRef.current) popupRef.current.opener = null;
    }
    let sessionId: string | null = null;
    let openedUrl: string | null = null;
    try {
      sessionId = (await startAsyncOAuthLogin(providerId)).sessionId;
      while (!cancelledRef.current) {
        await new Promise((resolve) => window.setTimeout(resolve, 1_000));
        if (cancelledRef.current) return;
        const current = await fetchOAuthSessionStatus(sessionId);
        if (current.authUrl && current.authUrl !== openedUrl) {
          openedUrl = current.authUrl;
          setAuthorizationUrl(current.authUrl);
          if (electron) {
            const result = await window.electronAPI?.shell?.openExternalUrl(current.authUrl);
            if (!result?.ok) throw new Error(result?.error ?? 'Could not open the system browser.');
          } else if (popupRef.current && !popupRef.current.closed) {
            popupRef.current.location.replace(current.authUrl);
          }
        }
        if (current.status === 'failed' || current.status === 'cancelled') {
          throw new Error(current.error ?? current.message ?? 'OAuth authorization failed');
        }
        if (current.status !== 'completed') continue;
        await revalidateModelsHubCaches();
        popupRef.current?.close();
        popupRef.current = null;
        setStatus('connected');
        onConnected?.();
        return;
      }
    } catch (cause) {
      popupRef.current?.close();
      popupRef.current = null;
      if (!cancelledRef.current) {
        setStatus('idle');
        setError(cause instanceof Error ? cause.message : (zh ? '连接失败' : 'Connection failed'));
      }
    } finally {
      if (sessionId) void cleanupOAuthSession(sessionId).catch(() => {});
    }
  };

  const active = connected || status === 'connected';
  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-accent/25 bg-accent/5 p-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 items-start gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-accent/15 text-accent"><Cloud className="size-5" aria-hidden /></span>
        <div className="min-w-0">
          <div className="flex items-center gap-2"><h2 className="text-sm font-semibold text-fg">{displayName}</h2>{active ? <CheckCircle2 className="size-4 text-emerald-500" aria-label={zh ? '已连接' : 'Connected'} /> : null}</div>
          <p className="mt-1 text-sm text-fg-muted">{status === 'waiting' ? (zh ? '请在浏览器中完成 OAuth 授权。' : 'Complete OAuth authorization in your browser.') : active ? (zh ? '已通过 OAuth 连接。' : 'Connected with OAuth.') : (zh ? '使用 OAuth 连接，无需 API Key。' : 'Connect with OAuth. No API key is required.')}</p>
          {status === 'waiting' && authorizationUrl ? (
            <a className="mt-1 inline-flex text-sm text-accent hover:underline" href={authorizationUrl} target="_blank" rel="noreferrer">
              {zh ? '打开授权页面' : 'Open authorization page'}
            </a>
          ) : null}
          {error ? <p className="mt-1 text-sm text-danger">{error}</p> : null}
        </div>
      </div>
      <Button type="button" variant={active ? 'secondary' : 'primary'} disabled={status === 'waiting'} onClick={() => void connect()}>
        {status === 'waiting' ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
        {status === 'waiting' ? (zh ? '等待授权…' : 'Waiting…') : active ? (zh ? '重新授权' : 'Reauthorize') : (zh ? '授权' : 'Authorize')}
      </Button>
    </div>
  );
}
