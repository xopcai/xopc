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

  it('renders resource tables as escaped text with internal links only', () => {
    act(() => root.render(<MemoryRouter><ProductDeliveryCard delivery={{ version: 1, operation: 'opened', presentation: {
      kind: 'table', truncated: true, items: [{ kind: 'task', id: 'task/one', title: '<img src=x>', status: 'ready', capabilities: ['open', 'run'] }],
    } }} /></MemoryRouter>));
    expect(container.querySelector('table')).not.toBeNull();
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('a')?.getAttribute('href')).toBe('/tasks/task%2Fone');
    expect(container.querySelector('[role="status"]')).not.toBeNull();
    expect(container.querySelector('button')).toBeNull();
  });

  it('renders proposed replacements without applying them or rendering HTML', () => {
    act(() => root.render(<MemoryRouter><ProductDeliveryCard delivery={{ version: 1, operation: 'opened', presentation: {
      kind: 'diff', title: 'Preview', truncated: false, edits: [{ from: 0, to: 5, text: '<script>unsafe()</script>' }],
    } }} /></MemoryRouter>));
    expect(container.textContent).toContain('尚未应用');
    expect(container.querySelector('script')).toBeNull();
    act(() => container.querySelector('summary')!.click());
    expect(container.querySelector('details')?.open).toBe(true);
    expect(container.querySelector('pre')?.textContent).toBe('<script>unsafe()</script>');
    expect(container.querySelector('button')).toBeNull();
  });

  it('uses the borderless Note result row itself as the only action', () => {
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

    expect(container.textContent).toContain('财经新闻整理');
    expect(container.textContent).not.toContain('打开笔记');
    expect(container.textContent).not.toContain('在对话中继续');
    expect(container.querySelectorAll('button')).toHaveLength(1);
    expect(container.querySelector('section')?.classList.contains('border')).toBe(false);

    act(() => container.querySelector('button')?.click());
    expect(container.querySelector('[data-testid="location"]')?.textContent).toBe(
      '/notes/note-1?returnTo=%2Fchat%2Fsession-1',
    );
  });

  it('presents an automation as a localized result row with a secondary continue action', () => {
    const delivery: ProductDeliveryEnvelope = {
      version: 1,
      operation: 'opened',
      primary: {
        kind: 'automation',
        id: 'automation-1',
        title: 'Memory daily reconciliation',
        status: 'enabled',
        summary: 'Run deterministic daily_reconciliation without model inference.',
        capabilities: ['open', 'continue_in_chat'],
      },
    };

    act(() => {
      root.render(
        <MemoryRouter initialEntries={['/chat/session-1']}>
          <ProductDeliveryCard delivery={delivery} />
        </MemoryRouter>,
      );
    });

    expect(container.textContent).toContain('Memory daily reconciliation');
    expect(container.textContent).toContain('交付物 · 自动化');
    expect(container.textContent).toContain('自动化');
    expect(container.textContent).toContain('已启用');
    expect(container.textContent).toContain('继续');
    expect(container.textContent).not.toContain('继续在对话中处理');
    expect(container.textContent).not.toContain('已就绪');
    expect(container.textContent).not.toContain('enabled');
    expect(container.querySelectorAll('button')).toHaveLength(2);
    const sectionClasses = container.querySelector('section')?.className ?? '';
    expect(sectionClasses).not.toContain('border');
    expect(sectionClasses).not.toContain('before:');
  });

  it('keeps a visible boundary for failed deliveries', () => {
    const delivery: ProductDeliveryEnvelope = {
      version: 1,
      operation: 'failed',
      primary: {
        kind: 'automation',
        id: 'automation-1',
        title: 'Memory daily reconciliation',
        status: 'failed',
        capabilities: [],
      },
    };

    act(() => {
      root.render(
        <MemoryRouter>
          <ProductDeliveryCard delivery={delivery} />
        </MemoryRouter>,
      );
    });

    expect(container.textContent).toContain('失败');
    expect(container.querySelector('section')?.classList.contains('border')).toBe(true);
  });
});
