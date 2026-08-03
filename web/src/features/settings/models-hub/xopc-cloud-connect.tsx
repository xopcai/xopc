import { CheckCircle2, Cloud, Loader2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import { apiFetch } from '@/lib/fetch';
import { isElectron } from '@/lib/electron-env';
import { apiUrl } from '@/lib/url';
import { useLocaleStore } from '@/stores/locale-store';

import { revalidateModelsHubCaches } from './models-hub-cache';

interface StartResult {
  requestId: string;
  authorizationUrl: string;
  expiresIn: number;
  pollInterval: number;
}

interface PollResult {
  status: 'pending' | 'connected';
  modelCount?: number;
}

async function responsePayload<T>(response: Response): Promise<T> {
  const body = await response.json().catch(() => null) as {
    ok?: boolean;
    payload?: T;
    error?: { message?: string } | string;
  } | null;
  if (!response.ok || !body?.ok || !body.payload) {
    const message = typeof body?.error === 'string' ? body.error : body?.error?.message;
    throw new Error(message ?? `HTTP ${response.status}`);
  }
  return body.payload;
}

export function XopcCloudConnect({
  connected,
  onConnected,
}: {
  connected: boolean;
  onConnected?: () => void;
}) {
  const language = useLocaleStore((state) => state.language);
  const zh = language === 'zh';
  const [status, setStatus] = useState<'idle' | 'waiting' | 'connected'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [modelCount, setModelCount] = useState<number | null>(null);
  const cancelledRef = useRef(false);

  useEffect(() => () => { cancelledRef.current = true; }, []);

  const connect = async () => {
    cancelledRef.current = false;
    setError(null);
    setStatus('waiting');
    const electron = isElectron();
    const authorizationWindow = electron ? null : window.open('about:blank', '_blank');
    try {
      const started = await responsePayload<StartResult>(await apiFetch(apiUrl('/api/models/xopc-cloud/connect'), {
        method: 'POST',
        body: JSON.stringify({ clientType: isElectron() ? 'electron' : 'web' }),
      }));
      if (electron) {
        const opened = await window.electronAPI?.shell?.openExternalUrl(started.authorizationUrl);
        if (!opened?.ok) throw new Error(opened?.error ?? (zh ? '无法打开系统浏览器。' : 'Could not open the system browser.'));
      } else if (authorizationWindow) {
        authorizationWindow.location.replace(started.authorizationUrl);
      } else {
        window.location.assign(started.authorizationUrl);
      }

      const deadline = Date.now() + started.expiresIn * 1000;
      while (!cancelledRef.current && Date.now() < deadline) {
        await new Promise((resolve) => window.setTimeout(resolve, started.pollInterval * 1000));
        if (cancelledRef.current) return;
        const response = await apiFetch(apiUrl(
          `/api/models/xopc-cloud/connect/${encodeURIComponent(started.requestId)}/poll`,
        ), { method: 'POST' });
        const result = await responsePayload<PollResult>(response);
        if (result.status === 'pending') continue;
        setModelCount(result.modelCount ?? 0);
        setStatus('connected');
        await revalidateModelsHubCaches();
        onConnected?.();
        return;
      }
      if (!cancelledRef.current) throw new Error(zh ? '连接请求已过期，请重试。' : 'The connection request expired. Try again.');
    } catch (cause) {
      authorizationWindow?.close();
      if (cancelledRef.current) return;
      setStatus('idle');
      setError(cause instanceof Error ? cause.message : (zh ? '连接失败' : 'Connection failed'));
    }
  };

  const active = connected || status === 'connected';
  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-accent/25 bg-accent/5 p-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 items-start gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-accent/15 text-accent">
          <Cloud className="size-5" aria-hidden />
        </span>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold text-fg">XOPC Model Service</h2>
            {active ? <CheckCircle2 className="size-4 text-emerald-500" aria-label={zh ? '已连接' : 'Connected'} /> : null}
          </div>
          <p className="mt-1 text-sm text-fg-muted">
            {status === 'waiting'
              ? (zh ? '请在浏览器中登录并确认，模型会自动同步。' : 'Sign in in your browser. Models will sync automatically.')
              : active
                ? (modelCount !== null
                    ? (zh ? `已连接并同步 ${modelCount} 个模型。` : `Connected with ${modelCount} models synced.`)
                    : (zh ? '已连接，模型目录会自动保持最新。' : 'Connected. Your model catalog stays up to date.'))
                : (zh ? '登录 XOPC Console，一键连接，无需复制 API Key。' : 'Sign in to XOPC Console. No API key copying or setup.')}
          </p>
          {error ? <p className="mt-1 text-sm text-danger">{error}</p> : null}
        </div>
      </div>
      <Button type="button" variant={active ? 'secondary' : 'primary'} disabled={status === 'waiting'} onClick={() => void connect()}>
        {status === 'waiting' ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
        {status === 'waiting'
          ? (zh ? '等待授权…' : 'Waiting…')
          : active
            ? (zh ? '重新连接' : 'Reconnect')
            : (zh ? '连接' : 'Connect')}
      </Button>
    </div>
  );
}
