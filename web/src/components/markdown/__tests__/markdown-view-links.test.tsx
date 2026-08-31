// @vitest-environment jsdom

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { MarkdownView } from '@/components/markdown/markdown-view';

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

function renderMarkdown(content = '[Example](https://example.com)'): HTMLDivElement {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(
      <MemoryRouter>
        <MarkdownView content={content} />
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
});
