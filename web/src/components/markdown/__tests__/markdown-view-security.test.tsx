// @vitest-environment jsdom

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { MarkdownView, type MarkdownViewProps } from '@/components/markdown/markdown-view';

const mounted: Array<{ container: HTMLDivElement; unmount: () => void }> = [];

afterEach(() => {
  for (const entry of mounted.splice(0)) {
    act(entry.unmount);
    entry.container.remove();
  }
  vi.restoreAllMocks();
});

function renderMarkdown(content: string, props: Omit<MarkdownViewProps, 'content'> = {}): HTMLDivElement {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(
      <MemoryRouter>
        <MarkdownView content={content} {...props} />
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

    await vi.waitFor(() => {
      expect(container.querySelector('svg')).not.toBeNull();
    });
    const shell = container.querySelector<HTMLElement>('.markdown-mermaid-shell');
    expect(shell?.hasAttribute('data-mermaid-diagram')).toBe(true);
    expect(container.innerHTML).not.toContain('@import');
    expect(container.innerHTML).not.toContain('fonts.googleapis.com');
    expect(container.querySelector('svg script,svg foreignObject,svg [href]')).toBeNull();
  });

  it('renders the reported flowchart syntax as a diagram', async () => {
    const container = renderMarkdown([
      '```mermaid',
      'flowchart TD',
      '    OAuth["Google OAuth callback"] --> Multi["upsert connector_account_bindings"]',
      '    OAuth --> Legacy{"legacy binding 是否存在？"}',
      '',
      '    Legacy -->|"不存在"| Insert["插入，成为 legacy primary"]',
      '    Legacy -->|"已指向当前 connection"| Update["保持原有 reauthorization 行为"]',
      '    Legacy -->|"已指向其他 connection"| Keep["不覆盖，保留原 primary"]',
      '```',
    ].join('\n'));

    await vi.waitFor(() => {
      expect(container.querySelector('[data-mermaid-diagram] svg')).not.toBeNull();
    });
    expect(container.querySelector('pre code.language-mermaid')).toBeNull();
  });

  it('shows an explicit error instead of raw source when Mermaid parsing fails', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const container = renderMarkdown('```mermaid\nnot a diagram\n```');

    expect(container.querySelector('[data-mermaid-error] [role="alert"]')?.textContent)
      .toBe('Diagram render failed');
    expect(container.querySelector('pre code.language-mermaid')).toBeNull();
  });

  it('mounts opt-in Mermaid actions and opens the enlarged preview', async () => {
    const container = renderMarkdown('```mermaid\ngraph LR\nA --> B\n```', {
      mermaidActions: true,
    });

    await vi.waitFor(() => {
      expect(container.querySelector('[data-mermaid-action="preview"]')).not.toBeNull();
    });
    const svg = container.querySelector<SVGSVGElement>('[data-mermaid-diagram] svg');
    expect(svg).not.toBeNull();
    act(() => svg?.dispatchEvent(new MouseEvent('click', { bubbles: true })));

    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    expect(document.body.textContent).toContain('Mermaid diagram preview');
  });
});
