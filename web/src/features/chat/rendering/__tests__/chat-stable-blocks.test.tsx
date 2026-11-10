// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { expect, it, vi } from 'vitest';

const renders = vi.hoisted(() => new Map<string, number>());
vi.mock('streamdown', async importOriginal => {
  const original = await importOriginal<typeof import('streamdown')>();
  return { ...original, Block: (props: import('streamdown').BlockProps) => {
    renders.set(props.content, (renders.get(props.content) ?? 0) + 1);
    return createElement(original.Block, props);
  } };
});

import { ChatMarkdownRenderer } from '../markdown/chat-markdown-renderer';

it('does not rerender 100 completed blocks for each streaming tail delta', () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const root = createRoot(document.createElement('div'));
  const head = Array.from({ length: 100 }, (_, index) => `Completed paragraph ${index}.\n\n`).join('');
  const render = (tail: string) => act(() => root.render(
    <MemoryRouter><ChatMarkdownRenderer content={head + tail} streaming /></MemoryRouter>,
  ));
  try {
    render('Growing tail');
    const before = new Map(renders);
    expect(before.size).toBeGreaterThanOrEqual(100);
    for (let delta = 1; delta <= 10; delta++) render('Growing tail' + 'x'.repeat(delta));
    for (const [content, count] of before) {
      if (content.startsWith('Completed paragraph')) expect(renders.get(content), content).toBe(count);
    }
  } finally { act(() => root.unmount()); }
});
