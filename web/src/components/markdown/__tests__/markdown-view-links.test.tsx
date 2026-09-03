// @vitest-environment jsdom

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { MarkdownView } from '@/components/markdown/markdown-view';
import type { WorkspaceFileLinkTarget } from '@/components/markdown/internal-links';
import { useLocaleStore } from '@/stores/locale-store';

const mounted: Array<{ container: HTMLDivElement; unmount: () => void }> = [];

afterEach(() => {
  for (const entry of mounted.splice(0)) {
    act(entry.unmount);
    entry.container.remove();
  }
  Object.defineProperty(window, 'electronAPI', { configurable: true, value: undefined });
  useLocaleStore.setState({ language: 'en' });
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
  const key = 'agent:coder:webchat:default:direct:chat_801605448ec548c9b90d1c4eb5024727';
  const url = `xopc://open?kind=session&key=${key}`;

  it.each([
    `[Open in xopc](${url})`,
    `[${url}](${url})`,
    url,
    `<${url}>`,
    `[新会话](<${url}> "会话详情")`,
    `[新会话][session]\n\n[session]: ${url}`,
    `[${url.replace('_', '\\_')}]\\(${url.replace('_', '\\_')}\\)`,
    `**新会话链接：**\n\n${url}。`,
  ])('opens the reported session link: %s', (markdown) => {
    const container = renderMarkdown(markdown);
    const anchor = container.querySelector('a');
    expect(container.querySelectorAll('a')).toHaveLength(1);
    expect(anchor?.getAttribute('href')).toBe(`#/chat/${encodeURIComponent(key)}`);
    act(() => anchor?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })));
    expect(container.querySelector('[data-location]')?.textContent).toBe(`/chat/${encodeURIComponent(key)}`);
  });

  it('localizes generic labels while preserving descriptive titles', () => {
    useLocaleStore.setState({ language: 'zh' });
    const container = renderMarkdown(`[Open in xopc](${url}) [需求讨论](${url})`);
    const anchors = container.querySelectorAll('a');
    expect(anchors[0]?.textContent).toBe('打开会话');
    expect(anchors[1]?.textContent).toBe('需求讨论');
    expect(anchors[1]?.title).toBe('打开会话');
  });

  it('shows unavailable targets without a clickable affordance', () => {
    useLocaleStore.setState({ language: 'zh' });
    const container = renderMarkdown('[无效](xopc://open?kind=session) [危险](javascript:alert%281%29)');
    expect(container.querySelectorAll('a[href]')).toHaveLength(0);
    for (const anchor of container.querySelectorAll('a')) {
      expect(anchor.getAttribute('aria-disabled')).toBe('true');
      expect(anchor.dataset.xopcLinkHint).toBe('链接不可用');
    }
  });

  it('preserves native modified-click navigation', () => {
    const container = renderMarkdown(`[新会话](${url})`);
    const event = new MouseEvent('click', { bubbles: true, cancelable: true, metaKey: true });
    act(() => container.querySelector('a')?.dispatchEvent(event));
    expect(event.defaultPrevented).toBe(false);
    expect(container.querySelector('[data-location]')?.textContent).toBe('/');
  });

  it('reports external opening failures', async () => {
    Object.defineProperty(window, 'electronAPI', {
      configurable: true,
      value: { shell: { openExternalUrl: vi.fn(async () => ({ ok: false, error: 'Failed' })) } },
    });
    const container = renderMarkdown();
    await act(async () => {
      container.querySelector('a')?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('Unable to open this link');
  });

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
