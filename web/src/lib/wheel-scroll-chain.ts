function isVerticalScrollContainer(element: HTMLElement): boolean {
  if (element.scrollHeight <= element.clientHeight) return false;
  const overflowY = window.getComputedStyle(element).overflowY;
  return overflowY === 'auto' || overflowY === 'scroll';
}

function collectVerticalScrollChain(
  target: EventTarget | null,
  scrollRegion: HTMLElement,
  outerScrollRegion: HTMLElement,
): HTMLElement[] {
  const chain: HTMLElement[] = [];
  let element: Element | null = target instanceof Element ? target : scrollRegion;

  while (element && element !== scrollRegion) {
    if (element instanceof HTMLElement && isVerticalScrollContainer(element)) chain.push(element);
    element = element.parentElement;
  }

  if (scrollRegion.scrollHeight > scrollRegion.clientHeight) chain.push(scrollRegion);
  if (outerScrollRegion !== scrollRegion) chain.push(outerScrollRegion);
  return chain;
}

function distributeVerticalScroll(deltaY: number, chain: HTMLElement[]) {
  let remainingDelta = deltaY;

  for (const element of chain) {
    const maxScrollTop = Math.max(0, element.scrollHeight - element.clientHeight);
    const nextScrollTop = Math.min(maxScrollTop, Math.max(0, element.scrollTop + remainingDelta));
    const consumedDelta = nextScrollTop - element.scrollTop;

    if (consumedDelta !== 0) element.scrollTop = nextScrollTop;
    remainingDelta -= consumedDelta;
    if (Math.abs(remainingDelta) < 0.01) break;
  }
}

export function routeWheelThroughVerticalScrollChain(
  event: WheelEvent,
  scrollRegion: HTMLElement,
  outerScrollRegion: HTMLElement | null,
  { handoffOnly = false } = {},
) {
  if (
    !outerScrollRegion
    || !event.cancelable
    || event.defaultPrevented
    || event.ctrlKey
    || event.shiftKey
    || event.deltaY === 0
    || Math.abs(event.deltaY) <= Math.abs(event.deltaX)
  ) {
    return;
  }

  const pageHeight = scrollRegion.clientHeight || outerScrollRegion.clientHeight;
  const deltaMultiplier = event.deltaMode === WheelEvent.DOM_DELTA_LINE
    ? 16
    : event.deltaMode === WheelEvent.DOM_DELTA_PAGE
      ? pageHeight
      : 1;
  const chain = collectVerticalScrollChain(event.target, scrollRegion, outerScrollRegion);
  const delta = event.deltaY * deltaMultiplier;
  if (handoffOnly) {
    const inner = chain[0];
    if (!inner || inner === outerScrollRegion) return;
    const available = delta > 0 ? inner.scrollHeight - inner.clientHeight - inner.scrollTop : inner.scrollTop;
    // Let the browser animate ordinary scrolling and only split a delta at an inner boundary.
    if (Math.abs(delta) <= available) return;
  }

  event.preventDefault();
  distributeVerticalScroll(delta, chain);
}
