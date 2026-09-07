// @vitest-environment jsdom

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { createSideChat, deleteSideChat, getSideChatMessages, realtime, sendSideChatInput, sideChatSelections } = vi.hoisted(() => ({
  createSideChat: vi.fn(async (parentSessionKey: string, selections: unknown[]) => ({
    id: 'side-2',
    parentSessionKey,
    context: { selections },
  })),
  getSideChatMessages: vi.fn(async () => [] as unknown[]),
  deleteSideChat: vi.fn(async () => undefined),
  realtime: {
    onEvent: null as null | ((event: { event: string; data?: unknown }) => void),
    onGap: null as null | (() => void),
    onExpiry: null as null | ((event: { event: string; data?: unknown }) => void),
  },
  sendSideChatInput: vi.fn(async () => 'run-1'),
  sideChatSelections: { current: [] as Array<{ id: string; type: 'text'; text: string; label?: string }> },
}));

vi.mock('@/features/side-chat/side-chat-api', () => ({
  abortSideChat: vi.fn(),
  answerSideChatClarification: vi.fn(),
  createSideChat,
  deleteSideChat,
  getSideChat: vi.fn(async () => ({
    id: 'side-1',
    parentSessionKey: 'parent',
    clientInstanceId: 'tab-1',
    status: 'idle',
    createdAt: new Date(0).toISOString(),
    lastActiveAt: new Date(0).toISOString(),
    expiresAt: new Date(Date.now() + 30 * 60_000).toISOString(),
    messageCount: 0,
    context: {
      parentSessionKey: 'parent',
      parentSessionId: 'parent-id',
      parentMessageCount: 0,
      createdAt: new Date(0).toISOString(),
      selections: sideChatSelections.current,
      contentHash: 'hash',
    },
    config: { modelRef: 'openai/test' },
  })),
  getSideChatMessages,
  heartbeatSideChat: vi.fn(),
  extendSideChat: vi.fn(),
  getSideChatClientInstanceId: () => 'tab-1',
  sendSideChatInput,
}));

vi.mock('@/features/gateway/gateway-realtime', () => ({
  subscribeRealtimeTopic: vi.fn((_topic: string, handlers: {
    onEvent: (event: { event: string; data?: unknown }) => void;
    onGap: () => void;
  }) => {
    if (_topic.startsWith('side-chat:')) { realtime.onExpiry = handlers.onEvent; return () => {}; }
    realtime.onEvent = handlers.onEvent;
    realtime.onGap = handlers.onGap;
    return () => {};
  }),
}));

vi.mock('@/features/chat/messages/message-list', () => ({
  MessageList: ({
    messages,
    registerListContentRef,
  }: {
    messages: Array<{ content: Array<{ type: string; text?: string }> }>;
    registerListContentRef: (element: HTMLDivElement | null) => void;
  }) => (
    <div ref={registerListContentRef} data-testid="message-thread">
      {messages.flatMap((message) => message.content).map((block) => block.type === 'text' ? block.text : '').join('\n')}
    </div>
  ),
}));

import { getSideChat, heartbeatSideChat, extendSideChat } from '../side-chat-api';
import { useSideChatStore } from '@/stores/side-chat-store';
import { useLocaleStore } from '@/stores/locale-store';
import { SideChatColumn, SideChatConversation } from '../side-chat-column';

describe('SideChatConversation composer', () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;
  let resizeCallback: ResizeObserverCallback | null;
  let resizeObserver: ResizeObserver | null;

  beforeEach(async () => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    sendSideChatInput.mockClear();
    createSideChat.mockClear();
    deleteSideChat.mockClear();
    localStorage.removeItem('xopc:side-chat-close-confirm-disabled:v1');
    sideChatSelections.current = [];
    getSideChatMessages.mockReset();
    getSideChatMessages.mockResolvedValue([]);
    realtime.onEvent = null;
    realtime.onGap = null;
    realtime.onExpiry = null;
    resizeCallback = null;
    resizeObserver = null;
    class ResizeObserverMock implements ResizeObserver {
      constructor(callback: ResizeObserverCallback) {
        resizeCallback = callback;
        resizeObserver = this;
      }
      disconnect() {}
      observe() {}
      unobserve() {}
    }
    vi.stubGlobal('ResizeObserver', ResizeObserverMock);
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  async function renderConversation() {
    await act(async () => {
      root.render(
        <SideChatConversation
          sideChatId="side-1"
          onRunIdChange={() => {}}
          parentSessionKey="parent"
        />,
      );
    });
  }

  afterEach(() => {
    act(() => root.unmount());
    useSideChatStore.setState({ panes: {}, tabs: [], pendingCreate: null, drafts: {}, readings: {} });
    useLocaleStore.setState({ language: 'en' });
    container.remove();
    localStorage.removeItem('xopc:side-chat-close-confirm-disabled:v1');
    vi.unstubAllGlobals();
  });

  async function typeDraft(value: string) {
    const textarea = container.querySelector('textarea');
    await act(async () => {
      const valueSetter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
      valueSetter?.call(textarea, value);
      textarea?.dispatchEvent(new Event('input', { bubbles: true }));
    });
    return textarea;
  }

  it('clears the textarea immediately when Enter sends the draft', async () => {
    await renderConversation();
    const textarea = await typeDraft('hello');
    expect(textarea).not.toBeNull();
    expect(textarea?.value).toBe('hello');

    await act(async () => {
      textarea?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    });

    expect(sendSideChatInput).toHaveBeenCalledWith('side-1', 'hello');
    expect(textarea?.value).toBe('');
  });

  it('clears the textarea immediately when the send button submits the draft', async () => {
    await renderConversation();
    const textarea = await typeDraft('hello');
    const send = container.querySelector<HTMLButtonElement>('button[aria-label="Send"]');

    await act(async () => { send?.click(); });

    expect(sendSideChatInput).toHaveBeenCalledWith('side-1', 'hello');
    expect(textarea?.value).toBe('');
  });

  it('keeps the sent user message when the initial empty snapshot resolves later', async () => {
    let resolveInitialMessages!: (messages: unknown[]) => void;
    getSideChatMessages.mockImplementationOnce(() => new Promise((resolve) => {
      resolveInitialMessages = resolve;
    }));
    await renderConversation();
    const textarea = await typeDraft('hello');

    await act(async () => {
      textarea?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    });
    expect(container.querySelector('[data-testid="message-thread"]')?.textContent).toContain('hello');

    await act(async () => resolveInitialMessages([]));

    expect(container.querySelector('[data-testid="message-thread"]')?.textContent).toContain('hello');
    expect(container.querySelector('button[aria-label="Abort"]')).not.toBeNull();
  });

  it('keeps the sent user message when a post-send gap snapshot does not contain it yet', async () => {
    await renderConversation();
    const textarea = await typeDraft('hello');
    await act(async () => {
      textarea?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    });
    expect(realtime.onGap).not.toBeNull();

    await act(async () => {
      realtime.onGap?.();
      await Promise.resolve();
    });

    expect(container.querySelector('[data-testid="message-thread"]')?.textContent).toContain('hello');
  });

  it('does not follow streaming content after the user scrolls toward older messages', async () => {
    await renderConversation();
    const textarea = await typeDraft('hello');
    await act(async () => {
      textarea?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    });

    const viewport = container.querySelector('[data-side-chat-scroll-viewport]') as HTMLDivElement;
    let scrollHeight = 1_000;
    const clientHeight = 300;
    let scrollTop = 700;
    Object.defineProperties(viewport, {
      clientHeight: { configurable: true, get: () => clientHeight },
      scrollHeight: { configurable: true, get: () => scrollHeight },
      scrollTop: {
        configurable: true,
        get: () => scrollTop,
        set: (value: number) => { scrollTop = value; },
      },
    });

    await act(async () => {
      viewport.dispatchEvent(new WheelEvent('wheel', { deltaY: -80, bubbles: true }));
      scrollTop = 300;
      viewport.dispatchEvent(new Event('scroll', { bubbles: true }));
    });
    scrollHeight = 1_100;
    act(() => resizeCallback?.([], resizeObserver!));

    expect(scrollTop).toBe(300);
    expect([...container.querySelectorAll('button')].some((button) => button.className.includes('bottom-4'))).toBe(true);
  });

  it('renders selected context as a reference chip inside the composer', async () => {
    sideChatSelections.current = [{ id: 'selection-1', type: 'text', text: 'quoted text', label: 'Selected text' }];
    await renderConversation();

    const form = container.querySelector('form');
    expect(form?.textContent).toContain('1 selection');
    expect(container.querySelector('[data-side-chat-scroll-viewport]')?.textContent).not.toContain('1 selection');
  });

  it('renders side chat chrome and selection counts in Chinese', async () => {
    useLocaleStore.setState({ language: 'zh' });
    sideChatSelections.current = [{ id: 'selection-1', type: 'text', text: 'quoted text', label: '所选文本' }];
    await renderConversation();

    expect(container.querySelector('[data-side-chat-scroll-viewport]')?.textContent).toContain('侧边对话');
    expect(container.querySelector('form')?.textContent).toContain('1 处选中内容');
    expect(container.querySelector('[title="沿用主任务的工具与审批策略"]')?.textContent).toContain('主任务权限');
  });

  it('localizes side chat API errors by error code', async () => {
    useLocaleStore.setState({ language: 'zh' });
    sendSideChatInput.mockRejectedValueOnce(Object.assign(
      new Error('A side chat run is already active'),
      { body: { code: 'CONFLICT' } },
    ));
    await renderConversation();
    const textarea = await typeDraft('hello');

    await act(async () => {
      textarea?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
      await Promise.resolve();
    });

    expect(container.textContent).toContain('此侧边对话正忙，请等待当前回复完成。');
    expect(container.textContent).not.toContain('A side chat run is already active');
  });

  it('translates the side chat pane controls and legacy default tab title', async () => {
    useLocaleStore.setState({ language: 'zh' });
    useSideChatStore.setState({
      panes: { parent: { open: true, activeId: 'side-1' } },
      tabs: [{ id: 'side-1', parentSessionKey: 'parent', title: 'Side chat' }],
      pendingCreate: null,
    });
    await act(async () => {
      root.render(<MemoryRouter><SideChatColumn parentSessionKey="parent" /></MemoryRouter>);
    });

    expect(container.querySelector('aside')?.getAttribute('aria-label')).toBe('侧边对话');
    expect(container.querySelector('button')?.textContent).toBe('侧边对话');
    expect(container.querySelector('button[aria-label="新建侧边对话"]')).not.toBeNull();
    expect(container.querySelector('button[aria-label="收起侧栏"]')).not.toBeNull();
  });

  it('confirms before permanently closing a side chat', async () => {
    getSideChatMessages.mockResolvedValue([{ role: 'user', content: 'keep me', timestamp: 1 }]);
    useLocaleStore.setState({ language: 'zh' });
    useSideChatStore.setState({
      panes: { parent: { open: true, activeId: 'side-1' } },
      tabs: [{ id: 'side-1', parentSessionKey: 'parent', title: 'Side chat' }],
      pendingCreate: null,
    });
    await act(async () => {
      root.render(<MemoryRouter><SideChatColumn parentSessionKey="parent" /></MemoryRouter>);
    });

    await act(async () => {
      container.querySelector<HTMLButtonElement>('button[aria-label="关闭侧边对话"]')?.click();
    });

    expect(document.body.textContent).toContain('结束这段临时对话？');
    expect(document.body.textContent).toContain('无法恢复');
    expect(useSideChatStore.getState().tabs).toHaveLength(1);
    expect(deleteSideChat).not.toHaveBeenCalled();

    const confirm = [...document.body.querySelectorAll<HTMLButtonElement>('button')]
      .find((button) => button.textContent === '关闭侧边对话');
    await act(async () => confirm?.click());

    expect(useSideChatStore.getState().tabs).toHaveLength(0);
    expect(deleteSideChat).toHaveBeenCalledWith('side-1');
  });

  it('can remember not to ask before closing another side chat', async () => {
    getSideChatMessages.mockResolvedValue([{ role: 'user', content: 'keep me', timestamp: 1 }]);
    useSideChatStore.setState({
      panes: { parent: { open: true, activeId: 'side-1' } },
      tabs: [{ id: 'side-1', parentSessionKey: 'parent', title: 'Side chat' }],
      pendingCreate: null,
    });
    await act(async () => {
      root.render(<MemoryRouter><SideChatColumn parentSessionKey="parent" /></MemoryRouter>);
    });
    await act(async () => {
      container.querySelector<HTMLButtonElement>('button[aria-label="Close side chat"]')?.click();
    });

    const checkbox = document.body.querySelector<HTMLInputElement>('input[type="checkbox"]');
    await act(async () => {
      checkbox?.click();
    });
    const confirm = [...document.body.querySelectorAll<HTMLButtonElement>('button')]
      .find((button) => button.textContent === 'Close side chat');
    await act(async () => confirm?.click());

    expect(localStorage.getItem('xopc:side-chat-close-confirm-disabled:v1')).toBe('true');

    useSideChatStore.getState().addTab({ id: 'side-2', parentSessionKey: 'parent', title: 'Side chat' });
    await act(async () => {});
    await act(async () => {
      container.querySelector<HTMLButtonElement>('button[aria-label="Close side chat"]')?.click();
    });

    expect(deleteSideChat).toHaveBeenLastCalledWith('side-2');
    expect(document.body.textContent).not.toContain('Close side chat?');
  });

  it('creates a new empty side chat from the top tab bar', async () => {
    useSideChatStore.setState({
      panes: { parent: { open: true, activeId: 'side-1' } },
      tabs: [{ id: 'side-1', parentSessionKey: 'parent', title: 'Side chat' }],
      pendingCreate: null,
    });
    await act(async () => {
      root.render(<MemoryRouter><SideChatColumn parentSessionKey="parent" /></MemoryRouter>);
    });

    const create = container.querySelector<HTMLButtonElement>('button[aria-label="New side chat"]');
    await act(async () => {
      create?.click();
      await Promise.resolve();
    });

    expect(createSideChat).toHaveBeenCalledOnce();
    expect(createSideChat).toHaveBeenCalledWith('parent', []);
    expect(useSideChatStore.getState().tabs.map((tab) => tab.id)).toEqual(['side-1', 'side-2']);
  });
  async function renderColumn() {
    useSideChatStore.getState().addTab({ id: 'side-1', parentSessionKey: 'parent', title: 'Side chat' });
    await act(async () => { root.render(<MemoryRouter><SideChatColumn parentSessionKey="parent" /></MemoryRouter>); });
  }

  it('retains reading content and the draft on expiry, replacing the tab only after a successful new chat', async () => {
    getSideChatMessages.mockResolvedValue([{ role: 'assistant', content: [{ type: 'text', text: 'useful answer' }], timestamp: 1 }]);
    await renderColumn();
    await typeDraft('keep my question');
    await act(async () => realtime.onExpiry?.({ event: 'expired', data: { reason: 'idle' } }));
    expect(container.textContent).toContain('Temporary chat ended');
    expect(container.textContent).toContain('useful answer');
    expect(container.querySelector('textarea')?.value).toBe('keep my question');
    expect(useSideChatStore.getState().tabs).toHaveLength(1);
    expect(sendSideChatInput).not.toHaveBeenCalled();
    const create = [...container.querySelectorAll<HTMLButtonElement>('button')].find((button) => button.textContent === 'New chat with draft');
    createSideChat.mockRejectedValueOnce(new Error('try later'));
    await act(async () => create?.click());
    expect(container.querySelector('textarea')?.value).toBe('keep my question');
    expect(useSideChatStore.getState().tabs[0].id).toBe('side-1');
    await act(async () => create?.click());
    expect(useSideChatStore.getState().tabs.map((tab) => tab.id)).toEqual(['side-2']);
    expect(container.querySelector('textarea')?.value).toBe('keep my question');
    expect(sendSideChatInput).not.toHaveBeenCalled();
  });

  it('restores the exact unsent draft when a send loses the expiry race', async () => {
    await renderConversation();
    const textarea = await typeDraft('  unfinished question  ');
    sendSideChatInput.mockRejectedValueOnce(Object.assign(new Error('expired'), { status: 410, body: { code: 'EXPIRED', reason: 'idle' } }));
    await act(async () => { textarea?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })); });
    expect(container.textContent).toContain('Temporary chat ended');
    expect(container.querySelector('textarea')?.value).toBe('  unfinished question  ');
    expect(container.querySelector('[data-testid="message-thread"]')?.textContent ?? '').not.toContain('unfinished question');
  });

  it('keeps the ending warning after a failed extension and hides it after success', async () => {
    const view = await getSideChat('side-1');
    vi.mocked(getSideChat).mockResolvedValueOnce({ ...view, expiresAt: new Date(Date.now() + 4 * 60_000).toISOString() });
    vi.mocked(extendSideChat).mockRejectedValueOnce(new Error('offline'));
    await renderConversation();
    const extend = [...container.querySelectorAll<HTMLButtonElement>('button')].find((button) => button.textContent === 'Keep open');
    expect(extend).toBeDefined();
    await act(async () => extend?.click());
    expect(container.textContent).toContain('Please retry');
    expect(container.textContent).toContain('Keep open');
    vi.mocked(extendSideChat).mockResolvedValueOnce({ ...view, expiresAt: new Date(Date.now() + 30 * 60_000).toISOString() });
    await act(async () => extend?.click());
    expect(container.textContent).toContain('Kept open for another 30 minutes');
    expect(container.textContent).not.toContain('Keep open');
  });

  it('distinguishes an unavailable chat from a temporary connection failure', async () => {
    vi.mocked(getSideChat).mockRejectedValueOnce(new TypeError('Failed to fetch'));
    await renderColumn();
    await typeDraft('draft while offline');
    expect(container.textContent).toContain('Reconnecting');
    expect(useSideChatStore.getState().tabs[0].ended).toBeUndefined();
    vi.mocked(getSideChat).mockRejectedValueOnce(Object.assign(new Error('gone'), { status: 404 }));
    await act(async () => { window.dispatchEvent(new Event('online')); });
    expect(container.textContent).toContain('This temporary chat is no longer available');
    expect(container.querySelector('textarea')?.value).toBe('draft while offline');
    expect(useSideChatStore.getState().tabs).toHaveLength(1);
  });

  it('recovers waiting questions on reload and does not delete when the page is hidden', async () => {
    const view = await getSideChat('side-1');
    vi.mocked(getSideChat).mockResolvedValueOnce({ ...view, status: 'waiting-input', runId: 'run-waiting', clarification: { requestId: 'question-1', question: 'Which option?', choices: ['A', 'B'] } });
    await renderColumn();
    expect(container.textContent).toContain('Which option?');
    await act(async () => { window.dispatchEvent(new Event('pagehide')); });
    expect(deleteSideChat).not.toHaveBeenCalled();
    expect(useSideChatStore.getState().tabs[0].runId).toBe('run-waiting');
  });

  it('retains the draft when collapsing and reopening the sidebar', async () => {
    await renderColumn();
    await typeDraft('read this later');
    await act(async () => container.querySelector<HTMLButtonElement>('button[aria-label="Collapse sidebar"]')?.click());
    expect(deleteSideChat).not.toHaveBeenCalled();
    await act(async () => useSideChatStore.getState().setOpen('parent', true));
    expect(container.querySelector('textarea')?.value).toBe('read this later');
  });

  it('shows the ended state when a heartbeat finds an expired session and stops polling', async () => {
    vi.useFakeTimers();
    try {
      await renderColumn();
      vi.mocked(heartbeatSideChat).mockRejectedValueOnce(Object.assign(new Error('expired'), { status: 410, body: { code: 'EXPIRED', reason: 'waiting' } }));
      await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
      expect(container.textContent).toContain('ended while waiting');
      const calls = vi.mocked(heartbeatSideChat).mock.calls.length;
      await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
      expect(vi.mocked(heartbeatSideChat).mock.calls.length).toBe(calls);
    } finally { vi.useRealTimers(); }
  });

  it('restores a failed send even if the user collapsed the sidebar while it was in flight', async () => {
    let reject!: (error: Error) => void;
    sendSideChatInput.mockImplementationOnce(() => new Promise((_resolve, fail) => { reject = fail; }));
    await renderColumn();
    const textarea = await typeDraft('do not lose this');
    await act(async () => textarea?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })));
    await act(async () => root.render(null));
    await act(async () => reject(new Error('network failed')));
    expect(useSideChatStore.getState().drafts['side-1']).toBe('do not lose this');
    expect(useSideChatStore.getState().readings['side-1'].messages).toEqual([]);
  });

  it('removes an unaccepted optimistic message when expiry arrives before the send response', async () => {
    let reject!: (error: Error) => void;
    sendSideChatInput.mockImplementationOnce(() => new Promise((_resolve, fail) => { reject = fail; }));
    await renderColumn();
    const textarea = await typeDraft('pending question');
    await act(async () => textarea?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })));
    await act(async () => realtime.onExpiry?.({ event: 'expired', data: { reason: 'idle' } }));
    await act(async () => reject(Object.assign(new Error('expired'), { status: 410 })));
    expect(container.querySelector('textarea')?.value).toBe('pending question');
    expect(container.querySelector('[data-testid="message-thread"]')?.textContent ?? '').not.toContain('pending question');
  });

});
