import { describe, expect, it } from 'vitest';

import { githubIssueUrl, type SupportReport } from '../support-report-api';

function report(markdown: string): SupportReport {
  return {
    schemaVersion: 1,
    title: '[Bug] Replies stop unexpectedly',
    capturedAt: '2026-09-02T00:00:00.000Z',
    markdown,
    doctor: [],
    logs: [],
    redaction: { replacements: 0 },
  };
}

describe('githubIssueUrl', () => {
  it('prefills the issue title and report body', () => {
    const url = new URL(githubIssueUrl(report('# Diagnostic report'), 'truncated'));

    expect(url.origin + url.pathname).toBe('https://github.com/xopcai/xopc/issues/new');
    expect(url.searchParams.get('title')).toBe('[Bug] Replies stop unexpectedly');
    expect(url.searchParams.get('body')).toBe('# Diagnostic report');
  });

  it('bounds a long body and appends the localized notice', () => {
    const url = new URL(githubIssueUrl(report('a'.repeat(6_001)), 'Upload the full report.'));
    const body = url.searchParams.get('body');

    expect(body).toContain('a'.repeat(6_000));
    expect(body).toContain('Upload the full report.');
    expect(body).not.toContain('a'.repeat(6_001));
  });
});
