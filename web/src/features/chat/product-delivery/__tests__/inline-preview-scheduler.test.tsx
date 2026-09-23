// @vitest-environment jsdom

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  InlinePreviewSchedulerProvider,
  useInlinePreviewLease,
} from '@/features/chat/product-delivery/inline-preview-scheduler';

let notifyIntersection: ((entries: IntersectionObserverEntry[]) => void) | undefined;

class TestIntersectionObserver {
  readonly root = null;
  readonly rootMargin = '480px 0px';
  readonly thresholds = [0];

  constructor(callback: IntersectionObserverCallback) {
    notifyIntersection = (entries) => callback(entries, this as unknown as IntersectionObserver);
  }

  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();
  takeRecords = () => [];
}

function PreviewProbe({ id }: { id: string }) {
  const lease = useInlinePreviewLease(id);
  return (
    <div ref={lease.containerRef} data-preview-id={id} data-state={lease.state}>
      <button onClick={lease.activate}>activate</button>
    </div>
  );
}

function entry(element: Element, isIntersecting: boolean, top: number): IntersectionObserverEntry {
  const rect = { top, bottom: top + 100, left: 0, right: 100, width: 100, height: 100, x: 0, y: top, toJSON: () => ({}) };
  return {
    target: element,
    isIntersecting,
    intersectionRatio: isIntersecting ? 1 : 0,
    boundingClientRect: rect,
    intersectionRect: rect,
    rootBounds: null,
    time: 0,
  };
}

describe('InlinePreviewSchedulerProvider', () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    vi.stubGlobal('IntersectionObserver', TestIntersectionObserver);
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
    notifyIntersection = undefined;
  });

  it('never grants more than two iframe leases and releases offscreen candidates', async () => {
    await act(async () => {
      root.render(
        <InlinePreviewSchedulerProvider>
          <PreviewProbe id="one" />
          <PreviewProbe id="two" />
          <PreviewProbe id="three" />
        </InlinePreviewSchedulerProvider>,
      );
      await Promise.resolve();
    });
    const elements = [...container.querySelectorAll('[data-preview-id]')];

    act(() => notifyIntersection?.(elements.map((element, index) => entry(element, true, index * 100))));
    expect(container.querySelectorAll('[data-state="active"]')).toHaveLength(2);

    act(() => elements[2].querySelector<HTMLButtonElement>('button')?.click());
    expect(container.querySelectorAll('[data-state="active"]')).toHaveLength(2);
    expect(elements[2]?.getAttribute('data-state')).toBe('active');

    act(() => notifyIntersection?.([
      entry(elements[0], false, -1000),
      entry(elements[1], false, -1000),
      entry(elements[2], true, 100),
    ]));
    expect(container.querySelectorAll('[data-state="active"]')).toHaveLength(1);
    expect(container.querySelector('[data-preview-id="three"]')?.getAttribute('data-state')).toBe('active');
  });

  it('lets a user-requested preview claim an available lease', async () => {
    await act(async () => {
      root.render(
        <InlinePreviewSchedulerProvider>
          <PreviewProbe id="manual" />
        </InlinePreviewSchedulerProvider>,
      );
      await Promise.resolve();
    });

    expect(container.querySelector('[data-preview-id="manual"]')?.getAttribute('data-state')).toBe('dormant');
    act(() => (container.querySelector('button') as HTMLButtonElement).click());
    expect(container.querySelector('[data-preview-id="manual"]')?.getAttribute('data-state')).toBe('active');
  });
});
