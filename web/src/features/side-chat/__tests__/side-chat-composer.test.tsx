// @vitest-environment jsdom

import { act } from 'react';
import { createRoot } from 'react-dom/client';
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
    expiresAt: new Date(1).toISOString(),
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
  sendSideChatInput,
}));

vi.mock('@/features/gateway/gateway-realtime', () => ({
  subscribeRealtimeTopic: vi.fn((_topic: string, handlers: {
    onEvent: (event: { event: string; data?: unknown }) => void;
    onGap: () => void;
  }) => {
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
          onMissing={() => {}}
        />,
      );
    });
  }

  afterEach(() => {
    act(() => root.unmount());
    useSideChatStore.setState({ panes: {}, tabs: [], pendingCreate: null });
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
      root.render(<SideChatColumn parentSessionKey="parent" />);
    });

    expect(container.querySelector('aside')?.getAttribute('aria-label')).toBe('侧边对话');
    expect(container.querySelector('button')?.textContent).toBe('侧边对话');
    expect(container.querySelector('button[aria-label="新建侧边对话"]')).not.toBeNull();
    expect(container.querySelector('button[aria-label="关闭侧边对话面板"]')).not.toBeNull();
  });

  it('confirms before permanently closing a side chat', async () => {
    useLocaleStore.setState({ language: 'zh' });
    useSideChatStore.setState({
      panes: { parent: { open: true, activeId: 'side-1' } },
      tabs: [{ id: 'side-1', parentSessionKey: 'parent', title: 'Side chat' }],
      pendingCreate: null,
    });
    await act(async () => {
      root.render(<SideChatColumn parentSessionKey="parent" />);
    });

    await act(async () => {
      container.querySelector<HTMLButtonElement>('button[aria-label="关闭侧边对话"]')?.click();
    });

    expect(document.body.textContent).toContain('关闭侧边对话？');
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
    useSideChatStore.setState({
      panes: { parent: { open: true, activeId: 'side-1' } },
      tabs: [{ id: 'side-1', parentSessionKey: 'parent', title: 'Side chat' }],
      pendingCreate: null,
    });
    await act(async () => {
      root.render(<SideChatColumn parentSessionKey="parent" />);
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
      root.render(<SideChatColumn parentSessionKey="parent" />);
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
});
