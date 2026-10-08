// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { TaskExpandableContent } from '../task-expandable-content';

vi.mock('@/components/markdown/markdown-view', () => ({ MarkdownView: ({ content }: { content: string }) => <article>{content}</article> }));

function Location() {
  return <output>{useLocation().search}</output>;
}

describe('task expandable content', () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;
  let height: number;
  let resize: () => void;
  const disconnect = vi.fn();

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    height = 300;
    vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockImplementation(() => height);
    vi.stubGlobal('ResizeObserver', class {
      constructor(callback: () => void) { resize = callback; }
      observe() {}
      disconnect = disconnect;
    });
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  const render = (content: string, search = '?returnTo=%2Ftasks', markdown = true) => act(() => {
    root.render(<MemoryRouter initialEntries={[`/tasks/one${search}`]}>
      <TaskExpandableContent content={content} contentKey="one:result" language="zh" markdown={markdown} />
      <Location />
    </MemoryRouter>);
  });

  it('expands the complete result and preserves other URL parameters when collapsing again', () => {
    const content = `# Beginning\n${'正文'.repeat(2000)}\nEnd of report`;
    render(content);
    const button = container.querySelector('button')!;
    const body = container.querySelector<HTMLElement>(`[id="${button.getAttribute('aria-controls')}"]`)!;
    expect(body.textContent).toBe(content);
    expect(body.style.maxHeight).toBe('240px');
    expect(body.querySelector('[inert]')).not.toBeNull();
    expect(button.textContent).toBe('查看更多');
    act(() => button.click());
    expect(body.style.maxHeight).toBe('');
    expect(body.querySelector('[inert]')).toBeNull();
    expect(button.getAttribute('aria-expanded')).toBe('true');
    expect(container.querySelector('output')!.textContent).toContain('returnTo=%2Ftasks');
    expect(container.querySelector('output')!.textContent).toContain('taskExpanded=one%3Aresult');
    act(() => button.click());
    expect(body.style.maxHeight).toBe('240px');
    expect(container.querySelector('output')!.textContent).toBe('?returnTo=%2Ftasks');
  });

  it('shows short content directly and detects overflow after the layout changes', () => {
    height = 40;
    render('Short text', undefined, false);
    expect(container.querySelector('button')).toBeNull();
    height = 400;
    act(() => resize());
    expect(container.querySelector('button')!.getAttribute('aria-expanded')).toBe('false');
    height = 40;
    act(() => resize());
    expect(container.querySelector('button')).toBeNull();
  });

  it('keeps custom content and its links usable after expansion', () => {
    act(() => root.render(<MemoryRouter>
      <TaskExpandableContent content="Long artifact name" contentKey="artifact" language="zh" previewHeight={60}>
        <a href="https://example.com/report">Long artifact name</a>
      </TaskExpandableContent>
    </MemoryRouter>));
    expect(container.querySelector('article')).toBeNull();
    expect(container.querySelector('[inert] a')).not.toBeNull();
    act(() => container.querySelector('button')!.click());
    expect(container.querySelector('[inert]')).toBeNull();
    expect(container.querySelector('a')!.getAttribute('href')).toBe('https://example.com/report');
  });

  it('restores expanded content from its URL', () => {
    render('Full report', '?taskExpanded=one%3Aresult');
    expect(container.querySelector('button')!.textContent).toBe('收起');
    expect(container.querySelector('[inert]')).toBeNull();
  });
});
