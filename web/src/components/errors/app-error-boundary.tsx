import { Component, useMemo, useState, type ErrorInfo, type ReactNode } from 'react';
import { useRouteError } from 'react-router-dom';

import { Button } from '@/components/ui/button';
import {
  githubIssueUrl,
  openSupportIssue,
  prepareSupportInvestigation,
  type SupportReport,
} from '@/features/support/support-report-api';
import { copyTextToClipboard } from '@/lib/copy-to-clipboard';
import { getLanguage, type StoredLanguage } from '@/lib/storage';

import {
  buildAppErrorReport,
  officialDownloadUrl,
  type AppErrorSource,
} from './app-error-boundary.utils';

type ErrorFallbackCopy = {
  eyebrow: string;
  title: string;
  description: string;
  download: string;
  reload: string;
  details: string;
  copyReport: string;
  reportIssue: string;
  copied: string;
  copyFailed: string;
  collecting: string;
  collectFailed: string;
  githubTruncated: string;
  reportHint: string;
  openFailed: string;
};

const COPY: Record<StoredLanguage, ErrorFallbackCopy> = {
  en: {
    eyebrow: 'xopc recovery',
    title: 'The app ran into a problem',
    description:
      'This version may be incompatible with the current runtime. Download and install the latest desktop version from the official website, then open xopc again.',
    download: 'Download the latest version',
    reload: 'Reload',
    details: 'Technical details',
    copyReport: 'Collect and copy report',
    reportIssue: 'Report on GitHub',
    copied: 'The redacted diagnostic report was copied.',
    copyFailed: 'Could not copy the diagnostic report automatically.',
    collecting: 'Collecting diagnostics…',
    collectFailed: 'Could not collect diagnostics. Run `xopc support report` in a terminal instead.',
    githubTruncated: 'The complete report was copied to the clipboard. Paste it into the issue or upload the downloaded diagnostics file.',
    reportHint: 'These raw technical details stay on this page. Public reports use the redacted diagnostic report.',
    openFailed: 'Could not open the system browser. Visit xopc.ai to download the latest version.',
  },
  zh: {
    eyebrow: 'xopc 恢复模式',
    title: '应用遇到问题，暂时无法继续',
    description: '当前版本可能与运行环境不兼容。请前往官网下载并安装最新桌面版，然后重新打开 xopc。',
    download: '去官网下载最新版',
    reload: '重新加载',
    details: '技术详情',
    copyReport: '收集并复制报告',
    reportIssue: '上报 GitHub',
    copied: '已复制脱敏后的诊断报告。',
    copyFailed: '无法自动复制诊断报告。',
    collecting: '正在收集诊断信息…',
    collectFailed: '诊断信息收集失败，请在终端运行 `xopc support report`。',
    githubTruncated: '完整报告已复制到剪贴板，请粘贴到 Issue 中，或上传下载的诊断文件。',
    reportHint: '这里显示的是本地原始技术详情；公开提交时会使用自动脱敏后的诊断报告。',
    openFailed: '无法打开系统浏览器，请访问 xopc.ai 下载最新版本。',
  },
};

async function openExternalPage(url: string): Promise<string | null> {
  const openExternalUrl = window.electronAPI?.shell?.openExternalUrl;
  if (openExternalUrl) {
    try {
      const result = await openExternalUrl(url);
      return result.ok ? null : result.error;
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
  }

  window.location.assign(url);
  return null;
}

export function AppErrorFallback({
  error,
  source = 'react',
  componentStack,
}: {
  error: unknown;
  source?: AppErrorSource;
  componentStack?: string;
}) {
  const language = getLanguage();
  const copy = COPY[language];
  const downloadUrl = officialDownloadUrl(language);
  const [openError, setOpenError] = useState<string | null>(null);
  const [copyStatus, setCopyStatus] = useState<'copied' | 'failed' | null>(null);
  const [collecting, setCollecting] = useState(false);
  const [supportReport, setSupportReport] = useState<SupportReport | null>(null);
  const [capturedAt] = useState(() => new Date());
  const report = useMemo(
    () => buildAppErrorReport({ error, source, componentStack, capturedAt }),
    [capturedAt, componentStack, error, source],
  );

  const handleDownload = async () => {
    const result = await openExternalPage(downloadUrl);
    setOpenError(result ? `${copy.openFailed} (${result})` : null);
  };

  const collectReport = async (): Promise<SupportReport | null> => {
    if (supportReport) return supportReport;
    setCollecting(true);
    setOpenError(null);
    try {
      const prepared = await prepareSupportInvestigation({
        problem: `Renderer error (${source})`,
        occurredAt: capturedAt.toISOString(),
        clientContext: {
          rendererError: report,
          surface: window.electronAPI ? 'electron' : 'web',
          userAgent: navigator.userAgent,
        },
      });
      const collected = prepared.report;
      setSupportReport(collected);
      return collected;
    } catch {
      setOpenError(copy.collectFailed);
      return null;
    } finally {
      setCollecting(false);
    }
  };

  const handleCopyReport = async (): Promise<boolean> => {
    const collected = await collectReport();
    if (!collected) return false;
    const copied = await copyTextToClipboard(collected.markdown);
    setCopyStatus(copied ? 'copied' : 'failed');
    return copied;
  };

  const handleReportIssue = async () => {
    const collected = await collectReport();
    if (!collected) return;
    if (collected.markdown.length > 6_000) await handleCopyReport();
    const opened = await openSupportIssue(githubIssueUrl(collected, copy.githubTruncated));
    setOpenError(opened ? null : copy.openFailed);
  };

  return (
    <main className="flex min-h-dvh items-center justify-center bg-surface-base px-5 py-12 text-fg">
      <section className="w-full max-w-lg rounded-2xl border border-edge bg-surface-panel p-6 shadow-surface sm:p-8">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-accent">{copy.eyebrow}</p>
        <h1 className="mt-3 text-2xl font-semibold tracking-tight">{copy.title}</h1>
        <p className="mt-3 text-sm leading-6 text-fg-muted">{copy.description}</p>

        <div className="mt-6 flex flex-col gap-2 sm:flex-row">
          <Button className="sm:flex-1" variant="primary" onClick={() => void handleDownload()}>
            {copy.download}
          </Button>
          <Button className="sm:flex-1" onClick={() => window.location.reload()}>
            {copy.reload}
          </Button>
        </div>

        <div className="mt-2 flex flex-col gap-2 sm:flex-row">
          <Button className="sm:flex-1" variant="ghost" disabled={collecting} onClick={() => void handleCopyReport()}>
            {collecting ? copy.collecting : copy.copyReport}
          </Button>
          <Button className="sm:flex-1" variant="ghost" disabled={collecting} onClick={() => void handleReportIssue()}>
            {collecting ? copy.collecting : copy.reportIssue}
          </Button>
        </div>

        {copyStatus ? (
          <p
            className={`mt-4 rounded-xl px-3 py-2 text-sm ${
              copyStatus === 'copied' ? 'bg-accent-soft text-accent' : 'bg-warning-soft text-warning'
            }`}
            role="status"
          >
            {copyStatus === 'copied' ? copy.copied : copy.copyFailed}
          </p>
        ) : null}

        {openError ? (
          <p className="mt-4 rounded-xl bg-warning-soft px-3 py-2 text-sm text-warning" role="alert">
            {openError}
          </p>
        ) : null}

        <details className="mt-6 border-t border-edge pt-4 text-xs text-fg-subtle" open>
          <summary className="cursor-pointer select-none font-medium text-fg-muted">{copy.details}</summary>
          <p className="mt-2 leading-5 text-warning">{copy.reportHint}</p>
          <pre className="mt-3 max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-xl bg-surface-base p-3 font-mono leading-5">
            {report}
          </pre>
        </details>
      </section>
    </main>
  );
}

export function RouteErrorFallback() {
  return <AppErrorFallback error={useRouteError()} source="route" />;
}

type AppErrorBoundaryState = { componentStack?: string; error: unknown; hasError: boolean };

export class AppErrorBoundary extends Component<{ children: ReactNode }, AppErrorBoundaryState> {
  state: AppErrorBoundaryState = { error: null, hasError: false };

  static getDerivedStateFromError(error: unknown): AppErrorBoundaryState {
    return { error, hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('Uncaught renderer error', error, info.componentStack);
    this.setState({ componentStack: info.componentStack ?? undefined });
  }

  render() {
    if (this.state.hasError) {
      return (
        <AppErrorFallback
          componentStack={this.state.componentStack}
          error={this.state.error}
          source="react"
        />
      );
    }
    return this.props.children;
  }
}
