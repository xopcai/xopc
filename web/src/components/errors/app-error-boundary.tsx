import { Component, useMemo, useState, type ErrorInfo, type ReactNode } from 'react';
import { useRouteError } from 'react-router-dom';

import { Button } from '@/components/ui/button';
import { webBuildInfo } from '@/lib/build-info';
import { copyTextToClipboard } from '@/lib/copy-to-clipboard';
import { getLanguage, type StoredLanguage } from '@/lib/storage';

const OFFICIAL_DOWNLOAD_URLS: Record<StoredLanguage, string> = {
  en: 'https://xopc.ai/en#download',
  zh: 'https://xopc.ai/zh#download',
};

const GITHUB_BUG_REPORT_URL =
  'https://github.com/xopcai/xopc/issues/new?template=bug_report.yml&title=%5BBug%5D%3A%20Desktop%20renderer%20error';

export type AppErrorSource =
  | 'bootstrap'
  | 'react'
  | 'route'
  | 'window.error'
  | 'unhandledrejection';

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
    copyReport: 'Copy error report',
    reportIssue: 'Report on GitHub',
    copied: 'Error report copied. Paste it into the GitHub report after checking for sensitive data.',
    copyFailed: 'Could not copy automatically. Copy the technical details below manually.',
    reportHint: 'Review the report and remove sensitive data before posting it publicly.',
    openFailed: 'Could not open the system browser. Visit xopc.ai to download the latest version.',
  },
  zh: {
    eyebrow: 'xopc 恢复模式',
    title: '应用遇到问题，暂时无法继续',
    description: '当前版本可能与运行环境不兼容。请前往官网下载并安装最新桌面版，然后重新打开 xopc。',
    download: '去官网下载最新版',
    reload: '重新加载',
    details: '技术详情',
    copyReport: '复制错误报告',
    reportIssue: '上报 GitHub',
    copied: '错误报告已复制。检查并移除敏感信息后，请粘贴到 GitHub 报告中。',
    copyFailed: '无法自动复制，请手动复制下方技术详情。',
    reportHint: '公开提交前，请检查报告并移除可能的敏感信息。',
    openFailed: '无法打开系统浏览器，请访问 xopc.ai 下载最新版本。',
  },
};

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.stack || error.message;
  if (typeof error === 'string') return error;
  try {
    return JSON.stringify(error, null, 2);
  } catch {
    return String(error);
  }
}

export function officialDownloadUrl(language: StoredLanguage = getLanguage()): string {
  return OFFICIAL_DOWNLOAD_URLS[language];
}

function safePageLocation(): string {
  const route = window.location.hash.replace(/^#\/?/, '').split(/[/?]/, 1)[0];
  return `${window.location.origin}${window.location.pathname}${route ? `#/${route}` : ''}`;
}

export function buildAppErrorReport({
  error,
  source,
  componentStack,
  capturedAt = new Date(),
}: {
  error: unknown;
  source: AppErrorSource;
  componentStack?: string;
  capturedAt?: Date;
}): string {
  const surface = window.electronAPI ? 'Electron desktop app' : 'Gateway web UI';
  const platform = window.electronAPI?.platform ?? navigator.platform ?? 'unknown';
  const commit = webBuildInfo.commit === 'unknown' ? 'unknown' : webBuildInfo.commit.slice(0, 12);
  const sections = [
    '# xopc renderer error report',
    '',
    `- xopc web version: ${webBuildInfo.version}`,
    `- Commit: ${commit}`,
    `- Build time: ${webBuildInfo.buildTimeIso}`,
    `- Captured at: ${capturedAt.toISOString()}`,
    `- Source: ${source}`,
    `- Surface: ${surface}`,
    `- Platform: ${platform}`,
    `- Language: ${getLanguage()}`,
    `- Page: ${safePageLocation()}`,
    `- User agent: ${navigator.userAgent}`,
    '',
    '## Error',
    '',
    '```text',
    errorMessage(error),
    '```',
  ];

  if (componentStack?.trim()) {
    sections.push('', '## React component stack', '', '```text', componentStack.trim(), '```');
  }
  return sections.join('\n');
}

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
  const [capturedAt] = useState(() => new Date());
  const report = useMemo(
    () => buildAppErrorReport({ error, source, componentStack, capturedAt }),
    [capturedAt, componentStack, error, source],
  );

  const handleDownload = async () => {
    const result = await openExternalPage(downloadUrl);
    setOpenError(result ? `${copy.openFailed} (${result})` : null);
  };

  const handleCopyReport = async (): Promise<boolean> => {
    const copied = await copyTextToClipboard(report);
    setCopyStatus(copied ? 'copied' : 'failed');
    return copied;
  };

  const handleReportIssue = async () => {
    await handleCopyReport();
    const result = await openExternalPage(GITHUB_BUG_REPORT_URL);
    setOpenError(result ? `${copy.openFailed} (${result})` : null);
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
          <Button className="sm:flex-1" variant="ghost" onClick={() => void handleCopyReport()}>
            {copy.copyReport}
          </Button>
          <Button className="sm:flex-1" variant="ghost" onClick={() => void handleReportIssue()}>
            {copy.reportIssue}
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
