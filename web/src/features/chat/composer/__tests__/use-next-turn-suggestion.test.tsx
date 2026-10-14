// @vitest-environment jsdom
import { act, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { apiFetch, readSessionTranscript, readLocalSessionDraft } = vi.hoisted(() => ({
  apiFetch: vi.fn(), readSessionTranscript: vi.fn(), readLocalSessionDraft: vi.fn(),
}));
vi.mock('@/lib/fetch', () => ({ apiFetch }));
vi.mock('@/lib/url', () => ({ apiUrl: (path: string) => path }));
vi.mock('@/features/chat/session/local-session-drafts', () => ({ readSessionTranscript, readLocalSessionDraft }));

import { useNextTurnSuggestion } from '../use-next-turn-suggestion';
import { ChatComposerInput, type ComposerKbdContext } from '../chat-composer-input';

describe('useNextTurnSuggestion', () => {
  let root: ReturnType<typeof createRoot>;
  let container: HTMLDivElement;
  let current: ReturnType<typeof useNextTurnSuggestion>;
  const id = '78fcccd3-a14f-4a70-87d9-69d9471f63d7';
  const suggestion = { id: 'fae3754b-74b0-4df6-8fa3-0f45011a3acd', conversationId: id,
    transcriptId: 'transcript-a', sourceRunId: 'run-a', inputRevision: 2, transcriptCursor: 4,
    agentId: 'main', locale: 'zh', prompt: '先拆出第一阶段的任务', expiresAt: Date.now() + 60_000 };
  function Host(props: { conversationId: string; enabled: boolean; locale?: 'zh' | 'en'; draftText: string; canShow: boolean }) {
    current = useNextTurnSuggestion({ ...props, locale: props.locale ?? 'zh', agentId: 'main' });
    return <div>{current.suggestion?.prompt ?? 'ordinary placeholder'}</div>;
  }
  async function render(conversationId = id, enabled = true, locale: 'zh' | 'en' = 'zh', draftText = '', canShow = true) {
    await act(async () => { root.render(<Host conversationId={conversationId} enabled={enabled} locale={locale} draftText={draftText} canShow={canShow} />); });
  }
  const ready = () => ({ ok: true, json: async () => ({ status: 'ready', suggestion }) });
  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    localStorage.clear();
    container = document.createElement('div'); document.body.append(container); root = createRoot(container);
    apiFetch.mockReset().mockImplementation(async (_url, options) => options?.method === 'POST'
      ? { ok: true } : ready());
    readSessionTranscript.mockReset().mockResolvedValue('transcript-a');
    readLocalSessionDraft.mockReset().mockResolvedValue(null);
  });
  afterEach(() => { act(() => root.unmount()); container.remove(); });

  it('fills a selection separately from sending and records shown, accepted and edited submission', async () => {
    await render();
    expect(container.textContent).toBe(suggestion.prompt);
    act(() => current.shown());
    let text: string | null = null;
    act(() => { text = current.accept(); });
    expect(text).toBe(suggestion.prompt);
    await render(id, true, 'zh', text!);
    expect(current.suggestion).toBeNull();
    act(() => current.submitted('先只拆第一阶段，别实现'));
    const events = apiFetch.mock.calls.filter(call => call[1]?.method === 'POST').map(call => JSON.parse(call[1].body));
    expect(events.map(event => event.event)).toEqual(['shown', 'accepted', 'submitted']);
    expect(events[2].edited).toBe(true);
    expect(events[0].impressionId).toBe(events[2].impressionId);
    expect(events.every(event => !('prompt' in event))).toBe(true);
  });

  it('discards a delayed response after drafting starts without changing draft content', async () => {
    let finish!: (response: ReturnType<typeof ready>) => void;
    apiFetch.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    await render();
    await render(id, true, 'zh', 'My existing draft');
    await act(async () => { finish(ready()); });
    expect(current.suggestion).toBeNull();
    expect(current.accept()).toBeNull();
    await render();
    expect(current.suggestion?.prompt).toBe(suggestion.prompt);
    expect(apiFetch.mock.calls.filter(call => call[1]?.method !== 'POST')).toHaveLength(1);
  });

  it('restores the original cached suggestion immediately after clearing each accepted draft', async () => {
    await render();
    for (let attempt = 0; attempt < 3; attempt++) {
      let text: string | null = null;
      act(() => { text = current.accept(); });
      expect(text).toBe(suggestion.prompt);
      await render(id, true, 'zh', text!);
      expect(current.suggestion).toBeNull();
      await render(id, true, 'zh', '部分删除后剩下的内容');
      expect(current.suggestion).toBeNull();
      act(() => root.render(<Host conversationId={id} enabled draftText="" canShow />));
      expect(current.suggestion?.id).toBe(suggestion.id);
    }
    expect(apiFetch.mock.calls.filter(call => call[1]?.method !== 'POST')).toHaveLength(1);
    act(() => current.submitted('后来独立手写的消息'));
    expect(apiFetch.mock.calls.filter(call => call[1]?.method === 'POST')
      .map(call => JSON.parse(call[1].body).event)).not.toContain('submitted');
  });

  it('retains acceptance for an edited or rejected send, then consumes it only on successful submission', async () => {
    await render();
    act(() => current.accept());
    await render(id, true, 'zh', '保留修改后的草稿');
    // A rejected send leaves the draft intact and never calls submitted().
    await render(id, true, 'zh', '保留修改后的草稿', false);
    await render(id, true, 'zh', '保留修改后的草稿');
    act(() => current.submitted('保留修改后的草稿'));
    await render();
    expect(current.suggestion).toBeNull();
    const events = apiFetch.mock.calls.filter(call => call[1]?.method === 'POST').map(call => JSON.parse(call[1].body));
    expect(events.filter(event => event.event === 'submitted')).toMatchObject([{ edited: true }]);
  });

  it('keeps an explicitly dismissed suggestion hidden after drafting and clearing', async () => {
    await render();
    act(() => current.dismiss());
    await render(id, true, 'zh', '手写草稿');
    await render();
    expect(current.suggestion).toBeNull();
    expect(current.accept()).toBeNull();
  });

  it('continues invalidation while a draft hides the suggestion', async () => {
    await render();
    act(() => current.accept());
    await render(id, true, 'zh', suggestion.prompt);
    apiFetch.mockResolvedValue({ ok: true, json: async () => ({ status: 'none' }) });
    await act(async () => {
      window.dispatchEvent(new CustomEvent('session-input-state', { detail: { conversationId: id, revision: 3 } }));
    });
    await render();
    expect(current.suggestion).toBeNull();
    expect(current.accept()).toBeNull();
  });

  it('expires a hidden cached suggestion before the accepted draft is cleared', async () => {
    vi.useFakeTimers();
    try {
      apiFetch.mockResolvedValue({ ok: true, json: async () => ({ status: 'ready', suggestion: { ...suggestion, expiresAt: Date.now() + 1000 } }) });
      await render();
      act(() => current.accept());
      await render(id, true, 'zh', suggestion.prompt);
      act(() => vi.advanceTimersByTime(1001));
      await render();
      expect(current.suggestion).toBeNull();
      expect(apiFetch.mock.calls.filter(call => call[1]?.method !== 'POST')).toHaveLength(1);
    } finally { vi.useRealTimers(); }
  });

  it('handles actual Tab → browser deletion → Tab without extra UI or another fetch', async () => {
    function EditorHost() {
      const [draftText, setDraftText] = useState('');
      const editorRef = useRef<HTMLDivElement | null>(null);
      const valueRef = useRef('');
      const keyboard = useRef({} as ComposerKbdContext);
      const prediction = useNextTurnSuggestion({ conversationId: id, enabled: true, locale: 'zh', agentId: 'main', draftText, canShow: true });
      keyboard.current = {
        adapters: [], send: vi.fn(), runBusy: false, pendingFollowUpsCount: 0, editingFollowUpId: null,
        onCancelEditFollowUp: vi.fn(), attachmentsLen: 0, contextRefsLen: 0, isComposing: false,
        valueRef, editorRef, adjustHeight: vi.fn(), acceptEmptySuggestion: () => {
          const text = prediction.accept();
          if (!text || !editorRef.current) return false;
          editorRef.current.textContent = text;
          valueRef.current = text;
          setDraftText(text);
          return true;
        },
      };
      return <ChatComposerInput editorRef={editorRef} disabled={false} placeholder={prediction.suggestion?.prompt ?? 'Message'}
        onWireInput={text => { valueRef.current = text; setDraftText(text); }} adjustHeight={() => {}}
        processFiles={async () => {}} processPastedText={async () => {}} setIsComposing={() => {}}
        kbdRef={keyboard} chatMessages={{ clipboardFileTypeUnsupported: 'Unsupported' }} />;
    }
    await act(async () => root.render(<EditorHost />));
    const editor = container.querySelector<HTMLDivElement>('[role="textbox"]')!;
    for (let attempt = 0; attempt < 3; attempt++) {
      expect(editor.dataset.placeholder).toBe(suggestion.prompt);
      const tab = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
      act(() => editor.dispatchEvent(tab));
      expect(tab.defaultPrevented).toBe(true);
      expect(editor.textContent).toBe(suggestion.prompt);
      act(() => {
        editor.innerHTML = '<br>';
        editor.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'deleteContentBackward' }));
      });
      expect(editor.textContent).toBe('');
      expect(editor.dataset.placeholder).toBe(suggestion.prompt);
    }
    expect(container.querySelectorAll('button')).toHaveLength(0);
    expect(apiFetch.mock.calls.filter(call => call[1]?.method !== 'POST')).toHaveLength(1);
  });

  it('never shows another conversation or locale response after switching', async () => {
    await render();
    await render('other-conversation');
    expect(current.suggestion).toBeNull();
    await render(id, true, 'en');
    expect(current.suggestion).toBeNull();
  });

  it('rejects old transcript and revision after reset or new input', async () => {
    await render();
    readSessionTranscript.mockResolvedValue('transcript-b');
    await act(async () => { window.dispatchEvent(new CustomEvent('session-updated', { detail: { key: id } })); });
    expect(current.suggestion).toBeNull();
    readSessionTranscript.mockResolvedValue('transcript-a');
    await act(async () => { window.dispatchEvent(new CustomEvent('session-input-state', { detail: { conversationId: id, revision: 3 } })); });
    expect(current.suggestion).toBeNull();
  });

  it('revalidates on reconnect and gap without honoring obsolete button preferences', async () => {
    localStorage.setItem(`xopc:next-turn-suggestions:${id}`, 'off');
    await render();
    expect(current.suggestion?.prompt).toBe(suggestion.prompt);
    await act(async () => { window.dispatchEvent(new CustomEvent('gateway-realtime-connected')); });
    await act(async () => { window.dispatchEvent(new CustomEvent('realtime-gap', { detail: { topic: 'sessions' } })); });
    expect(current.suggestion?.prompt).toBe(suggestion.prompt);
  });

  it('does not call a gateway for a local draft or disabled composer', async () => {
    await render(id, false);
    expect(apiFetch).not.toHaveBeenCalled();
    readLocalSessionDraft.mockResolvedValue({ creation: {} });
    await render();
    expect(apiFetch).not.toHaveBeenCalled();
  });
});
