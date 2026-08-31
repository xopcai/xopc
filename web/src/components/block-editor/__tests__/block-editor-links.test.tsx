// @vitest-environment jsdom

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { BlockEditor } from '../block-editor';

vi.mock('../link-bubble-menu', () => ({ LinkBubbleMenu: () => null }));

const mounted: Array<{ container: HTMLDivElement; unmount: () => void }> = [];

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
Object.defineProperty(document, 'elementFromPoint', {
  configurable: true,
  value: () => document.body,
});

afterEach(() => {
  for (const entry of mounted.splice(0)) {
    act(entry.unmount);
    entry.container.remove();
  }
});

function renderEditor(content: string): HTMLDivElement {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(
      <MemoryRouter>
        <BlockEditor initialContent={content} onChange={vi.fn()} />
      </MemoryRouter>,
    );
  });
  mounted.push({ container, unmount: () => root.unmount() });
  return container;
}

describe('BlockEditor links', () => {
  it('preserves external and supported internal link targets', async () => {
    const container = renderEditor(
      '[External](https://example.com/docs) [Note](xopc://open?kind=note&id=note-1)',
    );

    await vi.waitFor(() => expect(container.querySelectorAll('.ProseMirror a')).toHaveLength(2));
    const links = [...container.querySelectorAll<HTMLAnchorElement>('.ProseMirror a')];
    expect(links.map((link) => link.getAttribute('href'))).toEqual([
      'https://example.com/docs',
      'xopc://open?kind=note&id=note-1',
    ]);
  });
});
