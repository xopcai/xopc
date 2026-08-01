import { describe, expect, it } from 'vitest';

import { getLoadingPageDataUrl } from '../loading-page.js';

function decodePage(dataUrl: string): string {
  const prefix = 'data:text/html;charset=utf-8,';
  expect(dataUrl.startsWith(prefix)).toBe(true);
  return decodeURIComponent(dataUrl.slice(prefix.length));
}

describe('getLoadingPageDataUrl', () => {
  it('presents startup as a branded product experience', () => {
    const html = decodePage(getLoadingPageDataUrl('en-US'));

    expect(html).toContain('Waking up your workspace');
    expect(html).toContain('Preparing your assistant…');
    expect(html).toContain('Local-first · Your data stays yours');
    expect(html).not.toContain('Starting local gateway');
  });

  it('uses Chinese copy for non-English app locales', () => {
    const html = decodePage(getLoadingPageDataUrl('zh-CN'));

    expect(html).toContain('正在唤醒你的工作空间');
    expect(html).toContain('正在准备你的助手…');
    expect(html).toContain('本地优先 · 你的数据由你掌控');
  });

  it('supports dark mode and reduced motion', () => {
    const html = decodePage(getLoadingPageDataUrl('en'));

    expect(html).toContain('@media (prefers-color-scheme: dark)');
    expect(html).toContain('@media (prefers-reduced-motion: reduce)');
  });

  it('renders real startup phases and progressively explains a slow launch', () => {
    const html = decodePage(getLoadingPageDataUrl('en'));

    expect(html).toContain("typeof api.onProgress === 'function'");
    expect(html).toContain('Preparing your workspace…');
    expect(html).toContain('Starting the local core…');
    expect(html).toContain('Connecting your assistant…');
    expect(html).toContain('First launch or an update can take a little longer.');
    expect(html).toContain('Still working locally — xopc will keep trying.');
    expect(html).toContain("detail.phase === 'opening-workspace'");
    expect(html).toContain("classList.add('is-ready')");
    expect(html).not.toContain('startup.onFailed');
  });
});
