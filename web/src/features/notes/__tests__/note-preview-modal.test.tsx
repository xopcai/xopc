// @vitest-environment jsdom

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { SWRConfig } from 'swr';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { NotePreviewModal } from '../note-preview-modal';
import { getNote, type Note } from '../notes-api';

vi.mock('../notes-api', () => ({ getNote: vi.fn() }));
vi.mock('../note-markdown-view', () => ({ NoteMarkdownView: ({ content }: { content: string }) => <article>{content}</article> }));

let root: ReturnType<typeof createRoot>;
let container: HTMLDivElement;
afterEach(() => { act(() => root.unmount()); container.remove(); vi.clearAllMocks(); });

async function render() {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  const onClose = vi.fn();
  await act(async () => root.render(
    <SWRConfig value={{ provider: () => new Map(), shouldRetryOnError: false }}>
      <MemoryRouter><NotePreviewModal noteId="n1" backgroundPath="/chat/c1?view=full" onClose={onClose} /></MemoryRouter>
    </SWRConfig>,
  ));
  return onClose;
}

describe('NotePreviewModal', () => {
  it('previews content, links to the full page, and closes without editing controls', async () => {
    vi.mocked(getNote).mockResolvedValue({ id: 'n1', title: 'Plan', markdown: 'Preview body' } as Note);
    const onClose = await render();
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain('Plan');
    expect(document.querySelector('article')?.textContent).toBe('Preview body');
    expect(document.querySelector('a')?.getAttribute('href')).toBe('/notes/n1?returnTo=%2Fchat%2Fc1%3Fview%3Dfull');
    expect(document.querySelector('textarea, [contenteditable="true"]')).toBeNull();
    act(() => document.querySelector<HTMLButtonElement>('[aria-label="Close note preview"], [aria-label="关闭笔记预览"]')?.click());
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('shows a skeleton while loading', async () => {
    vi.mocked(getNote).mockReturnValue(new Promise(() => {}));
    await render();
    expect(document.querySelector('[aria-busy="true"] [role="status"]')).not.toBeNull();
    expect(document.querySelector('article')).toBeNull();
  });

  it('handles deleted notes', async () => {
    vi.mocked(getNote).mockResolvedValue(null);
    await render();
    expect(document.querySelector('[role="dialog"]')?.textContent).toMatch(/unavailable|不存在/);
  });

  it('surfaces load errors', async () => {
    vi.mocked(getNote).mockRejectedValue(new Error('offline'));
    await render();
    expect(document.querySelector('[role="alert"]')).not.toBeNull();
  });
});
