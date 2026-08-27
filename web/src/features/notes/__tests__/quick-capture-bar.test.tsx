// @vitest-environment jsdom

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { QuickCaptureBar } from '../quick-capture-bar';

describe('QuickCaptureBar', () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it('submits with Enter and leaves Shift+Enter available for a newline', async () => {
    const onCapture = vi.fn(async () => {});
    act(() => {
      root.render(
        <QuickCaptureBar
          placeholder="Write a note"
          submitLabel="Save and open"
          actionsLabel="Add content"
          imageLabel="Add image"
          voiceLabel="Record voice note"
          stopRecordingLabel="Stop recording"
          recordingLabel="Recording · {{seconds}}s"
          discussionCaptureLabel="Record discussion"
          onCapture={onCapture}
          onImagePick={() => {}}
          onVoiceCapture={async () => {}}
          onDiscussionCapture={() => {}}
        />,
      );
    });

    const visibleButtons = [...container.querySelectorAll('button')];
    expect(visibleButtons).toHaveLength(2);
    expect(visibleButtons[0].getAttribute('aria-label')).toBe('Add content');

    const input = container.querySelector('textarea');
    expect(input).not.toBeNull();

    act(() => {
      const setTextareaValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
      setTextareaValue?.call(input, 'First thought');
      input!.dispatchEvent(new Event('input', { bubbles: true }));
    });

    const newline = new KeyboardEvent('keydown', {
      key: 'Enter',
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    });
    act(() => input!.dispatchEvent(newline));
    expect(newline.defaultPrevented).toBe(false);
    expect(onCapture).not.toHaveBeenCalled();

    const submit = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
    await act(async () => input!.dispatchEvent(submit));
    expect(submit.defaultPrevented).toBe(true);
    expect(onCapture).toHaveBeenCalledWith('First thought');
  });
});
