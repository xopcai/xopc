// @vitest-environment jsdom
import { act, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { __resetComposerInputHistoryForTests } from '../composer-input-history';
import { useComposerInputHistoryWalk } from '../use-composer-input-history-walk';
import type { ResetEditorOptions } from '../composer.types';

vi.mock('@/lib/fetch', () => ({ fetchJson: vi.fn().mockResolvedValue({ items: [] }) }));

describe('session input history arrow navigation', () => {
  let root: ReturnType<typeof createRoot>;
  let container: HTMLDivElement;
  let walk: ReturnType<typeof useComposerInputHistoryWalk>;
  let value: { current: string };
  const reset = vi.fn<(opts?: ResetEditorOptions) => void>();
  function Harness({ id }: { id: string | null }) {
    const editorRef = useRef<HTMLDivElement | null>(null);
    const valueRef = useRef('draft');
    value = valueRef;
    walk = useComposerInputHistoryWalk({ conversationId: id, editorRef, valueRef, resetEditor: reset, onWireInput: vi.fn() });
    return null;
  }
  const render = async (id: string | null) => act(async () => root.render(<Harness id={id} />));
  const append = (conversationId: string, id: number, text: string) => {
    window.dispatchEvent(new CustomEvent('composer-history-appended', { detail: { conversationId, id, text, createdAt: id } }));
  };
  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    __resetComposerInputHistoryForTests();
    reset.mockReset().mockImplementation(opts => { value.current = opts?.nextText ?? ''; });
    container = document.createElement('div');
    root = createRoot(container);
  });
  afterEach(async () => { await act(async () => root.unmount()); });

  it('resets the walk on switching, recalls only the active session, and restores its draft', async () => {
    await render('a');
    append('a', 1, 'a old');
    append('a', 2, 'a new');
    expect(walk.tryInputHistoryArrow('up')).toBe(true);
    expect(value.current).toBe('a new');
    walk.tryInputHistoryArrow('up');
    expect(value.current).toBe('a old');
    const delayedCommitA = walk.onUserTextCommitted;
    await render('b');
    value.current = 'b draft';
    expect(walk.tryInputHistoryArrow('up')).toBe(false);
    append('b', 3, 'b only');
    walk.tryInputHistoryArrow('up');
    expect(value.current).toBe('b only');
    append('a', 4, 'another a');
    delayedCommitA('submitted a');
    walk.tryInputHistoryArrow('down');
    expect(value.current).toBe('b draft');
    await render('a');
    // The refreshed server list is empty; unscoped or other-session entries cannot leak in.
    expect(walk.tryInputHistoryArrow('up')).toBe(false);
  });

  it('does not recall another session or legacy events in an unbound new composer', async () => {
    await render(null);
    append('a', 1, 'old session');
    window.dispatchEvent(new CustomEvent('composer-history-appended', { detail: { id: 2, text: 'legacy', createdAt: 2 } }));
    expect(walk.tryInputHistoryArrow('up')).toBe(false);
    walk.onUserTextCommitted('unbound');
    expect(walk.tryInputHistoryArrow('up')).toBe(false);
  });
});
