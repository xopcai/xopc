import { webBuildInfo } from '@/lib/build-info';
import { getLanguage, type StoredLanguage } from '@/lib/storage';

const OFFICIAL_DOWNLOAD_URLS: Record<StoredLanguage, string> = {
  en: 'https://xopc.ai/en#download',
  zh: 'https://xopc.ai/zh#download',
};

export type AppErrorSource =
  | 'bootstrap'
  | 'react'
  | 'route'
  | 'window.error'
  | 'unhandledrejection';

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
