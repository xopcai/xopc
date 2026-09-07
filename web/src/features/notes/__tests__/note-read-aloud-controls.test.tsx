// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useReadAloudStore, type ReadAloudInput } from '@/features/voice/read-aloud-store';
import { NoteReadAloudControls } from '../note-read-aloud-controls';

vi.mock('@/features/voice/read-aloud-store', async () => {
  const { create } = await import('zustand');
  return { useReadAloudStore: create(() => ({ source: null, status: 'idle', requestStart: vi.fn(), stop: vi.fn() })) };
});

const labels = { read: 'Read full note', preparing: 'Preparing', pause: 'Pause', resume: 'Resume', retry: 'Retry', stop: 'Stop' };
const source = { type: 'note' as const, id: 'n1', title: 'Title' };
let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  useReadAloudStore.setState({ source: null, status: 'idle' });
  vi.clearAllMocks();
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); });

function render(input: () => ReadAloudInput) {
  act(() => root.render(<NoteReadAloudControls input={input} labels={labels} />));
}

describe('note read aloud controls', () => {
  it('reads the latest full preview at click time', () => {
    let text = 'First draft';
    render(() => ({ source, text, language: 'en-US' }));
    text = 'Updated title and complete note body';
    act(() => container.querySelector('button')!.click());
    expect(useReadAloudStore.getState().requestStart).toHaveBeenCalledWith({ source, text, language: 'en-US' });
  });

  it('prevents duplicate generation and allows cancellation while preparing', () => {
    useReadAloudStore.setState({ source, status: 'preparing' });
    render(() => ({ source, text: 'Body', language: 'en-US' }));
    const read = container.querySelector<HTMLButtonElement>('[aria-label="Preparing"]')!;
    expect(read.disabled).toBe(true);
    act(() => { read.click(); container.querySelector<HTMLButtonElement>('[aria-label="Stop"]')!.click(); });
    expect(useReadAloudStore.getState().requestStart).not.toHaveBeenCalled();
    expect(useReadAloudStore.getState().stop).toHaveBeenCalledTimes(1);
  });

  it('reflects pause and resume without exposing stop for another note', () => {
    useReadAloudStore.setState({ source, status: 'playing' });
    render(() => ({ source, text: 'Body', language: 'en-US' }));
    expect(container.querySelector('[aria-label="Pause"]')).not.toBeNull();
    act(() => useReadAloudStore.setState({ status: 'paused' }));
    expect(container.querySelector('[aria-label="Resume"]')).not.toBeNull();
    act(() => useReadAloudStore.setState({ source: { ...source, id: 'other' } }));
    expect(container.querySelector('[aria-label="Stop"]')).toBeNull();
  });
});
