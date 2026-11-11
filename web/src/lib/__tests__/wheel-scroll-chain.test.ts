// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';

import { routeWheelThroughVerticalScrollChain } from '../wheel-scroll-chain';

function scrollRegion(height: number, scrollHeight: number, scrollTop: number) {
  const element = document.createElement('div');
  element.style.overflowY = 'auto';
  Object.defineProperties(element, {
    clientHeight: { value: height },
    scrollHeight: { value: scrollHeight },
  });
  element.scrollTop = scrollTop;
  return element;
}

describe('workbench wheel handoff', () => {
  it.each([
    { start: 75, delta: 60, innerEnd: 100, outerEnd: 85 },
    { start: 25, delta: -60, innerEnd: 0, outerEnd: 15 },
  ])('passes only the remaining delta to the page ($delta)', ({ start, delta, innerEnd, outerEnd }) => {
    const outer = scrollRegion(250, 600, 50);
    const inner = scrollRegion(100, 200, start);
    outer.append(inner);
    inner.addEventListener('wheel', (event) => routeWheelThroughVerticalScrollChain(event, inner, outer, { handoffOnly: true }));
    const event = new WheelEvent('wheel', { deltaY: delta, cancelable: true });
    inner.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    expect(inner.scrollTop).toBe(innerEnd);
    expect(outer.scrollTop).toBe(outerEnd);
  });

  it('leaves ordinary scrolling inside the card to the browser', () => {
    const outer = scrollRegion(250, 600, 50);
    const inner = scrollRegion(100, 200, 40);
    outer.append(inner);
    const event = new WheelEvent('wheel', { deltaY: 30, cancelable: true });

    routeWheelThroughVerticalScrollChain(event, inner, outer, { handoffOnly: true });

    expect(event.defaultPrevented).toBe(false);
    expect(inner.scrollTop).toBe(40);
    expect(outer.scrollTop).toBe(50);
  });
});
