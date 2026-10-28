// @vitest-environment jsdom
import { act, StrictMode, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useComposerEditor } from '../use-composer-editor';

vi.mock('@/features/chat/palette/use-skill-label', () => {
  const label = (name: string) => name;
  return { useSkillLabel: () => label };
});

describe('composer autofocus', () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;
  let frames: Map<number, FrameRequestCallback>;

  function Harness({ id, disabled = false }: { id: string | null; disabled?: boolean }) {
    const selection = useRef(false);
    const editor = useComposerEditor({ disabled, autoFocusKey: id, shouldSyncSelectionRef: selection });
    return <div ref={editor.editorRef} contentEditable={!disabled} suppressContentEditableWarning />;
  }

  const render = (id: string | null, disabled = false) => act(() => {
    root.render(<StrictMode><Harness id={id} disabled={disabled} /></StrictMode>);
  });
  const flush = () => act(() => {
    const callbacks = [...frames.values()];
    frames.clear();
    callbacks.forEach(callback => callback(0));
  });
  const expectFocused = () => expect(document.activeElement).toBe(container.firstElementChild);

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    frames = new Map();
    let id = 0;
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { frames.set(++id, callback); return id; });
    vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: true })));
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    expect(frames.size).toBe(0);
    container.remove();
    vi.unstubAllGlobals();
  });

  it('focuses after StrictMode cancels and replays the initial effect', () => {
    render(null);
    flush();
    expectFocused();
  });

  it('focuses the new-chat shell before a conversation id is available', () => {
    render('existing');
    flush();
    (container.firstElementChild as HTMLElement).blur();
    render(null);
    flush();
    expectFocused();
  });

  it('preserves a pending focus when the route changes before the frame runs', () => {
    render('existing');
    flush();
    (container.firstElementChild as HTMLElement).blur();
    render(null);
    render('existing');
    flush();
    expectFocused();
  });

  it('waits until enabled and does not refocus on an unrelated render', () => {
    render('new', true);
    flush();
    expect(document.activeElement).not.toBe(container.firstElementChild);
    render('new');
    flush();
    expectFocused();
    (container.firstElementChild as HTMLElement).blur();
    render('new');
    flush();
    expect(document.activeElement).not.toBe(container.firstElementChild);
  });

  it('does not open the software keyboard on touch devices', () => {
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false })));
    render('new');
    flush();
    expect(document.activeElement).not.toBe(container.firstElementChild);
  });
});
