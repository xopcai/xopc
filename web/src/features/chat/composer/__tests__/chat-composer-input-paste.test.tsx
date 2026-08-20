// @vitest-environment jsdom

import { act, type MutableRefObject } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  ChatComposerInput,
  type ComposerKbdContext,
} from '@/features/chat/composer/chat-composer-input';
import type { PastedTextAttachment } from '@/features/chat/composer/pasted-text';

type ProcessPastedText = (paste: PastedTextAttachment) => Promise<void>;

describe('ChatComposerInput paste handling', () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;
  let editorRef: MutableRefObject<HTMLDivElement | null>;

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
      .IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    editorRef = { current: null };
    Object.defineProperty(document, 'execCommand', {
      configurable: true,
      value: vi.fn(),
    });
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  function renderInput(processPastedText: ProcessPastedText) {
    const valueRef = { current: '' };
    const kbdRef = {
      current: {
        adapters: [],
        send: vi.fn(),
        runBusy: false,
        pendingFollowUpsCount: 0,
        editingFollowUpId: null,
        onCancelEditFollowUp: vi.fn(),
        attachmentsLen: 0,
        isComposing: false,
        valueRef,
        adjustHeight: vi.fn(),
        editorRef,
      },
    } as MutableRefObject<ComposerKbdContext>;

    act(() => {
      root.render(
        <ChatComposerInput
          editorRef={editorRef}
          disabled={false}
          placeholder="Message"
          onWireInput={() => {}}
          adjustHeight={() => {}}
          processFiles={async () => {}}
          processPastedText={processPastedText}
          setIsComposing={() => {}}
          kbdRef={kbdRef}
          chatMessages={{ clipboardFileTypeUnsupported: 'Unsupported' }}
        />,
      );
    });
  }

  async function paste(text: string) {
    const event = new Event('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'clipboardData', {
      value: {
        files: { length: 0, item: () => null },
        items: [],
        getData: (type: string) => (type === 'text/plain' ? text : ''),
      },
    });
    await act(async () => {
      editorRef.current?.dispatchEvent(event);
    });
    return event;
  }

  it('turns a large DOM paste into a text attachment without inserting it into the editor', async () => {
    const processPastedText = vi.fn<ProcessPastedText>(async () => {});
    renderInput(processPastedText);
    const html = `<body>${'<div class="flex">content</div>'.repeat(300)}</body>`;

    const event = await paste(html);

    expect(event.defaultPrevented).toBe(true);
    expect(processPastedText).toHaveBeenCalledWith(
      expect.objectContaining({ text: html, name: 'pasted-text.html', mimeType: 'text/html' }),
    );
    expect(document.execCommand).not.toHaveBeenCalled();
    expect(editorRef.current?.textContent).toBe('');
  });

  it('inserts a short plain-text paste normally', async () => {
    const processPastedText = vi.fn<ProcessPastedText>(async () => {});
    renderInput(processPastedText);

    await paste('hello');

    expect(processPastedText).not.toHaveBeenCalled();
    expect(document.execCommand).toHaveBeenCalledWith('insertText', false, 'hello');
  });
});
