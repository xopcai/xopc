// @vitest-environment jsdom
import { act, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useComposerEditor } from '../use-composer-editor';

vi.mock('@/features/chat/palette/use-skill-label', () => {
  const label = (name: string) => name;
  return { useSkillLabel: () => label };
});

describe('composer height scheduling', () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;
  let editor: ReturnType<typeof useComposerEditor>;
  let frames: Map<number, FrameRequestCallback>;
  let resize: () => void;
  let reads: number;
  let height: number;
  let width: number;
  let rendering = false;
  function Harness({ seed, onReplace }: { seed?: { id: number; text: string }; onReplace?: () => void }) {
    rendering = true;
    const selection = useRef(false);
    editor = useComposerEditor({ disabled: false, shouldSyncSelectionRef: selection, welcomeDraftSeed: seed, onExternalTextReplace: onReplace });
    rendering = false;
    return <div ref={editor.editorRef} contentEditable suppressContentEditableWarning />;
  }
  const flush = () => act(() => {
    const callbacks = [...frames.values()];
    frames.clear();
    callbacks.forEach((callback) => callback(0));
  });
  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    frames = new Map();
    let id = 0;
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { frames.set(++id, callback); return id; });
    vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
    vi.stubGlobal('ResizeObserver', class {
      constructor(callback: () => void) { resize = callback; }
      observe() {}
      disconnect() {}
    });
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    act(() => root.render(<Harness />));
    height = 48;
    width = 300;
    reads = 0;
    Object.defineProperties(editor.editorRef.current!, {
      scrollHeight: { get: () => { reads++; return height; } },
      clientWidth: { get: () => width },
    });
    flush();
    reads = 0;
  });
  afterEach(() => {
    act(() => root.unmount());
    expect(frames.size).toBe(0);
    container.remove();
    vi.unstubAllGlobals();
  });
  it('measures a burst of draft changes once, grows to the cap, and shrinks after sending', () => {
    height = 300;
    for (let i = 0; i < 100; i++) editor.adjustHeight();
    expect(reads).toBe(0);
    flush();
    expect(reads).toBe(1);
    expect(editor.editorRef.current!.style.height).toBe('128px');
    height = 48;
    act(() => editor.resetEditor());
    flush();
    expect(editor.editorRef.current!.style.height).toBe('48px');
  });
  it('remeasures wrapped text after a width change and cancels pending work on unmount', () => {
    width = 200;
    height = 80;
    act(() => resize());
    flush();
    expect(editor.editorRef.current!.style.height).toBe('80px');
    reads = 0;
    act(() => resize());
    flush();
    expect(reads).toBe(0);
    editor.adjustHeight();
    act(() => root.unmount());
    expect(frames.size).toBe(0);
  });
  it('applies a discussion draft after render without notifying the parent during render', () => {
    const callbackPhases: boolean[] = [];
    const replace = () => callbackPhases.push(rendering);
    act(() => root.render(<Harness seed={{ id: 1, text: 'Discuss the report evidence' }} onReplace={replace} />));
    expect(editor.value).toBe('Discuss the report evidence');
    expect(callbackPhases).toEqual([false]);
    act(() => root.render(<Harness seed={{ id: 1, text: 'Discuss the report evidence' }} onReplace={replace} />));
    expect(callbackPhases).toEqual([false]);
  });

});
