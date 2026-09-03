// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  decorateAppLinks,
  openExternalHttpLink,
  resolveAppLink,
} from '../app-link';

afterEach(() => {
  Object.defineProperty(window, 'electronAPI', { configurable: true, value: undefined });
});

describe('app links', () => {
  it('resolves supported product, settings, and hash routes internally', () => {
    expect(resolveAppLink('xopc://open?kind=note&id=note%2Fone')).toEqual({
      kind: 'internal-route',
      route: '/notes/note%2Fone',
    });
    expect(resolveAppLink('xopc://settings/appearance?tab=theme')).toEqual({
      kind: 'internal-route',
      route: '/settings/appearance?tab=theme',
    });
    expect(resolveAppLink('#/chat/session-1')).toEqual({
      kind: 'internal-route',
      route: '/chat/session-1',
    });
  });

  it('resolves HTTP(S) links externally and blocks unsafe targets', () => {
    expect(resolveAppLink('https://example.com/docs')).toEqual({
      kind: 'external-http',
      url: 'https://example.com/docs',
    });
    expect(resolveAppLink('http://127.0.0.1:9999/site/demo')).toEqual({
      kind: 'external-http',
      url: 'http://127.0.0.1:9999/site/demo',
    });
    expect(resolveAppLink('javascript:alert(1)')).toEqual({ kind: 'blocked' });
    expect(resolveAppLink('file:///tmp/private')).toEqual({ kind: 'blocked' });
    expect(resolveAppLink('https://user:password@example.com')).toEqual({ kind: 'blocked' });
    expect(resolveAppLink('/api/config')).toEqual({ kind: 'blocked' });
  });

  it('decorates only external links with safe new-tab attributes', () => {
    const root = document.createElement('div');
    root.innerHTML = '<a href="https://example.com">external</a><a href="#/notes/note-1">internal</a>';

    decorateAppLinks(root);

    const [external, internal] = [...root.querySelectorAll<HTMLAnchorElement>('a')];
    expect(external?.target).toBe('_blank');
    expect(external?.rel).toContain('noopener');
    expect(external?.rel).toContain('noreferrer');
    expect(internal?.target).toBe('');
  });

  it('uses the Electron bridge when available', async () => {
    const openExternalUrl = vi.fn(async () => ({ ok: true as const }));
    Object.defineProperty(window, 'electronAPI', {
      configurable: true,
      value: { shell: { openExternalUrl } },
    });

    await expect(openExternalHttpLink('https://example.com/docs')).resolves.toEqual({ ok: true });

    expect(openExternalUrl).toHaveBeenCalledWith('https://example.com/docs');
  });
});
