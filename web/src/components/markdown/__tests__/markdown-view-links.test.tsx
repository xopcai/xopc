// @vitest-environment jsdom

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';

import { MarkdownView } from '@/components/markdown/markdown-view';

const mounted: Array<{ container: HTMLDivElement; unmount: () => void }> = [];

afterEach(() => {
  for (const entry of mounted.splice(0)) {
    act(entry.unmount);
    entry.container.remove();
  }
});

function renderMarkdown(openHttpLinksInNewTab: boolean): HTMLDivElement {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(
      <MemoryRouter>
        <MarkdownView
          content="[Example](https://example.com)"
          openHttpLinksInNewTab={openHttpLinksInNewTab}
        />
      </MemoryRouter>,
    );
  });
  mounted.push({ container, unmount: () => root.unmount() });
  return container;
}

describe('MarkdownView links', () => {
  it('keeps external links in the current window by default', () => {
    const anchor = renderMarkdown(false).querySelector('a');

    expect(anchor?.getAttribute('target')).toBeNull();
    expect(anchor?.getAttribute('rel')).toBeNull();
  });

  it('opens external links separately only when requested', () => {
    const anchor = renderMarkdown(true).querySelector('a');

    expect(anchor?.getAttribute('target')).toBe('_blank');
    expect(anchor?.getAttribute('rel')).toContain('noopener');
    expect(anchor?.getAttribute('rel')).toContain('noreferrer');
  });
});
