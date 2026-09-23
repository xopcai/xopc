import type { ChatPreviewDiagnostic, ProductReference } from '@xopcai/gateway-contract';
import { AlertTriangle, RefreshCw, Save, Wrench } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import useSWR from 'swr';

import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { dispatchFillChatComposer } from '@/features/chat/composer/fill-composer-dispatch';
import {
  getChatPreviewFixGuidance,
  getChatPreviewRevision,
  promoteChatPreview,
} from '@/features/chat-previews/api';
import {
  attachChatPreviewChannel,
  buildChatPreviewSrcDoc,
} from '@/features/chat-previews/runtime';
import { useInlinePreviewLease } from '@/features/chat/product-delivery/inline-preview-scheduler';
import { cn } from '@/lib/cn';

type RuntimeState = 'booting' | 'healthy' | 'failed' | 'timeout';

export function InlineChatPreview({
  leaseId,
  reference,
  sourceHash,
  preferredHeight,
  language,
}: {
  leaseId: string;
  reference: ProductReference;
  sourceHash: string;
  preferredHeight: number;
  language: 'en' | 'zh';
}) {
  const navigate = useNavigate();
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [runtimeState, setRuntimeState] = useState<RuntimeState>('booting');
  const [diagnostics, setDiagnostics] = useState<ChatPreviewDiagnostic[]>([]);
  const [action, setAction] = useState<'fix' | 'promote' | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const lease = useInlinePreviewLease(leaseId);
  const height = Math.min(720, Math.max(240, preferredHeight));
  const channel = useMemo(() => crypto.randomUUID(), [reloadKey, sourceHash]);
  const revisionQuery = useSWR(
    lease.active ? ['chat-preview-revision', reference.id, sourceHash] : null,
    () => getChatPreviewRevision(reference.id, sourceHash),
    { revalidateOnFocus: false, shouldRetryOnError: false },
  );
  const srcDoc = revisionQuery.data ? buildChatPreviewSrcDoc(revisionQuery.data, channel) : undefined;

  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe || !srcDoc) return;
    setRuntimeState('booting');
    setDiagnostics([]);
    const timeout = window.setTimeout(() => {
      setRuntimeState(current => current === 'booting' ? 'timeout' : current);
    }, 7_000);
    const detach = attachChatPreviewChannel(iframe, channel, (message) => {
      if (message.type === 'ready') setRuntimeState('healthy');
      if (message.type === 'resize') iframe.style.height = `${Math.min(720, Math.max(240, message.height))}px`;
      if (message.type === 'error') {
        setRuntimeState('failed');
        setDiagnostics(current => [...current, message.diagnostic].slice(-20));
      }
    });
    return () => {
      window.clearTimeout(timeout);
      detach();
    };
  }, [channel, srcDoc]);

  const retry = () => {
    setActionError(null);
    setReloadKey(current => current + 1);
  };

  const askToFix = async () => {
    if (!diagnostics.length) return;
    setAction('fix');
    setActionError(null);
    try {
      const guidance = await getChatPreviewFixGuidance(reference.id, {
        sourceHash,
        diagnostics,
        locale: language,
      });
      dispatchFillChatComposer(guidance.prompt);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error));
    } finally {
      setAction(null);
    }
  };

  const saveAsApp = async () => {
    setAction('promote');
    setActionError(null);
    try {
      const app = await promoteChatPreview(reference.id, sourceHash);
      navigate(`/local-apps/${encodeURIComponent(app.id)}`);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error));
    } finally {
      setAction(null);
    }
  };

  const shell = 'mt-3 overflow-hidden rounded-2xl border border-edge bg-surface-panel';
  if (!lease.active) {
    return (
      <section ref={lease.containerRef} className={shell} data-inline-chat-preview={reference.id}>
        <header className="border-b border-edge-subtle px-4 py-3">
          <h3 className="truncate text-sm font-semibold text-fg">{reference.title}</h3>
          <p className="mt-0.5 text-xs text-fg-muted">
            {lease.state === 'queued'
              ? (language === 'zh' ? '正在等待预览资源' : 'Waiting for a preview slot')
              : (language === 'zh' ? '预览尚未加载' : 'Preview not loaded')}
          </p>
        </header>
        <div className="grid place-items-center bg-surface-base" style={{ height }}>
          <Button variant="secondary" className="min-h-11" onClick={lease.activate}>
            {language === 'zh' ? '加载交互预览' : 'Load interactive preview'}
          </Button>
        </div>
      </section>
    );
  }

  if (revisionQuery.isLoading) {
    return (
      <section ref={lease.containerRef} className={shell} aria-busy="true" aria-label={language === 'zh' ? '正在加载预览' : 'Loading preview'}>
        <div className="border-b border-edge-subtle px-4 py-3"><Skeleton className="h-5 w-40" /></div>
        <Skeleton className="m-3 w-[calc(100%-1.5rem)]" style={{ height }} />
      </section>
    );
  }

  if (!revisionQuery.data || !srcDoc) {
    const message = revisionQuery.error instanceof Error
      ? revisionQuery.error.message
      : (language === 'zh' ? '无法加载预览' : 'Unable to load preview');
    return (
      <section ref={lease.containerRef} className="mt-3 rounded-2xl border border-danger/30 bg-danger-soft p-4 text-sm text-danger" role="alert">
        <div className="flex items-center gap-2"><AlertTriangle className="size-4" />{message}</div>
      </section>
    );
  }

  const failed = runtimeState === 'failed' || runtimeState === 'timeout';
  const status = runtimeState === 'healthy'
    ? (language === 'zh' ? '运行正常' : 'Running')
    : runtimeState === 'booting'
      ? (language === 'zh' ? '正在启动' : 'Starting')
      : runtimeState === 'timeout'
        ? (language === 'zh' ? '启动超时' : 'Start timed out')
        : (language === 'zh' ? '运行错误' : 'Runtime error');

  return (
    <section ref={lease.containerRef} className={shell} data-inline-chat-preview={reference.id}>
      <header className="flex min-w-0 flex-wrap items-center gap-2 border-b border-edge-subtle px-4 py-3">
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-sm font-semibold text-fg">{reference.title}</h3>
          <p className={cn('mt-0.5 text-xs', failed ? 'text-danger' : 'text-fg-muted')} aria-live="polite">{status}</p>
        </div>
        <Button variant="ghost" className="min-h-11 px-3 text-xs" onClick={retry} aria-label={language === 'zh' ? '重新加载预览' : 'Reload preview'}>
          <RefreshCw className="size-4" />{language === 'zh' ? '重试' : 'Retry'}
        </Button>
        <Button variant="secondary" className="min-h-11 px-3 text-xs" disabled={action !== null} onClick={() => void saveAsApp()}>
          <Save className="size-4" />{action === 'promote' ? (language === 'zh' ? '保存中…' : 'Saving…') : (language === 'zh' ? '保存为应用' : 'Save as app')}
        </Button>
      </header>
      <div className="relative bg-surface-base" style={{ minHeight: height }}>
        <iframe
          key={reloadKey}
          ref={iframeRef}
          title={language === 'zh' ? `${reference.title} 交互预览` : `${reference.title} interactive preview`}
          srcDoc={srcDoc}
          sandbox="allow-scripts allow-forms"
          className="block w-full border-0 bg-white"
          style={{ height }}
        />
        {runtimeState === 'booting' ? (
          <div className="pointer-events-none absolute inset-0 grid place-items-center bg-surface-base/75">
            <Skeleton className="h-10 w-40" />
          </div>
        ) : null}
      </div>
      {failed ? (
        <footer className="border-t border-danger/20 bg-danger-soft/60 px-4 py-3">
          <div className="flex flex-wrap items-center gap-3">
            <p className="min-w-0 flex-1 text-xs text-danger" role="alert">
              {diagnostics.at(-1)?.message ?? (language === 'zh' ? '预览未能正常启动' : 'The preview did not start correctly')}
            </p>
            <Button variant="secondary" className="min-h-11 px-3 text-xs" disabled={!diagnostics.length || action !== null} onClick={() => void askToFix()}>
              <Wrench className="size-4" />{action === 'fix' ? (language === 'zh' ? '生成中…' : 'Preparing…') : (language === 'zh' ? '让 AI 修复' : 'Ask AI to fix')}
            </Button>
          </div>
        </footer>
      ) : null}
      {actionError ? <p className="border-t border-danger/20 px-4 py-2 text-xs text-danger" role="alert">{actionError}</p> : null}
    </section>
  );
}
