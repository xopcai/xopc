// @vitest-environment jsdom

import type { ProductDeliveryEnvelope } from '@xopcai/gateway-contract';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ProductDeliveryCard } from '@/features/chat/product-delivery/product-delivery-card';
import { useLocaleStore } from '@/stores/locale-store';

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="location">{`${location.pathname}${location.search}`}</output>;
}

describe('ProductDeliveryCard', () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
      .IS_REACT_ACT_ENVIRONMENT = true;
    useLocaleStore.setState({ language: 'zh' });
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it('uses the Note card itself as the only action', () => {
    const delivery: ProductDeliveryEnvelope = {
      version: 1,
      operation: 'updated',
      primary: {
        kind: 'note',
        id: 'note-1',
        title: '财经新闻整理',
        capabilities: ['open', 'continue_in_chat'],
      },
    };

    act(() => {
      root.render(
        <MemoryRouter initialEntries={['/chat/session-1']}>
          <Routes>
            <Route
              path="*"
              element={(
                <>
                  <ProductDeliveryCard delivery={delivery} />
                  <LocationProbe />
                </>
              )}
            />
          </Routes>
        </MemoryRouter>,
      );
    });

    expect(container.textContent).toContain('打开笔记');
    expect(container.textContent).not.toContain('在对话中继续');
    expect(container.querySelectorAll('button')).toHaveLength(1);

    act(() => container.querySelector('button')?.click());
    expect(container.querySelector('[data-testid="location"]')?.textContent).toBe(
      '/notes/note-1?returnTo=%2Fchat%2Fsession-1',
    );
  });
});
