// @vitest-environment jsdom

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { MarkdownView } from '@/components/markdown/markdown-view';

const mounted: Array<{ container: HTMLDivElement; unmount: () => void }> = [];

afterEach(() => {
  for (const entry of mounted.splice(0)) {
    act(entry.unmount);
    entry.container.remove();
  }
});

function renderMarkdown(content: string): HTMLDivElement {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(
      <MemoryRouter>
        <MarkdownView content={content} />
      </MemoryRouter>,
    );
  });
  mounted.push({ container, unmount: () => root.unmount() });
  return container;
}

describe('MarkdownView security boundary', () => {
  it('does not create DOM from layout injection markup', () => {
    const container = renderMarkdown(
      '<body><div id="root" class="fixed inset-0" style="position:fixed;width:100vw">content</div></body>',
    );

    expect(container.querySelector('#root')).toBeNull();
    expect(container.querySelector('[style]')).toBeNull();
    expect(container.textContent).toContain('<body>');
    expect(container.textContent).toContain('class="fixed inset-0"');
  });

  it('does not create script, event, form, frame, or SVG nodes from raw HTML', () => {
    const container = renderMarkdown(
      '<script>alert(1)</script><img src=x onerror="alert(1)"><form action="https://evil.invalid"><button>go</button></form><iframe srcdoc="x"></iframe><svg onload="alert(1)"></svg>',
    );

    expect(container.querySelector('script,img,form,button,iframe,svg')).toBeNull();
    expect(container.textContent).toContain('<script>');
    expect(container.textContent).toContain('<iframe');
  });

  it('keeps ordinary Markdown rendering intact', () => {
    const container = renderMarkdown('**safe** and `code`');

    expect(container.querySelector('strong')?.textContent).toBe('safe');
    expect(container.querySelector('code')?.textContent).toBe('code');
  });

  it('sanitizes generated Mermaid SVG before mounting it', async () => {
    const container = renderMarkdown('```mermaid\ngraph TD\nA --> B\n```');

    await vi.waitFor(() => expect(container.querySelector('svg')).not.toBeNull());
    expect(container.innerHTML).not.toContain('@import');
    expect(container.innerHTML).not.toContain('fonts.googleapis.com');
    expect(container.querySelector('svg script,svg foreignObject,svg [href]')).toBeNull();
  });
});
