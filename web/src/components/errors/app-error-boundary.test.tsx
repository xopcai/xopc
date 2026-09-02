// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/build-info', () => ({
  webBuildInfo: {
    buildTimeIso: '2026-08-28T00:00:00.000Z',
    commit: '1234567890abcdef',
    version: '0.0.211',
  },
}));

const supportApi = vi.hoisted(() => ({
  prepareSupportInvestigation: vi.fn(),
}));

vi.mock('@/features/support/support-report-api', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/features/support/support-report-api')>(),
  prepareSupportInvestigation: supportApi.prepareSupportInvestigation,
}));

import { AppErrorBoundary, AppErrorFallback } from './app-error-boundary';
import { buildAppErrorReport } from './app-error-boundary.utils';

describe('AppErrorFallback', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
      .IS_REACT_ACT_ENVIRONMENT = true;
    localStorage.clear();
    Object.defineProperty(window, 'electronAPI', {
      configurable: true,
      value: undefined,
      writable: true,
    });
    supportApi.prepareSupportInvestigation.mockReset();
    supportApi.prepareSupportInvestigation.mockResolvedValue({
      investigationPrompt: 'investigate',
      report: {
        schemaVersion: 1,
        title: '[Bug] Renderer error',
        capturedAt: '2026-08-28T12:00:00.000Z',
        markdown: '# redacted diagnostic report',
        doctor: [],
        logs: [],
        redaction: { replacements: 1 },
      },
    });
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.restoreAllMocks();
  });

  it('opens the localized official download page through Electron', async () => {
    localStorage.setItem('xopc.language', 'zh');
    const openExternalUrl = vi.fn(async () => ({ ok: true as const }));
    const writeText = vi.fn(async () => true);
    window.electronAPI = {
      clipboard: { writeText },
      shell: { openExternalUrl },
    } as unknown as Window['electronAPI'];

    act(() => root.render(<AppErrorFallback error={new Error('React error #185')} />));

    const downloadButton = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent === '去官网下载最新版',
    );
    expect(downloadButton).toBeDefined();

    await act(async () => downloadButton?.click());

    expect(openExternalUrl).toHaveBeenCalledWith('https://xopc.ai/zh#download');
    expect(container.textContent).toContain('技术详情');

    const reportButton = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent === '上报 GitHub',
    );
    await act(async () => reportButton?.click());

    expect(supportApi.prepareSupportInvestigation).toHaveBeenCalledWith(expect.objectContaining({
      problem: 'Renderer error (react)',
      clientContext: expect.objectContaining({ rendererError: expect.stringContaining('React error #185') }),
    }));
    expect(writeText).not.toHaveBeenCalled();
    expect(openExternalUrl).toHaveBeenCalledWith(
      expect.stringContaining('github.com/xopcai/xopc/issues/new'),
    );
  });

  it('builds a shareable report without exposing route identifiers', () => {
    window.location.hash = '#/share/private-share-token?access=secret';
    const report = buildAppErrorReport({
      error: new Error('renderer failed'),
      source: 'unhandledrejection',
      componentStack: 'at BrokenComponent',
      capturedAt: new Date('2026-08-28T12:00:00.000Z'),
    });

    expect(report).toContain('# xopc renderer error report');
    expect(report).toContain('- Source: unhandledrejection');
    expect(report).toContain('- Page: http://localhost:3000/#/share');
    expect(report).toContain('renderer failed');
    expect(report).toContain('at BrokenComponent');
    expect(report).not.toContain('private-share-token');
    expect(report).not.toContain('access=secret');
  });

  it('copies only the report returned by the redacted diagnostics API', async () => {
    localStorage.setItem('xopc.language', 'en');
    const writeText = vi.fn(async () => true);
    window.electronAPI = { clipboard: { writeText } } as unknown as Window['electronAPI'];

    act(() => root.render(<AppErrorFallback error={new Error('raw renderer detail')} />));
    const copyButton = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent === 'Collect and copy report',
    );
    await act(async () => copyButton?.click());

    expect(writeText).toHaveBeenCalledWith('# redacted diagnostic report');
    expect(writeText).not.toHaveBeenCalledWith(expect.stringContaining('raw renderer detail'));
    expect(container.textContent).toContain('The redacted diagnostic report was copied.');
  });

  it('offers the CLI fallback when diagnostics collection fails', async () => {
    localStorage.setItem('xopc.language', 'en');
    supportApi.prepareSupportInvestigation.mockRejectedValueOnce(new Error('gateway unavailable'));

    act(() => root.render(<AppErrorFallback error={new Error('renderer failed')} />));
    const copyButton = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent === 'Collect and copy report',
    );
    await act(async () => copyButton?.click());

    expect(container.textContent).toContain('xopc support report');
  });

  it('catches renderer errors outside the router', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});

    function Broken(): never {
      throw new Error('renderer failed');
    }

    act(() => {
      root.render(
        <AppErrorBoundary>
          <Broken />
        </AppErrorBoundary>,
      );
    });

    expect(container.textContent).toContain('The app ran into a problem');
    expect(container.textContent).toContain('renderer failed');
  });
});
