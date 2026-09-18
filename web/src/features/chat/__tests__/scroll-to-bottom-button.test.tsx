// @vitest-environment jsdom

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';

import { ScrollToBottomDock } from '@/features/chat/scroll/scroll-to-bottom-button';

describe('ScrollToBottomDock', () => {
  it('centers the control on either edge and keeps hidden controls unfocusable', async () => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
      .IS_REACT_ACT_ENVIRONMENT = true;
    const container = document.createElement('div');
    const root = createRoot(container);
    const onClick = vi.fn();
    try {
      await act(async () => root.render(<ScrollToBottomDock visible onClick={onClick} />));
      const dock = container.querySelector('[data-scroll-to-bottom-dock]')!;
      const button = container.querySelector('button')!;
      expect(dock.classList.contains('-top-2')).toBe(true);
      expect(dock.classList.contains('-translate-y-full')).toBe(true);
      expect(dock.classList.contains('opacity-100')).toBe(true);
      expect(button.classList.contains('size-8')).toBe(true);
      expect(dock.querySelectorAll('span')).toHaveLength(0);
      expect(dock.querySelector('[data-scroll-to-bottom-arrow]')).not.toBeNull();
      expect(button.getAttribute('aria-label')).toBeTruthy();
      await act(async () => button.click());
      expect(onClick).toHaveBeenCalledOnce();

      await act(async () => root.render(<ScrollToBottomDock visible running onClick={onClick} />));
      expect(container.querySelectorAll('[data-scroll-to-bottom-running-dot]')).toHaveLength(3);
      expect(container.querySelector('[data-scroll-to-bottom-arrow]')).toBeNull();
      await act(async () => container.querySelector('button')?.click());
      expect(onClick).toHaveBeenCalledTimes(2);

      await act(async () => root.render(<ScrollToBottomDock visible edge="bottom" onClick={onClick} />));
      expect(container.querySelector('[data-scroll-to-bottom-dock]')?.classList.contains('bottom-2')).toBe(true);

      await act(async () => root.render(<ScrollToBottomDock visible={false} onClick={onClick} />));
      expect(container.querySelector('[data-scroll-to-bottom-dock]')?.getAttribute('aria-hidden')).toBe('true');
      expect(container.querySelector('button')?.tabIndex).toBe(-1);
      expect(container.querySelector('[data-scroll-to-bottom-dock]')?.classList.contains('opacity-0')).toBe(true);
    } finally {
      await act(async () => root.unmount());
    }
  });
});
