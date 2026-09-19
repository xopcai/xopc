// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ChatComposerInput, type ComposerKbdContext } from '../chat-composer-input';
import { applyWireToEditor, getWireCaretOffset, serializeEditorToWire } from '../composer-editor-wire';

describe('composer delete events', () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;
  let editor: HTMLDivElement;
  const onWireInput = vi.fn();
  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    onWireInput.mockClear();
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    const editorRef = { current: null as HTMLDivElement | null };
    const kbdRef = { current: {
      adapters: [], send: vi.fn(), runBusy: false, pendingFollowUpsCount: 0,
      editingFollowUpId: null, onCancelEditFollowUp: vi.fn(), attachmentsLen: 0,
      isComposing: false, valueRef: { current: '/skill:summarize ' }, adjustHeight: vi.fn(), editorRef,
    } satisfies ComposerKbdContext };
    act(() => root.render(<ChatComposerInput editorRef={editorRef} disabled={false} placeholder="Message"
      onWireInput={onWireInput} adjustHeight={() => {}} processFiles={async () => {}}
      processPastedText={async () => {}} setIsComposing={() => {}} kbdRef={kbdRef}
      chatMessages={{ clipboardFileTypeUnsupported: 'Unsupported' }} />));
    editor = editorRef.current!;
    applyWireToEditor(editor, '/skill:summarize ', 17);
    getWireCaretOffset(editor);
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it.each(['keyboard', 'soft-keyboard'])('deletes once through %s and synchronizes draft state', (source) => {
    const event = source === 'keyboard'
      ? new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true, cancelable: true })
      : new InputEvent('beforeinput', { inputType: 'deleteContentBackward', bubbles: true, cancelable: true });
    act(() => editor.dispatchEvent(event));
    expect(event.defaultPrevented).toBe(true);
    expect(serializeEditorToWire(editor)).toBe('');
    expect(onWireInput).toHaveBeenCalledTimes(1);
    expect(onWireInput).toHaveBeenCalledWith('', 0);
  });

  it('leaves composition deletion to the IME', () => {
    act(() => editor.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true })));
    for (const event of [
      new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true, cancelable: true, isComposing: true }),
      new InputEvent('beforeinput', { inputType: 'deleteContentBackward', bubbles: true, cancelable: true, isComposing: true }),
    ]) {
      act(() => editor.dispatchEvent(event));
      expect(event.defaultPrevented).toBe(false);
    }
    expect(serializeEditorToWire(editor)).toBe('/skill:summarize ');
    expect(onWireInput).not.toHaveBeenCalled();
  });
});
