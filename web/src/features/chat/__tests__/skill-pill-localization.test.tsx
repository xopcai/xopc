// @vitest-environment jsdom
import { act, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { SWRConfig, type Cache } from 'swr';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useComposerEditor } from '@/features/chat/composer/use-composer-editor';
import { serializeEditorToWire } from '@/features/chat/composer/composer-editor-wire';
import { UserMessageSegments } from '@/features/chat/messages/user-message-segments';
import { getChatSkillsCached, type ChatSkillsPayload } from '@/features/chat/palette/command-palette-api';
import { useGatewayStore } from '@/stores/gateway-store';
import { useLocaleStore } from '@/stores/locale-store';

vi.mock('@/features/chat/palette/command-palette-api', () => ({ getChatSkillsCached: vi.fn() }));
vi.mock('@/features/chat/markdown/markdown-view', () => ({ MarkdownView: ({ content }: { content: string }) => <>{content}</> }));

const payload: ChatSkillsPayload = {
  agentId: 'main', workspacePath: '/workspace', version: '1', loadedAt: 1,
  skills: [{
    name: 'summarize', description: 'Summarize', enabled: true,
    availableForCurrentAgent: true, unavailableReason: null,
    localizations: {
      en: { displayName: 'Summarize', description: 'Summarize' },
      'zh-CN': { displayName: '内容摘要', description: '总结内容' },
    },
  }],
};

function Editor({ composing = false }: { composing?: boolean }) {
  const shouldSyncSelectionRef = useRef(false);
  const editor = useComposerEditor({
    disabled: false, conversationId: 'chat-1', initialValue: '/skill:summarize 正文', shouldSyncSelectionRef,
  });
  // Expose composition transitions without rebuilding the editable DOM.
  return <div><button onClick={() => editor.setIsComposing(composing)}>composition</button>
    <div data-editor ref={editor.editorRef} contentEditable suppressContentEditableWarning />
  </div>;
}

describe('localized skill pills', () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;
  let resolve: (payload: ChatSkillsPayload) => void;
  let cache: Cache;
  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    useGatewayStore.setState({ conversationId: 'browser-test' });
    useLocaleStore.setState({ language: 'zh' });
    vi.mocked(getChatSkillsCached).mockReset().mockImplementation(() => new Promise((done) => { resolve = done; }));
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    cache = new Map();
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    useGatewayStore.setState({ conversationId: undefined });
  });
  async function render(composing = false) {
    await act(async () => root.render(<SWRConfig value={{ provider: () => cache }}>
      <Editor composing={composing} />
      <section><UserMessageSegments text="/skill:summarize /skill:removed" conversationId="chat-1" /></section>
      <section><UserMessageSegments text="/skill:summarize" conversationId="chat-1" /></section>
    </SWRConfig>));
  }

  it('shares metadata, updates historical messages and preserves the draft and caret on locale changes', async () => {
    await render();
    const editor = container.querySelector<HTMLElement>('[data-editor]')!;
    const selection = window.getSelection()!;
    const node = selection.anchorNode;
    const offset = selection.anchorOffset;
    await act(async () => resolve(payload));
    expect(getChatSkillsCached).toHaveBeenCalledTimes(1);
    expect(getChatSkillsCached).toHaveBeenCalledWith(undefined, 'chat-1');
    expect([...container.querySelectorAll('[data-skill="summarize"]')].map((pill) => pill.textContent))
      .toEqual(['/内容摘要', '/内容摘要', '/内容摘要']);
    expect(container.querySelector('[data-skill="removed"]')?.textContent).toBe('/removed');
    await act(async () => useLocaleStore.setState({ language: 'en' }));
    expect([...container.querySelectorAll('[data-skill="summarize"]')].map((pill) => pill.textContent))
      .toEqual(['/Summarize', '/Summarize', '/Summarize']);
    expect(getChatSkillsCached).toHaveBeenCalledTimes(1);
    expect(serializeEditorToWire(editor)).toBe('/skill:summarize 正文');
    expect(selection.anchorNode).toBe(node);
    expect(selection.anchorOffset).toBe(offset);
  });

  it('defers editable label changes until composition ends', async () => {
    await render(true);
    await act(async () => resolve(payload));
    act(() => container.querySelector('button')!.click());
    await act(async () => useLocaleStore.setState({ language: 'en' }));
    expect(container.querySelector('[data-editor] [data-skill]')?.textContent).toBe('/内容摘要');
    await render(false);
    act(() => container.querySelector('button')!.click());
    expect(container.querySelector('[data-editor] [data-skill]')?.textContent).toBe('/Summarize');
  });
});
