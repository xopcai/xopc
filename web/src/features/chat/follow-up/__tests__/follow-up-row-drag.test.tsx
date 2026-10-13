// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

import { ChatPendingFollowUpStack } from '../chat-pending-follow-up-stack';
import type { PendingFollowUp } from '../pending-follow-up.types';

const items: PendingFollowUp[] = ['first', 'second', 'third'].map(id => ({
  id, clientMessageId: `client-${id}`, text: `${id} follow-up`, version: 1, delivery: 'next', status: 'queued',
}));

function pointer(target: EventTarget, type: string, y: number, pointerType = 'mouse') {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: 180, clientY: y, button: 0 });
  Object.defineProperties(event, { pointerId: { value: 1 }, pointerType: { value: pointerType } });
  target.dispatchEvent(event);
}

describe('follow-up row dragging', () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;
  let reorder: Mock<(from: number, to: number) => void>;
  let edit: Mock<(id: string) => void>;
  let steer: Mock<(id: string) => void>;
  const row = (id: string) => container.querySelector<HTMLElement>(`[data-follow-up-id="${id}"]`)!;
  const overlay = () => document.querySelector<HTMLElement>('[data-follow-up-drag-overlay]');
  const render = (rows = items, disabled = false) => {
    act(() => root.render(<ChatPendingFollowUpStack items={rows} disabled={disabled} onReorder={reorder}
      onEditInComposer={edit} onMove={vi.fn()} onRemove={vi.fn()} onSteer={steer} />));
    container.querySelectorAll<HTMLElement>('[data-follow-up-id]').forEach((element, index) => {
      element.getBoundingClientRect = () => ({ x: 100, y: 100 + index * 44, left: 100, top: 100 + index * 44,
        right: 700, bottom: 140 + index * 44, width: 600, height: 40, toJSON: () => ({}) });
    });
  };
  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    vi.useFakeTimers();
    vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1));
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    reorder = vi.fn(); edit = vi.fn(); steer = vi.fn();
    render();
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('lifts the full row from its text, shifts other rows and commits once on drop', () => {
    const text = row('first').querySelector<HTMLButtonElement>('[data-follow-up-drag-surface]')!;
    act(() => pointer(text, 'pointerdown', 120));
    act(() => pointer(window, 'pointermove', 210));
    expect(overlay()?.textContent).toContain('first follow-up');
    expect(overlay()?.style.width).toBe('600px');
    expect(overlay()?.style.position).toBe('fixed');
    expect(overlay()?.getAttribute('aria-hidden')).toBe('true');
    expect(row('second').style.transform).toBe('translateY(-44px)');
    expect(row('first').style.transform).toBe('translateY(88px)');
    expect(reorder).not.toHaveBeenCalled();
    act(() => pointer(window, 'pointerup', 210));
    act(() => text.click());
    expect(reorder).toHaveBeenCalledExactlyOnceWith(0, 2);
    expect(edit).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(180));
    expect(overlay()).toBeNull();
    expect(document.body.style.cursor).toBe('');
  });

  it('reserves the correct space when rows have different heights', () => {
    const positions = [[100, 60], [164, 40], [208, 40]];
    items.forEach((item, index) => {
      const [top, height] = positions[index];
      row(item.id).getBoundingClientRect = () => ({ x: 100, y: top, left: 100, top,
        right: 700, bottom: top + height, width: 600, height, toJSON: () => ({}) });
    });
    act(() => pointer(row('first'), 'pointerdown', 130));
    act(() => pointer(window, 'pointermove', 235));
    expect(row('first').style.transform).toBe('translateY(88px)');
    expect(row('second').style.transform).toBe('translateY(-64px)');
    expect(row('third').style.transform).toBe('translateY(-64px)');
    act(() => pointer(window, 'pointerup', 235));
    expect(reorder).toHaveBeenCalledExactlyOnceWith(0, 2);
  });

  it('keeps short clicks as edits and leaves action buttons clickable', () => {
    const text = row('first').querySelector<HTMLButtonElement>('[data-follow-up-drag-surface]')!;
    act(() => {
      pointer(text, 'pointerdown', 120);
      pointer(window, 'pointermove', 122);
      pointer(window, 'pointerup', 122);
      text.click();
    });
    expect(overlay()).toBeNull();
    expect(edit).toHaveBeenCalledWith('first');
    const steerButton = row('first').querySelector<HTMLButtonElement>('[aria-busy]')!;
    act(() => {
      pointer(steerButton, 'pointerdown', 120);
      pointer(window, 'pointermove', 210);
      pointer(window, 'pointerup', 210);
      steerButton.click();
    });
    expect(steer).toHaveBeenCalledWith('first');
    expect(reorder).not.toHaveBeenCalled();
  });

  it('cancels on Escape and suppresses the release click', () => {
    const text = row('first').querySelector<HTMLButtonElement>('[data-follow-up-drag-surface]')!;
    act(() => pointer(text, 'pointerdown', 120));
    act(() => pointer(window, 'pointermove', 210));
    act(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })));
    act(() => text.click());
    expect(overlay()).toBeNull();
    expect(reorder).not.toHaveBeenCalled();
    expect(edit).not.toHaveBeenCalled();
    expect(row('second').style.transform).toBe('');
  });

  it('maps queued slots to original indices when interrupted messages are present', () => {
    render([items[0], { ...items[1], status: 'interrupted' }, items[2]]);
    act(() => pointer(row('third'), 'pointerdown', 208));
    act(() => pointer(window, 'pointermove', 110));
    act(() => pointer(window, 'pointerup', 110));
    expect(reorder).toHaveBeenCalledExactlyOnceWith(2, 0);
    expect(row('second').style.transform).toBe('');
  });

  it('cancels safely if the queue changes or becomes disabled during drag', () => {
    act(() => pointer(row('first'), 'pointerdown', 120));
    act(() => pointer(window, 'pointermove', 210));
    render(items.slice(1));
    expect(overlay()).toBeNull();
    act(() => pointer(window, 'pointerup', 210));
    expect(reorder).not.toHaveBeenCalled();
    render(items, true);
    act(() => pointer(row('first'), 'pointerdown', 120));
    act(() => pointer(window, 'pointermove', 210));
    expect(overlay()).toBeNull();
  });

  it('scrolls the clipped queue when dragging near its edge', () => {
    container.style.overflowY = 'auto';
    container.getBoundingClientRect = () => ({ x: 100, y: 100, left: 100, top: 100,
      right: 700, bottom: 260, width: 600, height: 160, toJSON: () => ({}) });
    act(() => pointer(row('first'), 'pointerdown', 120));
    act(() => pointer(window, 'pointermove', 255));
    const frame = vi.mocked(requestAnimationFrame).mock.calls[0][0];
    act(() => frame(16));
    expect(container.scrollTop).toBeGreaterThan(0);
    act(() => pointer(window, 'pointerup', 255));
    expect(reorder).toHaveBeenCalledExactlyOnceWith(0, 2);
  });

  it('preserves touch scrolling on the message and enables touch dragging from the handle', () => {
    act(() => pointer(row('first').querySelector('[data-follow-up-drag-surface]')!, 'pointerdown', 120, 'touch'));
    act(() => pointer(window, 'pointermove', 210, 'touch'));
    expect(overlay()).toBeNull();
    act(() => pointer(row('first').querySelector('[data-follow-up-drag-handle]')!, 'pointerdown', 120, 'touch'));
    act(() => pointer(window, 'pointermove', 210, 'touch'));
    expect(overlay()).not.toBeNull();
    act(() => pointer(window, 'pointercancel', 210, 'touch'));
    expect(reorder).not.toHaveBeenCalled();
  });
});
