// @vitest-environment jsdom

import { act, type MutableRefObject } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  ChatComposerInput,
  type ComposerKbdContext,
} from '@/features/chat/composer/chat-composer-input';

describe('ChatComposerInput contextual suggestion', () => {
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

  it('accepts the suggestion with Tab only while the editor is empty', () => {
    const acceptEmptySuggestion = vi.fn(() => true);
    const valueRef = { current: '' };
    const editorRef = { current: null } as MutableRefObject<HTMLDivElement | null>;
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
        acceptEmptySuggestion,
      },
    } as MutableRefObject<ComposerKbdContext>;

    act(() => {
      root.render(
        <ChatComposerInput
          editorRef={editorRef}
          disabled={false}
          placeholder="理解当前目录 · 按 Tab 填入建议"
          ariaLabel="输入消息"
          onWireInput={() => {}}
          adjustHeight={() => {}}
          processFiles={async () => {}}
          processPastedText={async () => {}}
          setIsComposing={() => {}}
          kbdRef={kbdRef}
          chatMessages={{ clipboardFileTypeUnsupported: '不支持的文件类型' }}
        />,
      );
    });

    const editor = container.querySelector('[role="textbox"]');
    const firstTab = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
    act(() => editor?.dispatchEvent(firstTab));
    expect(firstTab.defaultPrevented).toBe(true);
    expect(acceptEmptySuggestion).toHaveBeenCalledTimes(1);
    expect(editor?.getAttribute('aria-label')).toBe('输入消息');

    valueRef.current = '已经输入内容';
    const secondTab = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
    act(() => editor?.dispatchEvent(secondTab));
    expect(secondTab.defaultPrevented).toBe(false);
    expect(acceptEmptySuggestion).toHaveBeenCalledTimes(1);
  });

  it('keeps the editor DOM mounted while voice status temporarily hides it', () => {
    const editorRef = { current: null } as MutableRefObject<HTMLDivElement | null>;
    const valueRef = { current: 'draft text' };
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
    const render = (hidden: boolean) => (
      <ChatComposerInput
        editorRef={editorRef}
        disabled={false}
        hidden={hidden}
        placeholder="Message"
        onWireInput={() => {}}
        adjustHeight={() => {}}
        processFiles={async () => {}}
        processPastedText={async () => {}}
        setIsComposing={() => {}}
        kbdRef={kbdRef}
        chatMessages={{ clipboardFileTypeUnsupported: 'Unsupported' }}
      />
    );

    act(() => root.render(render(false)));
    const editor = editorRef.current;
    if (editor) editor.textContent = 'draft text';

    act(() => root.render(render(true)));
    expect(editorRef.current).toBe(editor);
    expect(editorRef.current?.hidden).toBe(true);

    act(() => root.render(render(false)));
    expect(editorRef.current).toBe(editor);
    expect(editorRef.current?.textContent).toBe('draft text');
    expect(editorRef.current?.hidden).toBe(false);
  });
});
