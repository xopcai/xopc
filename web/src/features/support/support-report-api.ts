import { fetchJson } from '@/lib/fetch';
import { apiUrl } from '@/lib/url';

export type SupportReportInput = {
  problem: string;
  expected?: string;
  reproduction?: string;
  occurredAt?: string;
  sessionKey?: string;
  requestId?: string;
  clientContext?: {
    currentPage?: string;
    rendererError?: string;
    surface?: 'web' | 'electron';
    userAgent?: string;
  };
};

export type SupportReport = {
  schemaVersion: 1;
  title: string;
  capturedAt: string;
  markdown: string;
  doctor: Array<{ status: string }>;
  logs: Array<unknown>;
  redaction: { replacements: number };
};

export type SupportInvestigationPreparation = {
  report: SupportReport;
  investigationPrompt: string;
};

export async function prepareSupportInvestigation(
  input: SupportReportInput,
): Promise<SupportInvestigationPreparation> {
  const result = await fetchJson<{
    ok: true;
    report: SupportReport;
    investigationPrompt: string;
  }>(apiUrl('/api/support/report'), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });
  return { report: result.report, investigationPrompt: result.investigationPrompt };
}

export function downloadSupportReport(report: SupportReport): void {
  const stamp = new Date(report.capturedAt).toISOString().replace(/[:.]/g, '-');
  const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `xopc-diagnostics-${stamp}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function githubIssueUrl(report: SupportReport, truncatedNotice: string): string {
  const maxBodyLength = 6_000;
  const body = report.markdown.length <= maxBodyLength
    ? report.markdown
    : `${report.markdown.slice(0, maxBodyLength)}\n\n---\n${truncatedNotice}`;
  const query = new URLSearchParams({ title: report.title, body });
  return `https://github.com/xopcai/xopc/issues/new?${query.toString()}`;
}

export async function openSupportIssue(url: string): Promise<boolean> {
  const openExternal = window.electronAPI?.shell?.openExternalUrl;
  if (openExternal) {
    try {
      return (await openExternal(url)).ok;
    } catch {
      return false;
    }
  }
  return window.open(url, '_blank', 'noopener,noreferrer') !== null;
}
