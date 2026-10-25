// @vitest-environment jsdom
import { PERSONAL_WORKER_RESULT_GUIDANCE } from '@xopcai/gateway-contract';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ChatPendingFollowUpStack } from '../chat-pending-follow-up-stack';
import type { PendingFollowUp } from '../pending-follow-up.types';
import { messages } from '@/i18n/messages';
import { useLocaleStore } from '@/stores/locale-store';

const chat = messages('en').chat;
const item: PendingFollowUp = { id: 'first', clientMessageId: 'client-first', text: 'Review the change', version: 1, delivery: 'next', status: 'queued' };

describe('follow-up actions', () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;
  const callbacks = () => ({ onEditInComposer: vi.fn(), onRemove: vi.fn(), onMove: vi.fn(), onReorder: vi.fn(), onSteer: vi.fn(), onOpenSideChat: vi.fn() });
  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    useLocaleStore.setState({ language: 'en' });
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });
  afterEach(() => { act(() => root.unmount()); container.remove(); });
  const openMenu = async () => {
    await act(async () => {
      container.querySelector<HTMLButtonElement>(`[aria-label="${chat.followUpQueueMore}"]`)!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    });
  };
  const menuItem = (label: string) => Array.from(document.querySelectorAll<HTMLElement>('[role="menuitem"]')).find(el => el.textContent === label)!;

  it('opens side chat with the selected message through a keyboard-accessible menu', async () => {
    const handlers = callbacks();
    act(() => root.render(<ChatPendingFollowUpStack items={[item]} {...handlers} />));
    await openMenu();
    expect(menuItem(chat.followUpQueueClickToEdit)).toBeTruthy();
    act(() => menuItem(chat.followUpQueueOpenSideChat).click());
    expect(handlers.onOpenSideChat).toHaveBeenCalledWith(item, item.text);
    expect(handlers.onRemove).not.toHaveBeenCalled();
  });

  it('keeps focus in the composer after choosing edit', async () => {
    const editor = document.createElement('textarea');
    container.append(editor);
    const handlers = callbacks();
    handlers.onEditInComposer.mockImplementation(() => editor.focus());
    const host = document.createElement('div');
    document.body.append(host);
    editor.remove();
    host.append(editor);
    try {
      act(() => root.render(<ChatPendingFollowUpStack items={[item]} {...handlers} />));
      await openMenu();
      await act(async () => {
        menuItem(chat.followUpQueueClickToEdit).click();
        await new Promise(resolve => setTimeout(resolve, 10));
      });
      expect(handlers.onEditInComposer).toHaveBeenCalledWith(item.id);
      expect(document.activeElement).toBe(editor);
    } finally {
      host.remove();
    }
  });

  it('keeps attachment messages out of steering and side chat', async () => {
    const handlers = callbacks();
    act(() => root.render(<ChatPendingFollowUpStack items={[{ ...item, attachments: [{ type: 'file', name: 'report.pdf' }] }]} {...handlers} />));
    expect(container.querySelector<HTMLButtonElement>(`[aria-label="${chat.followUpQueueSteerNow}"]`)!.disabled).toBe(true);
    await openMenu();
    expect(menuItem(chat.followUpQueueOpenSideChat).hasAttribute('data-disabled')).toBe(true);
    expect(menuItem(chat.followUpQueueClickToEdit).hasAttribute('data-disabled')).toBe(false);
  });

  it('blocks row actions while steering is being submitted', () => {
    act(() => root.render(<ChatPendingFollowUpStack items={[item]} {...callbacks()} steeringBusyId={item.id} />));
    expect(Array.from(container.querySelectorAll<HTMLButtonElement>('button')).every(button => button.disabled)).toBe(true);
  });
  it('projects host instructions out of a retry preview without changing queued data', () => {
    const queued = { ...item, status: 'interrupted' as const, text: `<task_brief>\nReview the change\n\n${PERSONAL_WORKER_RESULT_GUIDANCE}\n</task_brief>` };
    act(() => root.render(<ChatPendingFollowUpStack items={[queued]} {...callbacks()} />));
    expect(container.textContent).toContain('Review the change');
    expect(container.textContent).not.toMatch(/task_brief|publish_task_result|Result for the originating/);
    expect(queued.text).toContain(PERSONAL_WORKER_RESULT_GUIDANCE);
  });

});
