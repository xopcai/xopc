// @vitest-environment jsdom

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { MarkdownView } from '@/components/markdown/markdown-view';
import type { WorkspaceFileLinkTarget } from '@/components/markdown/internal-links';

const mounted: Array<{ container: HTMLDivElement; unmount: () => void }> = [];

afterEach(() => {
  for (const entry of mounted.splice(0)) {
    act(entry.unmount);
    entry.container.remove();
  }
  Object.defineProperty(window, 'electronAPI', { configurable: true, value: undefined });
});

function LocationProbe() {
  const location = useLocation();
  return <output data-location>{location.pathname}</output>;
}

function renderMarkdown(
  content = '[Example](https://example.com)',
  onWorkspaceFileOpen?: (target: WorkspaceFileLinkTarget) => void,
): HTMLDivElement {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(
      <MemoryRouter>
        <MarkdownView content={content} onWorkspaceFileOpen={onWorkspaceFileOpen} />
        <LocationProbe />
      </MemoryRouter>,
    );
  });
  mounted.push({ container, unmount: () => root.unmount() });
  return container;
}

describe('MarkdownView links', () => {
  it('opens external links separately by default', () => {
    const anchor = renderMarkdown().querySelector('a');

    expect(anchor?.getAttribute('target')).toBe('_blank');
    expect(anchor?.getAttribute('rel')).toContain('noopener');
    expect(anchor?.getAttribute('rel')).toContain('noreferrer');
  });

  it('keeps internal product links in the app', () => {
    const container = renderMarkdown('[Note](xopc://open?kind=note&id=note-1)');
    const anchor = container.querySelector('a');

    expect(anchor?.getAttribute('href')).toBe('#/notes/note-1');
    expect(anchor?.getAttribute('target')).toBeNull();

    act(() => anchor?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })));
    expect(container.querySelector('[data-location]')?.textContent).toBe('/notes/note-1');
  });

  it('uses the Electron bridge for external link clicks', async () => {
    const openExternalUrl = vi.fn(async () => ({ ok: true as const }));
    Object.defineProperty(window, 'electronAPI', {
      configurable: true,
      value: { shell: { openExternalUrl } },
    });
    const anchor = renderMarkdown().querySelector('a');

    act(() => anchor?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })));

    await vi.waitFor(() => expect(openExternalUrl).toHaveBeenCalledWith('https://example.com/'));
  });

  it('opens a bare non-ASCII output filename as a workspace file', () => {
    const onOpen = vi.fn();
    const container = renderMarkdown(
      '已完成：**销售明细查询-按客户分类汇总-2026-09-02.xlsx**',
      onOpen,
    );
    const anchor = container.querySelector('a.markdown-file-link');

    expect(anchor?.textContent).toBe('销售明细查询-按客户分类汇总-2026-09-02.xlsx');
    act(() => anchor?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })));
    expect(onOpen).toHaveBeenCalledWith({
      path: '销售明细查询-按客户分类汇总-2026-09-02.xlsx',
      kind: 'workspace-relative',
      line: undefined,
    });
  });

  it('normalizes a file URL before opening the workspace file', () => {
    const onOpen = vi.fn();
    const container = renderMarkdown('[下载](file:///Users/me/My%20Report.xlsx)', onOpen);
    const anchor = container.querySelector('a');

    expect(anchor?.getAttribute('href')).toBe('/xopc/workspace/file?path=%2FUsers%2Fme%2FMy+Report.xlsx');
    act(() => anchor?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })));
    expect(onOpen).toHaveBeenCalledWith({
      path: '/Users/me/My Report.xlsx',
      kind: 'absolute',
    });
  });
});
