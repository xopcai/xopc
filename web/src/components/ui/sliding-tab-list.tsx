import { useRef, type ComponentPropsWithoutRef, type Ref, type KeyboardEvent } from 'react';

import { SlidingIndicator, useSlidingIndicator } from '@/components/ui/sliding-indicator';
import { cn } from '@/lib/cn';

const itemSelector = '[data-sliding-active], [role="tab"], button[aria-pressed], a[href]';
const selectedSelector = '[data-sliding-active="true"], [role="tab"][aria-selected="true"], button[aria-pressed="true"], a[aria-current="page"]';

/** Composable sliding tabs for custom labels, route links and tabs with sibling close buttons. */
export function SlidingTabList({
  as: Tag = 'div',
  children,
  className,
  indicatorClassName = 'rounded-lg bg-surface-active',
  ref,
  onKeyDown,
  ...props
}: ComponentPropsWithoutRef<'div'> & { as?: 'div' | 'nav'; ref?: Ref<HTMLElement>; indicatorClassName?: string }) {
  const trackRef = useRef<HTMLElement>(null);
  const bounds = useSlidingIndicator(trackRef, itemSelector, selectedSelector);
  const navigate = (event: KeyboardEvent<HTMLDivElement>) => {
    onKeyDown?.(event);
    if (event.defaultPrevented || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    const items = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement | HTMLAnchorElement>(
      '[role="tab"], button[aria-pressed], a[href]',
    )).filter(item => !('disabled' in item && item.disabled) && item.getAttribute('aria-disabled') !== 'true');
    const index = items.findIndex(item => item.contains(event.target as Node));
    if (index < 0 || !items.length) return;
    event.preventDefault();
    const nextIndex = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1
      : (index + (event.key === 'ArrowRight' ? 1 : -1) + items.length) % items.length;
    const next = items[nextIndex];
    next.focus();
    next.click();
    next.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  };
  return (
    <Tag
      {...props}
      onKeyDown={navigate}
      ref={node => {
        trackRef.current = node;
        if (typeof ref === 'function') return ref(node);
        if (ref) ref.current = node;
      }}
      data-sliding-ready={bounds ? 'true' : undefined}
      className={cn('sliding-tab-list relative isolate', className)}
    >
      <SlidingIndicator bounds={bounds} className={indicatorClassName} />
      {children}
    </Tag>
  );
}
