// @vitest-environment jsdom
import { act, StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ChatMarkdownRenderer } from '../markdown/chat-markdown-renderer';
import { graphemeCommitBoundary, splitRevealText } from '../markdown/text-segments';

describe('React chat Markdown', () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;
  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    container = document.createElement('div'); document.body.append(container);
    root = createRoot(container);
  });
  afterEach(() => {
    act(() => root.unmount()); container.remove(); vi.restoreAllMocks(); vi.useRealTimers();
    Object.defineProperty(window, 'electronAPI', { configurable: true, value: undefined });
    delete (HTMLElement.prototype as Partial<HTMLElement>).animate;
  });
  const render = (content: string, streaming = false) => act(() => root.render(
    <StrictMode><MemoryRouter><ChatMarkdownRenderer content={content} streaming={streaming} /></MemoryRouter></StrictMode>,
  ));

  it('keeps complete paragraphs and the renderer mounted through tail growth and completion', () => {
    render('Stable.\n\nGrowing', true);
    const renderer = container.querySelector('.xopc-chat-markdown');
    const paragraph = container.querySelector('p');
    render('Stable.\n\nGrowing tail', true);
    expect(container.querySelector('p')).toBe(paragraph);
    render('Stable.\n\nGrowing tail', false);
    expect(container.querySelector('.xopc-chat-markdown')).toBe(renderer);
    expect(container.querySelector('p')).toBe(paragraph);
  });

  it('resolves cross-block reference definitions without losing earlier text', () => {
    render('Read [docs][ref].\n\nAnother paragraph.\n\n[ref]: https://example.com', true);
    expect(container.querySelector('a')?.getAttribute('href')).toBe('https://example.com');
    expect(container.textContent).toContain('Another paragraph.');
  });

  it('keeps raw HTML literal and blocks executable URLs', () => {
    render('<img src=x onerror=alert(1)>\n\n[bad](javascript:alert(1))');
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('script')).toBeNull();
    expect(container.querySelector('a')).toBeNull();
    expect(container.textContent).toContain('<img src=x onerror=alert(1)>');
  });

  it('renders Chinese punctuation-bound emphasis and escaped internal links', () => {
    render('而是**"你现在的孤独感，有没有别的地方可以安放？"**\n\n[打开]\\(xopc://open?kind=session&key=test\\)');
    expect(container.querySelector('strong')?.textContent).toBe('"你现在的孤独感，有没有别的地方可以安放？"');
    expect(container.querySelector('a')?.getAttribute('href')).toContain('#/chat/');
  });

  it('does not replay existing text when a Markdown ancestor changes', () => {
    const animate = vi.fn(() => ({ currentTime: 0, cancel: vi.fn(), onfinish: null }));
    Object.defineProperty(HTMLElement.prototype, 'animate', { configurable: true, value: animate });
    render('**你好', true);
    animate.mockClear();
    render('**你好**', true);
    expect(animate).not.toHaveBeenCalled();
    delete (HTMLElement.prototype as Partial<HTMLElement>).animate;
  });

  it('starts fades for newly appended Chinese text, and cancels them on unmount', () => {
    const cancel = vi.fn();
    const animate = vi.fn(() => ({ currentTime: 0, cancel, onfinish: null }));
    Object.defineProperty(HTMLElement.prototype, 'animate', { configurable: true, value: animate });
    render('已有文字。', true);
    expect(animate).not.toHaveBeenCalled();
    render('已有文字。新增内容。', true);
    expect(animate, container.innerHTML).toHaveBeenCalled();
    act(() => root.render(null));
    expect(cancel).toHaveBeenCalled();
    delete (HTMLElement.prototype as Partial<HTMLElement>).animate;
  });

  it('segments continuous Chinese and never cuts a family emoji or combining grapheme', () => {
    expect(splitRevealText('我们一起分析').length).toBeGreaterThan(1);
    const text = 'a👨‍👩‍👧‍👦e\u0301';
    expect(graphemeCommitBoundary(text, 2)).toBe(12);
    expect(graphemeCommitBoundary(text, 13)).toBe(text.length);
    expect(graphemeCommitBoundary(text, 1)).toBe(1);
  });

  it('fades added text inside a still-open strong span instead of treating synthetic closers as edits', () => {
    const animate = vi.fn(() => ({ currentTime: 0, cancel: vi.fn(), onfinish: null }));
    Object.defineProperty(HTMLElement.prototype, 'animate', { configurable: true, value: animate });
    render('**已有', true);
    expect(animate).not.toHaveBeenCalled();
    render('**已有新增', true);
    expect(animate).toHaveBeenCalled();
    expect(container.querySelector('strong')?.textContent).toBe('已有新增');
  });
  it('updates workspace link callbacks without remounting the document', () => {
    const first = vi.fn(); const next = vi.fn();
    const content = '[file](file:///workspace/example.ts)';
    const show = (callback: typeof first) => act(() => root.render(
      <MemoryRouter><ChatMarkdownRenderer content={content} onWorkspaceFileOpen={callback} /></MemoryRouter>,
    ));
    show(first);
    const link = container.querySelector('a');
    show(next);
    expect(container.querySelector('a')).toBe(link);
    act(() => link?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })));
    expect(first).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ path: '/workspace/example.ts' }));
  });

  it('keeps large and unfinished code complete instead of truncating it', () => {
    const code = 'const ready = true;\n'.repeat(6000);
    render('```typescript\n' + code, true);
    expect(container.querySelector('pre code')?.textContent).toBe(code.trimEnd());
    render('```typescript\n' + code + '```', false);
    expect(container.querySelector('pre code')?.textContent).toBe(code.trimEnd());
  });

  it('bounds active reveal work even for a large burst of Chinese text', () => {
    const active = new Set<object>();
    let peak = 0;
    const animate = vi.fn(() => {
      const animation = { currentTime: 0, cancel: () => { active.delete(animation); }, onfinish: null };
      active.add(animation); peak = Math.max(peak, active.size);
      return animation;
    });
    Object.defineProperty(HTMLElement.prototype, 'animate', { configurable: true, value: animate });
    render('开始。', true);
    render('开始。' + '我们一起分析这个问题。'.repeat(500), true);
    expect(animate.mock.calls.length).toBeGreaterThan(0);
    expect(peak).toBeLessThanOrEqual(256);
    expect(container.textContent).toContain('我们一起分析这个问题。'.repeat(500));
  });

  it('discards a link failure when its source document has been replaced', async () => {
    let complete: ((result: {ok: false; error: string}) => void) | undefined;
    Object.defineProperty(window, 'electronAPI', {configurable: true, value: {shell: {
      openExternalUrl: () => new Promise(resolve => {complete = resolve;}),
    }}});
    render('[Old link](https://example.com/old)');
    act(() => container.querySelector('a')?.dispatchEvent(new MouseEvent('click', {bubbles: true, cancelable: true})));
    render('New document.');
    await act(async () => complete?.({ok: false, error: 'Outdated error'}));
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });

  it('keeps tables semantic inside a separate keyboard-scrollable viewport', () => {
    render('| Name | Amount |\n| --- | ---: |\n| Item | 300 |');
    expect(container.querySelector('.markdown-table-scroll')?.getAttribute('tabindex')).toBe('0');
    expect(container.querySelector<HTMLTableElement>('.markdown-table-scroll > table')?.style.minWidth).toBe('12rem');
    expect(container.querySelector('td[data-markdown-align="right"]')?.textContent).toBe('300');
  });

  it('keeps a referenced workspace image distinct from a same-shaped app route', async () => {
    const load = vi.fn(async () => new Blob(['image']));
    await act(async () => root.render(<MemoryRouter><ChatMarkdownRenderer
      content={'![Chart][asset]\n\n[asset]: /projects/report.png'} onWorkspaceImageLoad={load}
    /></MemoryRouter>));
    expect(load).toHaveBeenCalledWith({path: '/projects/report.png', kind: 'absolute', line: undefined});
  });

});
