import type { ProductReference } from '@xopcai/gateway-contract';
import { AlertTriangle, ExternalLink, RefreshCw, Wrench } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import useSWR from 'swr';

import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { dispatchFillChatComposer } from '@/features/chat/composer/fill-composer-dispatch';
import {
  getLocalApp,
  getLocalAppFixGuidance,
  type LocalAppDiagnostic,
  validateLocalApp,
} from '@/features/local-apps/api';
import { localAppOpenRoute } from '@/features/local-apps/open-route';
import { attachLocalAppPreviewChannel } from '@/features/local-apps/preview-channel';
import {
  formatLocalAppRuntimeIssue,
  parseLocalAppRuntimeMessage,
  type LocalAppRuntimeIssue,
} from '@/features/local-apps/runtime-health';
import { cn } from '@/lib/cn';
import { withDetailReturnTo } from '@/lib/navigation-return';
import { apiUrl } from '@/lib/url';

type RuntimeHealth = 'booting' | 'healthy' | 'failed' | 'timeout';

function InlineLocalAppSkeleton({ height }: { height: number }) {
  return (
    <section className="mt-3 overflow-hidden rounded-2xl border border-edge bg-surface-panel" aria-label="Loading app preview">
      <div className="flex items-center justify-between gap-3 border-b border-edge-subtle px-4 py-3">
        <Skeleton className="h-5 w-40" />
        <Skeleton className="h-9 w-24" />
      </div>
      <Skeleton className="m-3 w-[calc(100%-1.5rem)]" style={{ height }} />
    </section>
  );
}

export function InlineLocalApp({
  reference,
  preferredHeight,
  language,
}: {
  reference: ProductReference;
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
  const appQuery = useSWR(['inline-local-app', reference.id], () => getLocalApp(reference.id), {
    revalidateOnFocus: false,
    shouldRetryOnError: false,
  });
  const validationQuery = useSWR(
    appQuery.data ? ['inline-local-app-validation', reference.id, previewKey] : null,
    () => validateLocalApp(reference.id),
    { revalidateOnFocus: false, shouldRetryOnError: false },
  );

  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe || !appQuery.data) return;
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
  }, [appQuery.data, previewKey]);

  if (appQuery.isLoading) return <InlineLocalAppSkeleton height={height} />;

  const app = appQuery.data;
  if (!app) {
    const message = appQuery.error instanceof Error ? appQuery.error.message : (language === 'zh' ? '无法加载应用预览' : 'Unable to load app preview');
    return (
      <section className="mt-3 rounded-2xl border border-danger/30 bg-danger-soft p-4 text-sm text-danger" role="alert">
        <div className="flex items-center gap-2"><AlertTriangle className="size-4" />{message}</div>
      </section>
    );
  }

  const staticDiagnostics: LocalAppDiagnostic[] = validationQuery.data?.issues.map((issue) => ({
    phase: 'build', code: issue.code, message: issue.message,
  })) ?? [];
  const timeoutDiagnostics: LocalAppDiagnostic[] = runtimeHealth === 'timeout'
    ? [{ phase: 'boot', code: 'boot_timeout', message: 'Preview did not report ready within 7 seconds.' }]
    : [];
  const diagnostics = [...staticDiagnostics, ...runtimeDiagnostics, ...timeoutDiagnostics];
  const validationFailed = validationQuery.data?.status === 'failed';
  const hasFailure = validationFailed || runtimeHealth === 'failed' || runtimeHealth === 'timeout';
  const revisionChanged = Boolean(
    reference.revision
    && validationQuery.data?.sourceHash
    && reference.revision !== validationQuery.data.sourceHash,
  );
  const statusLabel = validationFailed
    ? (language === 'zh' ? '校验失败' : 'Validation failed')
    : runtimeHealth === 'healthy'
      ? revisionChanged
        ? (language === 'zh' ? '草稿已更新，当前显示最新版本' : 'Draft changed; showing the latest version')
        : (language === 'zh' ? '运行正常' : 'Running')
      : runtimeHealth === 'booting'
        ? (language === 'zh' ? '正在启动' : 'Starting')
        : runtimeHealth === 'timeout'
          ? (language === 'zh' ? '启动超时' : 'Start timed out')
          : (language === 'zh' ? '运行错误' : 'Runtime error');

  const retry = () => {
    setActionError(null);
    setPreviewKey((current) => current + 1);
    void appQuery.mutate();
  };

  const askToFix = async () => {
    if (!diagnostics.length) return;
    setFixBusy(true);
    setActionError(null);
    try {
      const guidance = await getLocalAppFixGuidance(app.id, {
        sourceHash: validationQuery.data?.sourceHash,
        locale: language,
        diagnostics,
      });
      dispatchFillChatComposer(guidance.prompt);
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setFixBusy(false);
    }
  };

  const open = () => {
    const route = localAppOpenRoute(app);
    navigate(withDetailReturnTo(route, `${location.pathname}${location.search}`));
  };

  return (
    <section className="mt-3 overflow-hidden rounded-2xl border border-edge bg-surface-panel" data-inline-local-app={app.id}>
      <header className="flex min-w-0 flex-wrap items-center gap-3 border-b border-edge-subtle px-4 py-3">
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-sm font-semibold text-fg" title={app.name}>{app.name}</h3>
          <p className={cn('mt-0.5 text-xs', hasFailure ? 'text-danger' : 'text-fg-muted')} aria-live="polite">
            {statusLabel}
          </p>
        </div>
        <Button variant="ghost" className="min-h-9 px-2.5 text-xs" onClick={retry} aria-label={language === 'zh' ? '重新加载预览' : 'Reload preview'}>
          <RefreshCw className="size-4" />
          {language === 'zh' ? '重试' : 'Retry'}
        </Button>
        <Button variant="ghost" className="min-h-9 px-2.5 text-xs" onClick={open}>
          <ExternalLink className="size-4" />
          {language === 'zh' ? '打开' : 'Open'}
        </Button>
      </header>
      <div className="relative bg-surface-base" style={{ height }}>
        <iframe
          key={previewKey}
          ref={iframeRef}
          title={language === 'zh' ? `${app.name} 交互预览` : `${app.name} interactive preview`}
          src={apiUrl(app.previewUrl)}
          sandbox="allow-scripts allow-forms"
          className="h-full w-full border-0 bg-white"
        />
        {runtimeHealth === 'booting' ? (
          <div className="pointer-events-none absolute inset-0 grid place-items-center bg-surface-base/75">
            <Skeleton className="h-10 w-40" />
          </div>
        ) : null}
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
