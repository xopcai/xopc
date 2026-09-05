// @vitest-environment jsdom

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';

import { ScrollToBottomButton } from '@/features/chat/scroll/scroll-to-bottom-button';

describe('ScrollToBottomButton', () => {
  it('flows inside the navigation group and retains contained side-chat positioning', async () => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
      .IS_REACT_ACT_ENVIRONMENT = true;
    const container = document.createElement('div');
    const root = createRoot(container);
    const onClick = vi.fn();
    try {
      await act(async () => root.render(<ScrollToBottomButton visible onClick={onClick} />));
      const button = container.querySelector('button')!;
      expect(button.classList.contains('fixed')).toBe(false);
      expect(button.classList.contains('absolute')).toBe(false);
      expect(button.getAttribute('aria-label')).toBeTruthy();
      await act(async () => button.click());
      expect(onClick).toHaveBeenCalledOnce();

      await act(async () => root.render(<ScrollToBottomButton visible contained onClick={onClick} />));
      expect(container.querySelector('button')!.classList.contains('absolute')).toBe(true);

      await act(async () => root.render(<ScrollToBottomButton visible={false} onClick={onClick} />));
      expect(container.childElementCount).toBe(0);
    } finally {
      await act(async () => root.unmount());
    }
  });
});
