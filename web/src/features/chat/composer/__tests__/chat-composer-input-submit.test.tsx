// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';

import { ChatComposerInput, type ComposerKbdContext } from '../chat-composer-input';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('composer keyboard submission', () => {
  it.each(['steer', 'composing', 'editing', 'idle', 'disabled'])('handles Alt+Enter in %s state', mode => {
    const container = document.createElement('div'); document.body.append(container);
    const root = createRoot(container);
    const editorRef = { current: null as HTMLDivElement | null };
    const state: ComposerKbdContext = { adapters: [], send: vi.fn(), runBusy: mode !== 'idle', pendingFollowUpsCount: 1,
      steerDraft: vi.fn(), interruptDraft: vi.fn(), editingFollowUpId: mode === 'editing' ? 'queued' : null,
      onCancelEditFollowUp: vi.fn(), attachmentsLen: 0, contextRefsLen: 0, isComposing: false,
      valueRef: { current: 'Change course' }, adjustHeight: vi.fn(), editorRef };
    act(() => root.render(<ChatComposerInput editorRef={editorRef} disabled={mode === 'disabled'} placeholder="Message"
      onWireInput={vi.fn()} adjustHeight={vi.fn()} processFiles={async () => {}} processPastedText={async () => {}}
      setIsComposing={vi.fn()} kbdRef={{ current: state }} chatMessages={{ clipboardFileTypeUnsupported: 'Unsupported' }} />));
    try {
      act(() => editorRef.current!.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'Enter', altKey: true, isComposing: mode === 'composing', bubbles: true,
      })));
      expect(state.steerDraft).toHaveBeenCalledTimes(mode === 'steer' ? 1 : 0);
      expect(state.send).not.toHaveBeenCalled();
      expect(state.interruptDraft).not.toHaveBeenCalled();
    } finally { act(() => root.unmount()); container.remove(); }
  });

  it.each([false, true])('uses the same primary action with runBusy=%s and queued follow-ups', runBusy => {
    const container = document.createElement('div'); document.body.append(container);
    const root = createRoot(container);
    const editorRef = { current: null as HTMLDivElement | null };
    const state: ComposerKbdContext = { adapters: [], send: vi.fn(), runBusy, pendingFollowUpsCount: 2,
      flushSteeringDraft: vi.fn(), interruptDraft: vi.fn(), editingFollowUpId: null, editingUserTurnId: 'original',
      onCancelEditFollowUp: vi.fn(), onCancelUserMessageEdit: vi.fn(), attachmentsLen: 0, contextRefsLen: 0,
      isComposing: false, valueRef: { current: 'edited original' }, adjustHeight: vi.fn(), editorRef };
    act(() => root.render(<ChatComposerInput editorRef={editorRef} disabled={false} placeholder="Message"
      onWireInput={vi.fn()} adjustHeight={vi.fn()} processFiles={async () => {}} processPastedText={async () => {}}
      setIsComposing={vi.fn()} kbdRef={{ current: state }} chatMessages={{ clipboardFileTypeUnsupported: 'Unsupported' }} />));
    try {
      act(() => editorRef.current!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
      expect(state.send).toHaveBeenCalledOnce();
      expect(state.flushSteeringDraft).not.toHaveBeenCalled();
      act(() => editorRef.current!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true })));
      expect(state.interruptDraft).not.toHaveBeenCalled();
      act(() => editorRef.current!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
      expect(state.onCancelUserMessageEdit).toHaveBeenCalledOnce();
      act(() => editorRef.current!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true })));
      expect(state.send).toHaveBeenCalledOnce();
    } finally { act(() => root.unmount()); container.remove(); }
  });
});
