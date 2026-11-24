import { productReferenceOpenRoute, type ProductReference } from '@xopcai/gateway-contract';
import { AlertTriangle, ExternalLink, RefreshCw, Wrench } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import useSWR from 'swr';

import { Button } from '@/components/ui/button';
import '@/components/ui/content-block-actions.css';
import { GenerationPlaceholder } from '@/features/chat/generation-placeholder';
import { useInlinePreviewLease } from '@/features/chat/product-delivery/inline-preview-scheduler';
import {
  getLocalAppFixGuidance,
  resolveLocalAppDevelopmentConversation,
  getLocalAppSnapshot,
  type LocalAppDiagnostic,
} from '@/features/local-apps/api';
import { localAppConversationUrl } from '@/features/local-apps/conversation';
import { attachLocalAppPreviewChannel } from '@/features/local-apps/preview-channel';
import {
  formatLocalAppRuntimeIssue,
  parseLocalAppRuntimeMessage,
  type LocalAppRuntimeIssue,
} from '@/features/local-apps/runtime-health';
import { messages } from '@/i18n/messages';
import { cn } from '@/lib/cn';
import { chatProductHref } from '@/features/chat/product-preview/product-preview-route';
import { apiUrl } from '@/lib/url';

type RuntimeHealth = 'booting' | 'healthy' | 'failed' | 'timeout';

export function InlineLocalApp({
  previewId,
  reference,
  sourceHash,
  preferredHeight,
  language,
}: {
  previewId: string;
  reference: ProductReference;
  sourceHash: string;
  preferredHeight: number;
  language: 'en' | 'zh';
}) {
  const navigate = useNavigate();
  const location = useLocation();
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [previewKey, setPreviewKey] = useState(0);
  const [runtimeHealth, setRuntimeHealth] = useState<RuntimeHealth>('booting');
  const [runtimeIssue, setRuntimeIssue] = useState<LocalAppRuntimeIssue | null>(null);
  const [runtimeDiagnostics, setRuntimeDiagnostics] = useState<LocalAppDiagnostic[]>([]);
  const [fixBusy, setFixBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const height = Math.min(720, Math.max(240, preferredHeight));
  const lease = useInlinePreviewLease(previewId);
  const snapshotQuery = useSWR(
    lease.active ? ['inline-local-app-snapshot', reference.id, sourceHash] : null,
    () => getLocalAppSnapshot(reference.id, sourceHash),
    { revalidateOnFocus: false, shouldRetryOnError: false },
  );

  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe || !snapshotQuery.data?.previewUrl) return;
    setRuntimeHealth('booting');
    setRuntimeIssue(null);
    setRuntimeDiagnostics([]);
    const timeout = window.setTimeout(() => {
      setRuntimeHealth((current) => current === 'booting' ? 'timeout' : current);
    }, 7_000);
    const detach = attachLocalAppPreviewChannel(iframe, (value) => {
      const message = parseLocalAppRuntimeMessage(value);
      if (!message) return;
      if (message.type === 'ready') {
        setRuntimeHealth('healthy');
        return;
      }
      if (message.type === 'error') {
        setRuntimeIssue(message.detail);
        setRuntimeHealth('failed');
        setRuntimeDiagnostics((current) => [
          ...current,
          {
            phase: 'runtime',
            message: formatLocalAppRuntimeIssue(message.detail),
            code: message.detail.kind,
          } satisfies LocalAppDiagnostic,
        ].slice(-20));
        return;
      }
      if (message.type === 'acceptance' && message.detail.status === 'failed') {
        setRuntimeHealth('failed');
        setRuntimeDiagnostics((current) => [
          ...current,
          ...message.detail.checks
            .filter((check) => check.status === 'failed')
            .map((check): LocalAppDiagnostic => ({ phase: 'acceptance', code: check.id, message: check.message })),
        ].slice(-20));
        return;
      }
      if (message.type === 'criteria' && message.detail.status === 'failed') {
        setRuntimeHealth('failed');
        setRuntimeDiagnostics((current) => [
          ...current,
          ...message.detail.scenarios
            .filter((scenario) => scenario.status === 'failed')
            .map((scenario): LocalAppDiagnostic => ({
              phase: scenario.failureKind === 'runner' ? 'runner' : 'acceptance',
              code: scenario.id,
              message: `${scenario.name}: ${scenario.message}`,
            })),
        ].slice(-20));
      }
    });
    return () => {
      window.clearTimeout(timeout);
      detach();
    };
  }, [previewKey, snapshotQuery.data?.previewUrl]);

  const open = () => {
    const route = productReferenceOpenRoute(reference);
    if (route) navigate(chatProductHref(`${location.pathname}${location.search}`, `${route}&sourceHash=${encodeURIComponent(sourceHash)}`));
  };

  if (!lease.active) {
    const queued = lease.state === 'queued';
    return (
      <section ref={lease.containerRef} className="content-block-action-scope mt-3 overflow-hidden rounded-2xl bg-surface-inset" data-inline-local-app={reference.id}>
        <header className="flex min-w-0 flex-wrap items-center gap-3 border-b border-edge-subtle px-4 py-3">
          <div className="min-w-0 flex-1">
            <h3 className="truncate text-sm font-semibold text-fg" title={reference.title}>{reference.title}</h3>
            <p role="status" className="mt-0.5 text-xs text-fg-muted">
              {queued
                ? (language === 'zh' ? '正在等待预览资源' : 'Waiting for a preview slot')
                : (language === 'zh' ? '预览尚未加载' : 'Preview not loaded')}
            </p>
          </div>
          <Button variant="ghost" className="content-block-action" onClick={open}
            title={language === 'zh' ? '查看预览' : 'Preview'} aria-label={language === 'zh' ? '查看预览' : 'Preview'}>
            <ExternalLink className="size-4" aria-hidden />
          </Button>
        </header>
        <div className="relative grid place-items-center bg-surface-base" style={{ height }}>
          {queued && <GenerationPlaceholder kind="preview" waiting className="absolute inset-0 rounded-none pb-14" />}
          <Button variant="secondary" className={cn('relative min-h-11', queued && 'translate-y-12')} onClick={lease.activate}>
            {language === 'zh' ? '加载交互预览' : 'Load interactive preview'}
          </Button>
        </div>
      </section>
    );
  }

  if (snapshotQuery.isLoading) {
    return (
      <section ref={lease.containerRef} className="mt-3 overflow-hidden rounded-2xl bg-surface-inset" data-inline-local-app={reference.id}>
        <header className="border-b border-edge-subtle px-4 py-3">
          <h3 className="truncate text-sm font-semibold text-fg" title={reference.title}>{reference.title}</h3>
          <p role="status" className="mt-0.5 text-xs text-fg-muted">{messages(language).chat.productDelivery.loadingAppPreview}</p>
        </header>
        <div aria-busy="true"><GenerationPlaceholder kind="preview" className="rounded-none" style={{ height }} /></div>
      </section>
    );
  }

  const snapshot = snapshotQuery.data;
  if (!snapshot) {
    const cause = snapshotQuery.error;
    const message = cause instanceof Error ? cause.message : (language === 'zh' ? '无法加载应用预览' : 'Unable to load app preview');
    return (
      <section ref={lease.containerRef} className="mt-3 rounded-2xl border border-danger/30 bg-danger-soft p-4 text-sm text-danger" role="alert">
        <div className="flex items-center gap-2"><AlertTriangle className="size-4" />{message}</div>
      </section>
    );
  }

  const staticDiagnostics: LocalAppDiagnostic[] = snapshot.validation.issues.map((issue) => ({
    phase: 'build', code: issue.code, message: issue.message,
  })) ?? [];
  const timeoutDiagnostics: LocalAppDiagnostic[] = runtimeHealth === 'timeout'
    ? [{ phase: 'boot', code: 'boot_timeout', message: messages(language).chat.productDelivery.previewTimeout }]
    : [];
  const diagnostics = [...staticDiagnostics, ...runtimeDiagnostics, ...timeoutDiagnostics];
  const validationFailed = snapshot.status === 'invalid' || snapshot.validation.status === 'failed';
  const hasFailure = validationFailed || runtimeHealth === 'failed' || runtimeHealth === 'timeout';
  const booting = !validationFailed && Boolean(snapshot.previewUrl) && runtimeHealth === 'booting';
  const statusLabel = validationFailed
    ? (language === 'zh' ? '校验失败' : 'Validation failed')
    : runtimeHealth === 'healthy'
      ? (language === 'zh' ? '运行正常' : 'Running')
      : runtimeHealth === 'booting'
        ? (language === 'zh' ? '正在启动' : 'Starting')
        : runtimeHealth === 'timeout'
          ? (language === 'zh' ? '启动超时' : 'Start timed out')
          : (language === 'zh' ? '运行错误' : 'Runtime error');

  const retry = () => {
    setActionError(null);
    setPreviewKey((current) => current + 1);
  };

  const askToFix = async () => {
    if (!diagnostics.length) return;
    setFixBusy(true);
    setActionError(null);
    try {
      const guidance = await getLocalAppFixGuidance(reference.id, {
        sourceHash: snapshot.sourceHash,
        locale: language,
        diagnostics,
      });
      if (guidance.action === 'retry') { retry(); return; }
      const conversationId = await resolveLocalAppDevelopmentConversation(reference.id);
      navigate(localAppConversationUrl(conversationId, guidance.prompt));
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setFixBusy(false);
    }
  };

  return (
    <section ref={lease.containerRef} className="content-block-action-scope mt-3 overflow-hidden rounded-2xl bg-surface-inset" data-inline-local-app={reference.id}>
      <header className="flex min-w-0 flex-wrap items-center gap-3 border-b border-edge-subtle px-4 py-3">
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-sm font-semibold text-fg" title={reference.title}>{reference.title}</h3>
          <p className={cn('mt-0.5 text-xs', hasFailure ? 'text-danger' : 'text-fg-muted')} aria-live="polite">
            {statusLabel}
          </p>
        </div>
        <Button variant="ghost" className="content-block-action" onClick={retry} data-action-visible={hasFailure}
          title={language === 'zh' ? '重新加载预览' : 'Reload preview'} aria-label={language === 'zh' ? '重新加载预览' : 'Reload preview'}>
          <RefreshCw className="size-4" aria-hidden />
        </Button>
        <Button variant="ghost" className="content-block-action" onClick={open}
          title={language === 'zh' ? '查看预览' : 'Preview'} aria-label={language === 'zh' ? '查看预览' : 'Preview'}>
          <ExternalLink className="size-4" aria-hidden />
        </Button>
      </header>
      <div className="relative bg-surface-base" style={{ height }} aria-busy={booting || undefined}>
        {snapshot.previewUrl ? (
          <iframe
            key={previewKey}
            ref={iframeRef}
            title={language === 'zh' ? `${reference.title} 交互预览` : `${reference.title} interactive preview`}
            src={apiUrl(snapshot.previewUrl)}
            sandbox="allow-scripts allow-forms"
            className={cn('block h-full w-full border-0 bg-white', booting && 'invisible')}
          />
        ) : null}
        {booting && <GenerationPlaceholder kind="preview" className="pointer-events-none absolute inset-0 rounded-none" />}
      </div>
      {hasFailure ? (
        <footer className="border-t border-danger/20 bg-danger-soft/60 px-4 py-3">
          <div className="flex flex-wrap items-center gap-3">
            <p className="min-w-0 flex-1 text-xs text-danger">
              {runtimeIssue?.message ?? diagnostics[0]?.message ?? (language === 'zh' ? '预览校验失败' : 'Preview validation failed')}
            </p>
            <Button variant="secondary" className="min-h-9 px-3 text-xs" disabled={fixBusy || diagnostics.length === 0} onClick={() => void askToFix()}>
              <Wrench className="size-4" />
              {fixBusy ? (language === 'zh' ? '生成修复建议…' : 'Preparing fix…') : (language === 'zh' ? '让 Coder 修复' : 'Ask Coder to fix')}
            </Button>
          </div>
          {actionError ? <p className="mt-2 text-xs text-danger" role="alert">{actionError}</p> : null}
        </footer>
      ) : null}
    </section>
  );
}
