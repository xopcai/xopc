// @vitest-environment jsdom

import { act, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useDismissOnOutsideClick } from '@/features/chat/composer/use-dismiss-on-outside-click';

function Harness({ onDismiss }: { onDismiss: () => void }) {
  const anchorRef = useRef<HTMLDivElement | null>(null);
  useDismissOnOutsideClick({
    active: true,
    anchors: [anchorRef],
    ignoreSelector: '[data-picker-panel]',
    onDismiss,
  });
  return (
    <>
      <div ref={anchorRef} data-testid="anchor" />
      <div data-picker-panel data-testid="panel" />
      <div data-testid="outside" />
    </>
  );
}

describe('useDismissOnOutsideClick', () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
      .IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it('dismisses outside both the editor anchor and a portaled picker panel', () => {
    const onDismiss = vi.fn();
    act(() => root.render(<Harness onDismiss={onDismiss} />));

    act(() => {
      container.querySelector('[data-testid="anchor"]')
        ?.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
      container.querySelector('[data-testid="panel"]')
        ?.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    });
    expect(onDismiss).not.toHaveBeenCalled();

    act(() => {
      container.querySelector('[data-testid="outside"]')
        ?.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    });
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('observes the outside click before a document capture handler stops propagation', () => {
    const onDismiss = vi.fn();
    const stopAtDocument = (event: Event) => event.stopPropagation();
    document.addEventListener('pointerdown', stopAtDocument, true);
    act(() => root.render(<Harness onDismiss={onDismiss} />));

    try {
      act(() => {
        container.querySelector('[data-testid="outside"]')
          ?.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
      });
      expect(onDismiss).toHaveBeenCalledTimes(1);
    } finally {
      document.removeEventListener('pointerdown', stopAtDocument, true);
    }
  });
});
