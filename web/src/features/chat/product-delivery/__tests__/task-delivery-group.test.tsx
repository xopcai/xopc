// @vitest-environment jsdom

import type { ProductReference } from '@xopcai/gateway-contract';
import * as Dialog from '@radix-ui/react-dialog';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom';
import { SWRConfig, type Cache } from 'swr';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/features/tasks/home-api', () => ({
  fetchTask: vi.fn(async () => ({ task: {}, operationalState: 'waiting' })),
}));

import { fetchTask } from '@/features/tasks/home-api';
import { ProductDeliveryRows } from '../product-delivery-tail';
import type { ProductDeliveryEntry } from '../product-delivery-model';
import { useChatScrollViewport, type UseChatScrollViewportResult } from '@/features/chat/scroll/use-chat-scroll-viewport';
import type { Message } from '@/features/chat/messages/messages.types';

const chatMessages: Message[] = [{ role: 'assistant', content: [] }];
const task = (index: number): ProductReference => ({
  kind: 'task', id: `task-${index}`, title: `Task ${index}`, capabilities: ['open'],
});
const deliveries = (count: number): ProductDeliveryEntry[] => Array.from({ length: count }, (_, index) => ({
  key: `delivery-${index}`, delivery: { version: 2, operation: 'created', primary: task(index) },
}));

function NavigationProbe() {
  const location = useLocation();
  const navigate = useNavigate();
  return <><output data-location>{location.pathname}{location.search}</output>
    {location.search ? <Dialog.Root modal={false} open onOpenChange={() => navigate('/chat/session-1')}>
      <Dialog.Portal><Dialog.Content aria-describedby={undefined}>
        <Dialog.Title>Task details</Dialog.Title>
        <Dialog.Close data-back>Back to list</Dialog.Close>
      </Dialog.Content></Dialog.Portal>
    </Dialog.Root> : null}</>;
}

describe('task delivery summary', () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;
  let viewport: UseChatScrollViewportResult;
  let observers: Map<Element, () => void>;
  let cache: Cache;

  function Harness({ entries, excluded, language = 'en' }: {
    entries: ProductDeliveryEntry[]; excluded?: ReadonlySet<string>; language?: 'en' | 'zh';
  }) {
    viewport = useChatScrollViewport({ hasToken: true, showSessionLoading: false,
      conversationId: 'session-1', chatMessages, streaming: false, hasMore: false,
      loadingMore: false, loadMoreMessages: () => {} });
    return <div data-viewport ref={viewport.scrollRef} onScroll={viewport.onScroll}>
      <div ref={viewport.registerListContentRef}><ul><ProductDeliveryRows deliveries={entries}
        language={language} excludedReferenceKeys={excluded} /></ul></div>
      <NavigationProbe />
    </div>;
  }

  async function render(entries: ProductDeliveryEntry[], excluded?: ReadonlySet<string>, language?: 'en' | 'zh') {
    await act(async () => root.render(<MemoryRouter initialEntries={['/chat/session-1']}>
      <SWRConfig value={{ provider: () => cache, dedupingInterval: 0 }}>
        <Harness entries={entries} excluded={excluded} language={language} />
      </SWRConfig>
    </MemoryRouter>));
  }

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    observers = new Map();
    cache = new Map();
    vi.clearAllMocks();
    const frames = new Map<number, FrameRequestCallback>();
    let frameId = 0;
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      frames.set(++frameId, callback);
      return frameId;
    });
    vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
    vi.stubGlobal('ResizeObserver', class {
      constructor(private callback: ResizeObserverCallback) {}
      observe(element: Element) {
        observers.set(element, () => {
          this.callback([], this);
          const callbacks = [...frames.values()];
          frames.clear();
          callbacks.forEach(callback => callback(0));
        });
      }
      disconnect() {}
      unobserve() {}
    });
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
      await new Promise(resolve => setTimeout(resolve, 0));
    });
    container.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it.each([0, 1, 2, 3, 4])('shows at most three inline tasks for %i entries', async count => {
    await render(deliveries(count));
    expect(container.querySelectorAll('[data-product-delivery="task"]')).toHaveLength(Math.min(count, 3));
    expect(Boolean(container.querySelector('[data-product-task-group]'))).toBe(count > 3);
    expect(container.textContent?.includes(`View all ${count} tasks`)).toBe(count > 3);
  });

  it('loads hidden tasks only on opening the dialog and preserves order and full titles', async () => {
    const entries = deliveries(8);
    entries[7].delivery.primary!.title = 'A very long task title that must remain fully readable in the task list';
    await render(entries);
    expect(vi.mocked(fetchTask).mock.calls.map(([id]) => id)).toEqual(['task-0', 'task-1', 'task-2']);
    await act(async () => container.querySelector<HTMLButtonElement>('[aria-haspopup="dialog"]')!.click());
    const dialog = document.querySelector('[role="dialog"]')!;
    expect(dialog.textContent).toContain('Related tasks · 8');
    expect([...dialog.querySelectorAll('[data-product-delivery="task"] [title]')]
      .filter(element => element.classList.contains('text-fg')).map(element => element.textContent))
      .toEqual(entries.map(entry => entry.delivery.primary!.title));
    expect(new Set(vi.mocked(fetchTask).mock.calls.map(([id]) => id)).size).toBe(8);
    expect(dialog.querySelector('[title^="A very long"]')?.classList.contains('truncate')).toBe(false);
    expect(container.querySelectorAll('[data-product-delivery="task"]')).toHaveLength(3);
  });

  it.each([200, 600])('preserves chat scroll and following through list, details and close at scrollTop %i', async initialTop => {
    await render(deliveries(6));
    const el = container.querySelector<HTMLDivElement>('[data-viewport]')!;
    let height = 1000;
    let top = 600;
    Object.defineProperties(el, {
      clientHeight: { value: 400 }, scrollHeight: { get: () => height },
      scrollTop: { get: () => top, set: (value: number) => { top = Math.min(value, height - 400); } },
    });
    act(() => viewport.scrollToBottom(false));
    act(() => { top = initialTop; el.dispatchEvent(new Event('scroll')); });
    const focus = vi.spyOn(HTMLElement.prototype, 'focus');
    const trigger = container.querySelector<HTMLButtonElement>('[aria-haspopup="dialog"]')!;
    await act(async () => trigger.click());
    expect(top).toBe(initialTop);
    expect(focus).toHaveBeenCalledWith({ preventScroll: true });
    const list = document.querySelector<HTMLDivElement>('[data-task-delivery-list]')!;
    act(() => { list.scrollTop = 180; list.dispatchEvent(new Event('scroll', { bubbles: true })); });
    const fourthTask = document.querySelectorAll<HTMLButtonElement>('[role="dialog"] [data-product-delivery="task"] button')[3];
    await act(async () => fourthTask.click());
    expect(container.querySelector('[data-location]')?.textContent).toBe('/chat/session-1?task=task-3');
    expect(document.querySelector('[data-task-delivery-list]')).toBeNull();
    expect(top).toBe(initialTop);
    await act(async () => {
      document.querySelector<HTMLButtonElement>('[data-back]')!.click();
      await new Promise(resolve => setTimeout(resolve, 0));
    });
    expect(document.querySelector('[data-task-delivery-list]')?.scrollTop).toBe(180);
    await act(async () => document.querySelector<HTMLButtonElement>('[aria-label="Close task list"]')!.click());
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(trigger);
    expect(focus).toHaveBeenLastCalledWith({ preventScroll: true });
    expect(top).toBe(initialTop);
    height = 1200;
    act(() => observers.get(el.firstElementChild!)?.());
    expect(top).toBe(initialTop === 600 ? 800 : initialTop);
  });

  it('counts only visible deduplicated tasks and leaves other deliveries intact', async () => {
    const entries = deliveries(5);
    entries.push({ ...entries[0], key: 'duplicate' });
    entries.push({ key: 'note', delivery: { version: 2, operation: 'created', primary: {
      kind: 'note', id: 'note-1', title: 'A note', capabilities: ['open'],
    } } });
    await render(entries, new Set(['task:task-4']));
    expect(container.textContent).toContain('Related tasks · 4');
    expect(container.querySelectorAll('[data-product-delivery="note"]')).toHaveLength(1);
    await render(entries, new Set(['task:task-4', 'task:task-3']));
    expect(container.querySelector('[data-product-task-group]')).toBeNull();
    expect(container.querySelectorAll('[data-product-delivery="task"]')).toHaveLength(3);
  });

  it('keeps the inline preview bounded as streamed deliveries grow and localizes the summary', async () => {
    await render(deliveries(3), undefined, 'zh');
    await render(deliveries(4), undefined, 'zh');
    expect(container.textContent).toContain('关联任务 · 4 项');
    await render(deliveries(20), undefined, 'zh');
    expect(container.textContent).toContain('查看全部 20 项任务');
    expect([...container.querySelectorAll('[data-product-delivery="task"] [title]')]
      .filter(element => element.classList.contains('text-fg')).map(element => element.textContent))
      .toEqual(['Task 0', 'Task 1', 'Task 2']);
  });
});
