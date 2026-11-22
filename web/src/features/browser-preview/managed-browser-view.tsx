import { ArrowLeft, Maximize2, RotateCw, ShieldAlert } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { apiFetch, fetchJson } from '@/lib/fetch';
import { apiUrl } from '@/lib/url';
import { useLocaleStore } from '@/stores/locale-store';

export interface ManagedBrowserStatus {
  available: boolean;
  mode: 'managed';
  interactive: boolean;
  status: 'running' | 'needs_user' | 'human' | 'ended';
  browserSessionId?: string;
  assistanceId?: string;
  reason?: string;
  url: string;
  title: string;
  viewport: { width: number; height: number; version: number };
  ownControl: boolean;
  controlOwner?: string;
  controlEpoch: number;
  privacyPaused: boolean;
}

const ALLOWED_SPECIAL_KEYS = new Set([
  'Enter', 'Backspace', 'Tab', 'Escape', 'Delete', 'Home', 'End',
  'PageUp', 'PageDown', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
]);

function normalizedCoords(img: HTMLImageElement, clientX: number, clientY: number): { x: number; y: number } | null {
  const rect = img.getBoundingClientRect();
  if (!rect.width || !rect.height) return null;
  const naturalW = img.naturalWidth || 1280;
  const naturalH = img.naturalHeight || 720;
  const boxRatio = rect.width / rect.height;
  const contentRatio = naturalW / naturalH;
  let drawW = rect.width;
  let drawH = rect.height;
  let offsetX = 0;
  let offsetY = 0;
  if (contentRatio > boxRatio) {
    drawH = rect.width / contentRatio;
    offsetY = (rect.height - drawH) / 2;
  } else {
    drawW = rect.height * contentRatio;
    offsetX = (rect.width - drawW) / 2;
  }
  const relX = (clientX - rect.left - offsetX) / drawW;
  const relY = (clientY - rect.top - offsetY) / drawH;
  if (relX < 0 || relX > 1 || relY < 0 || relY > 1) return null;
  return { x: Math.min(1, Math.max(0, relX)), y: Math.min(1, Math.max(0, relY)) };
}

export function ManagedBrowserView({ conversationId }: { conversationId: string }) {
  const zh = useLocaleStore(state => state.language === 'zh');
  const clientId = useMemo(() => crypto.randomUUID(), []);
  const stageRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const seqRef = useRef(0);
  const draggingRef = useRef(false);
  const epochRef = useRef(0);
  const ownControlRef = useRef(false);
  const [status, setStatus] = useState<ManagedBrowserStatus | null>(null);
  const [frameUrl, setFrameUrl] = useState('');
  const [privacyPaused, setPrivacyPaused] = useState(false);
  const [ended, setEnded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [textDraft, setTextDraft] = useState('');

  const applyStatus = useCallback((next: ManagedBrowserStatus | null) => {
    setStatus(next);
    const activeOwn = Boolean(next?.ownControl);
    ownControlRef.current = activeOwn;
    if (activeOwn && next?.controlEpoch) {
      if (epochRef.current !== next.controlEpoch) seqRef.current = 0;
      epochRef.current = next.controlEpoch;
    }
    if (next?.privacyPaused) setPrivacyPaused(true);
    else if (next) setPrivacyPaused(false);
    if (!next?.available) setEnded(true);
    else setEnded(false);
  }, []);

  const refreshStatus = useCallback(async () => {
    try {
      const data = await fetchJson<ManagedBrowserStatus | { available: false }>(
        apiUrl(`/api/browser/preview/${encodeURIComponent(conversationId)}?clientId=${encodeURIComponent(clientId)}`),
      );
      if ('mode' in data && data.mode === 'managed' && data.available) {
        applyStatus(data);
      } else {
        applyStatus(null);
      }
    } catch {
      /* Transient status poll failure; frame stream handles disconnect. */
    }
  }, [applyStatus, clientId, conversationId]);

  const sendInput = useCallback(async (event: Record<string, unknown>) => {
    if (!ownControlRef.current || !epochRef.current) return;
    seqRef.current += 1;
    const seq = seqRef.current;
    try {
      const res = await apiFetch(apiUrl(`/api/browser/managed/${encodeURIComponent(conversationId)}/input`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId, epoch: epochRef.current, seq, event }),
      });
      if (res.status === 409) {
        await refreshStatus();
      }
    } catch {
      /* Next heartbeat/status poll reconciles control state. */
    }
  }, [clientId, conversationId, refreshStatus]);

  const releaseControl = useCallback(async (keepalive = false) => {
    if (!ownControlRef.current) return;
    ownControlRef.current = false;
    const epoch = epochRef.current || undefined;
    try {
      await apiFetch(apiUrl(`/api/browser/managed/${encodeURIComponent(conversationId)}/release`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId, ...(epoch ? { epoch } : {}) }),
        keepalive,
      });
    } catch { /* Best-effort release; 10s lease still expires server-side. */ }
    if (!keepalive) await refreshStatus();
  }, [clientId, conversationId, refreshStatus]);

  // Status poll
  useEffect(() => {
    void refreshStatus();
    const timer = setInterval(() => { void refreshStatus(); }, 2000);
    return () => clearInterval(timer);
  }, [refreshStatus]);

  // Immediate-wakeup frame long-poll
  useEffect(() => {
    const controller = new AbortController();
    let currentUrl = '';
    let after = 0;

    const clearFrame = () => {
      if (currentUrl) URL.revokeObjectURL(currentUrl);
      currentUrl = '';
      setFrameUrl('');
    };

    void (async () => {
      while (!controller.signal.aborted) {
        try {
          const res = await apiFetch(
            apiUrl(`/api/browser/managed/${encodeURIComponent(conversationId)}/frame?after=${after}&clientId=${encodeURIComponent(clientId)}`),
            { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(4000)]) },
          );
          if (controller.signal.aborted) break;
          if (res.status === 200) {
            const blob = await res.blob();
            if (controller.signal.aborted) break;
            const nextSeq = Number(res.headers.get('X-Xopc-Preview-Frame')) || after;
            after = nextSeq;
            const nextUrl = URL.createObjectURL(blob);
            if (currentUrl) URL.revokeObjectURL(currentUrl);
            currentUrl = nextUrl;
            setFrameUrl(nextUrl);
            setPrivacyPaused(false);
            setEnded(false);
          } else if (res.status === 423) {
            clearFrame();
            setPrivacyPaused(true);
            await new Promise(resolve => setTimeout(resolve, 800));
          } else if (res.status === 404 || res.status === 403) {
            clearFrame();
            setEnded(true);
            break;
          }
          // 204 loops immediately for the next frame
        } catch {
          if (controller.signal.aborted) break;
          await new Promise(resolve => setTimeout(resolve, 600));
        }
      }
    })();

    return () => {
      controller.abort();
      clearFrame();
    };
  }, [clientId, conversationId]);

  // Control lease heartbeat + auto-release on background/leave
  useEffect(() => {
    if (!status?.ownControl || !status.controlEpoch) return;
    const epoch = status.controlEpoch;
    const timer = setInterval(() => {
      void apiFetch(apiUrl(`/api/browser/managed/${encodeURIComponent(conversationId)}/heartbeat`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId, epoch }),
      }).then(res => {
        if (!res.ok) void refreshStatus();
      }).catch(() => {});
    }, 3000);
    const onHidden = () => { if (document.hidden) void releaseControl(true); };
    const onPageHide = () => { void releaseControl(true); };
    document.addEventListener('visibilitychange', onHidden);
    window.addEventListener('pagehide', onPageHide);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onHidden);
      window.removeEventListener('pagehide', onPageHide);
    };
  }, [clientId, conversationId, refreshStatus, releaseControl, status?.controlEpoch, status?.ownControl]);

  useEffect(() => () => { void releaseControl(true); }, [releaseControl]);

  const handleTakeover = async () => {
    setBusy(true);
    setError('');
    try {
      const res = await fetchJson<{ ok: boolean; payload?: ManagedBrowserStatus; error?: { message?: string } }>(
        apiUrl(`/api/browser/managed/${encodeURIComponent(conversationId)}/takeover`),
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ clientId }),
        },
      );
      if (res.payload) {
        applyStatus(res.payload);
        stageRef.current?.focus();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : (zh ? '无法接管浏览器' : 'Could not take over browser'));
    } finally {
      setBusy(false);
    }
  };

  const handleHandback = async () => {
    setBusy(true);
    setError('');
    try {
      const epoch = epochRef.current || undefined;
      const res = await fetchJson<{ ok: boolean; payload?: ManagedBrowserStatus }>(
        apiUrl(`/api/browser/managed/${encodeURIComponent(conversationId)}/handback`),
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ clientId, ...(epoch ? { epoch } : {}) }),
        },
      );
      applyStatus(res.payload ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : (zh ? '无法交还控制权' : 'Could not hand back control'));
    } finally {
      setBusy(false);
    }
  };

  const handleSendText = async () => {
    const value = textDraft;
    if (!value) return;
    setTextDraft('');
    await sendInput({ kind: 'text', text: value });
  };

  const canFullscreen = Boolean(frameUrl) && !privacyPaused && typeof document !== 'undefined' && document.fullscreenEnabled !== false;
  const toggleFullscreen = () => {
    const host = stageRef.current;
    if (!host) return;
    if (document.fullscreenElement) void document.exitFullscreen?.().catch(() => {});
    else void host.requestFullscreen?.().catch(() => {});
  };

  const ownControl = Boolean(status?.ownControl);
  const needsUser = status?.status === 'needs_user';

  return (
    <section className="flex min-h-0 flex-1 flex-col overflow-hidden bg-surface-base">
      <div className="flex items-center justify-between gap-2 border-b border-edge px-3 py-1.5 text-xs text-fg-muted">
        <div className="flex min-w-0 items-center gap-2">
          <span className={`size-2 shrink-0 rounded-full ${ownControl ? 'bg-accent' : needsUser ? 'bg-amber-500' : ended ? 'bg-fg-subtle' : 'bg-emerald-500'}`} aria-hidden />
          <span className="truncate" title={status?.url || ''}>{status?.url || (zh ? '服务器托管浏览器' : 'Managed browser')}</span>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {ownControl ? (
            <>
              <button type="button" onClick={() => { void sendInput({ kind: 'navigate', action: 'back' }); }}
                className="rounded p-1 hover:bg-surface-hover hover:text-fg" aria-label={zh ? '后退' : 'Back'} title={zh ? '后退' : 'Back'}>
                <ArrowLeft className="size-3.5" aria-hidden />
              </button>
              <button type="button" onClick={() => { void sendInput({ kind: 'navigate', action: 'reload' }); }}
                className="rounded p-1 hover:bg-surface-hover hover:text-fg" aria-label={zh ? '刷新' : 'Reload'} title={zh ? '刷新' : 'Reload'}>
                <RotateCw className="size-3.5" aria-hidden />
              </button>
            </>
          ) : null}
          {canFullscreen ? (
            <button type="button" onClick={toggleFullscreen}
              className="rounded p-1 hover:bg-surface-hover hover:text-fg" aria-label={zh ? '全屏查看' : 'Fullscreen'} title={zh ? '全屏查看' : 'Fullscreen'}>
              <Maximize2 className="size-3.5" aria-hidden />
            </button>
          ) : null}
        </div>
      </div>

      {needsUser && !ownControl ? (
        <div role="status" className="flex items-center justify-between gap-3 border-b border-edge bg-surface-panel px-3 py-2 text-xs">
          <span className="min-w-0 truncate text-fg">
            {status?.reason || (zh ? '需要你手动完成登录或确认，再交还给 AI 继续。' : 'Manual login or confirmation is needed before continuing.')}
          </span>
          <div className="flex shrink-0 items-center gap-1.5">
            <Button variant="primary" className="h-7 px-2.5 text-xs" disabled={busy} onClick={() => { void handleTakeover(); }}>
              {zh ? '接管浏览器' : 'Take over'}
            </Button>
            <Button variant="secondary" className="h-7 px-2.5 text-xs" disabled={busy} onClick={() => { void handleHandback(); }}>
              {zh ? '已完成，继续' : 'Done, continue'}
            </Button>
          </div>
        </div>
      ) : null}

      <div
        ref={stageRef}
        tabIndex={ownControl ? 0 : -1}
        onKeyDown={(event) => {
          if (!ownControl) return;
          if ((event.target as HTMLElement)?.tagName === 'INPUT') return;
          if (ALLOWED_SPECIAL_KEYS.has(event.key)) {
            event.preventDefault();
            void sendInput({ kind: 'key', key: event.key });
          } else if (event.key === ' ') {
            event.preventDefault();
            void sendInput({ kind: 'key', key: 'Space' });
          } else if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
            event.preventDefault();
            void sendInput({ kind: 'text', text: event.key });
          }
        }}
        className="relative flex min-h-0 flex-1 flex-col items-center justify-center overflow-hidden bg-surface-base outline-none"
      >
        {privacyPaused ? (
          <div role="status" className="mx-auto flex max-w-sm flex-col items-center gap-2 p-6 text-center text-sm text-fg-muted">
            <ShieldAlert className="size-6 text-fg-muted" aria-hidden />
            <p>{zh ? `${status?.controlOwner || '另一台设备'} 正在接管操作，画面已暂停以保护隐私。` : `${status?.controlOwner || 'Another device'} is controlling this browser. Live view is paused for privacy.`}</p>
          </div>
        ) : ended ? (
          <div role="status" className="mx-auto flex max-w-sm flex-col items-center gap-3 p-6 text-center text-sm text-fg-muted">
            <p>{zh ? '托管浏览器会话已结束。' : 'The managed browser session has ended.'}</p>
          </div>
        ) : frameUrl ? (
          <img
            ref={imgRef}
            src={frameUrl}
            alt={zh ? '托管浏览器实时画面' : 'Managed browser live view'}
            draggable={false}
            onPointerDown={(event) => {
              if (!ownControl || !imgRef.current) return;
              const coords = normalizedCoords(imgRef.current, event.clientX, event.clientY);
              if (!coords) return;
              stageRef.current?.focus();
              draggingRef.current = true;
              event.currentTarget.setPointerCapture(event.pointerId);
              const button = event.button === 2 ? 'right' : event.button === 1 ? 'middle' : 'left';
              void sendInput({ kind: 'pointer', phase: 'down', ...coords, button });
            }}
            onPointerMove={(event) => {
              if (!ownControl || !draggingRef.current || !imgRef.current) return;
              const coords = normalizedCoords(imgRef.current, event.clientX, event.clientY);
              if (!coords) return;
              void sendInput({ kind: 'pointer', phase: 'move', ...coords });
            }}
            onPointerUp={(event) => {
              if (!ownControl || !draggingRef.current || !imgRef.current) return;
              draggingRef.current = false;
              const coords = normalizedCoords(imgRef.current, event.clientX, event.clientY) ?? { x: 0.5, y: 0.5 };
              const button = event.button === 2 ? 'right' : event.button === 1 ? 'middle' : 'left';
              void sendInput({ kind: 'pointer', phase: 'up', ...coords, button });
            }}
            onPointerCancel={() => {
              if (!ownControl || !draggingRef.current) return;
              draggingRef.current = false;
              void sendInput({ kind: 'pointer', phase: 'cancel', x: 0.5, y: 0.5 });
            }}
            onWheel={(event) => {
              if (!ownControl || !imgRef.current) return;
              const coords = normalizedCoords(imgRef.current, event.clientX, event.clientY);
              if (!coords) return;
              event.preventDefault();
              void sendInput({ kind: 'wheel', ...coords, deltaX: event.deltaX, deltaY: event.deltaY });
            }}
            className={`min-h-0 h-full w-full flex-1 select-none object-contain ${ownControl ? 'cursor-pointer' : ''}`}
          />
        ) : (
          <div role="status" className="mx-auto flex w-full max-w-md flex-col items-center gap-4 p-5 text-center">
            <Skeleton className="aspect-video w-full rounded-lg" />
            <p className="text-sm text-fg-muted">{zh ? '正在连接服务器浏览器' : 'Connecting to server browser'}</p>
          </div>
        )}
      </div>

      {error ? <div className="border-t border-edge px-3 py-1.5 text-xs text-red-500">{error}</div> : null}

      {!ended && !privacyPaused ? (
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-edge bg-surface-panel px-3 py-2">
          {ownControl ? (
            <>
              <form className="flex min-w-0 flex-1 items-center gap-1.5" onSubmit={(event) => { event.preventDefault(); void handleSendText(); }}>
                <input
                  type="text"
                  value={textDraft}
                  onChange={(event) => setTextDraft(event.target.value)}
                  placeholder={zh ? '输入文字发送到焦点输入框（支持中文）' : 'Type text to send to focused input'}
                  className="h-7 min-w-0 flex-1 rounded-md border border-edge bg-surface-base px-2 text-xs text-fg placeholder:text-fg-subtle focus:outline-none focus:ring-1 focus:ring-accent"
                />
                <Button type="submit" variant="secondary" className="h-7 px-2.5 text-xs" disabled={!textDraft}>
                  {zh ? '发送' : 'Send'}
                </Button>
              </form>
              <div className="flex shrink-0 items-center gap-1.5">
                <Button variant="secondary" className="h-7 px-2.5 text-xs" disabled={busy} onClick={() => { void releaseControl(); }}>
                  {zh ? '暂离' : 'Pause'}
                </Button>
                <Button variant="primary" className="h-7 px-3 text-xs" disabled={busy} onClick={() => { void handleHandback(); }}>
                  {zh ? '完成，继续任务' : 'Done, continue task'}
                </Button>
              </div>
            </>
          ) : (
            <>
              <span className="text-xs text-fg-muted">
                {needsUser
                  ? (zh ? '等待人工接管' : 'Waiting for manual takeover')
                  : (zh ? '只读观看中' : 'Viewing (read-only)')}
              </span>
              <Button variant="secondary" className="h-7 px-3 text-xs" disabled={busy} onClick={() => { void handleTakeover(); }}>
                {zh ? '接管浏览器' : 'Take over browser'}
              </Button>
            </>
          )}
        </div>
      ) : null}
    </section>
  );
}
