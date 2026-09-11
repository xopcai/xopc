import { describe, expect, it } from 'vitest';

import { getLoadingPageDataUrl, getStartupRecoveryPageDataUrl } from '../loading-page.js';

function decodePage(dataUrl: string): string {
  const prefix = 'data:text/html;charset=utf-8,';
  expect(dataUrl.startsWith(prefix)).toBe(true);
  return decodeURIComponent(dataUrl.slice(prefix.length));
}

describe('getLoadingPageDataUrl', () => {
  it('presents startup as a branded product experience', () => {
    const html = decodePage(getLoadingPageDataUrl('en-US'));

    expect(html).toContain('Starting xopc');
    expect(html).toContain('Preparing local services…');
    expect(html).toContain('xopc · Running locally');
    expect(html).toContain('Local-first · Your data stays yours');
    expect(html.toLowerCase()).not.toContain('gateway');
  });

  it('uses Chinese copy for non-English app locales', () => {
    const html = decodePage(getLoadingPageDataUrl('zh-CN'));

    expect(html).toContain('正在启动 xopc');
    expect(html).toContain('正在准备本地服务…');
    expect(html).toContain('xopc · 本地运行');
    expect(html).toContain('本地优先 · 你的数据由你掌控');
    expect(html.toLowerCase()).not.toContain('gateway');
  });

  it('uses the canonical loop mark with a faster liquid animation', () => {
    const html = decodePage(getLoadingPageDataUrl('en'));

    expect(html).toContain('class="loop-logo"');
    expect(html).toContain('class="loop-ai"');
    expect(html).toContain('class="loop-human"');
    expect(html).toContain('class="loop-liquid-front"');
    expect(html).toContain('animation: loop-liquid-front 4.8s');
    expect(html).toContain('stroke-dasharray="1419.162121 654.289030"');
    expect(html).toContain('stroke-dasharray="354.790530 1718.660621"');
    expect(html).toContain('@media (prefers-color-scheme: dark)');
    expect(html).toContain('@media (prefers-reduced-motion: reduce)');
  });

  it('renders real startup phases and progressively explains a slow launch', () => {
    const html = decodePage(getLoadingPageDataUrl('en'));

    expect(html).toContain("typeof api.onProgress === 'function'");
    expect(html).toContain('Preparing your workspace…');
    expect(html).toContain('Starting local intelligence…');
    expect(html).toContain('Connecting your assistant…');
    expect(html).toContain("'opening-workspace': 100");
    expect(html).toContain("setProperty('--startup-progress'");
    expect(html).toContain('First launch or an update can take a little longer.');
    expect(html).toContain('Still working locally — xopc will keep trying.');
    expect(html).toContain("detail.phase === 'opening-workspace'");
    expect(html).toContain("classList.add('is-ready')");
    expect(html).not.toContain('startup.onFailed');
  });
});

describe('getStartupRecoveryPageDataUrl', () => {
  it('keeps technical gateway terminology out of visible recovery copy', () => {
    const failure = {
      kind: 'port_in_use' as const,
      message: 'The requested port is unavailable.',
      port: 18790,
      isPackaged: true,
    };
    const en = decodePage(getStartupRecoveryPageDataUrl('en', failure));
    const zh = decodePage(getStartupRecoveryPageDataUrl('zh-CN', failure));

    expect(en).toContain('The local service port is already in use');
    expect(en).toContain('Retry startup');
    expect(en).not.toContain('Retry gateway');
    expect(zh).toContain('本地服务端口已被占用');
    expect(zh).toContain('重新启动');
    expect(zh).not.toContain('网关端口');
    expect(zh).not.toContain('本地网关');
  });
});
