import { describe, expect, it } from 'vitest';

import {
  DEFAULT_VISIBLE_NAV_ITEMS,
  MAX_VISIBLE_NAV_ITEMS,
  MIN_VISIBLE_NAV_ITEMS,
  reconcileNavOrder,
  type NavItem,
} from '@/navigation/sidebar-nav-items';

function item(id: string): NavItem {
  return {
    id,
    kind: id.startsWith('extension:') ? 'extension' : 'product',
    label: id,
    to: `/${id}`,
    Icon: undefined,
  };
}

describe('reconcileNavOrder', () => {
  it('preserves the available order when nothing is stored', () => {
    const result = reconcileNavOrder([item('product:work'), item('product:automation')], []);
    expect(result.visible.map((entry) => entry.id)).toEqual(['product:work', 'product:automation']);
    expect(result.hasOverflow).toBe(false);
  });

  it('restores a customized order and drops obsolete saved ids', () => {
    const result = reconcileNavOrder(
      [item('product:work'), item('product:automation'), item('extension:calendar:home')],
      ['builtin:home', 'extension:calendar:home', 'product:automation', 'product:work'],
    );
    expect(result.visible.map((entry) => entry.id)).toEqual([
      'extension:calendar:home',
      'product:automation',
      'product:work',
    ]);
  });

  it('appends newly installed extensions and overflows past the default limit', () => {
    const available = [
      item('product:work'),
      item('product:automation'),
      item('product:capabilities'),
      item('product:apps'),
      item('extension:first:home'),
      item('extension:second:home'),
    ];
    const result = reconcileNavOrder(available, [
      'product:work',
      'product:automation',
      'product:capabilities',
      'product:apps',
    ]);
    expect(result.visible).toHaveLength(DEFAULT_VISIBLE_NAV_ITEMS);
    expect(result.visible.at(-1)?.id).toBe('extension:first:home');
    expect(result.overflow.map((entry) => entry.id)).toEqual(['extension:second:home']);
  });

  it('clamps the adjustable visible count between two and five', () => {
    const available = Array.from({ length: 7 }, (_, index) => item(`extension:${index}:home`));
    expect(reconcileNavOrder(available, [], MIN_VISIBLE_NAV_ITEMS - 10).visible).toHaveLength(MIN_VISIBLE_NAV_ITEMS);
    expect(reconcileNavOrder(available, [], MAX_VISIBLE_NAV_ITEMS + 10).visible).toHaveLength(MAX_VISIBLE_NAV_ITEMS);
  });

  it('deduplicates saved ids', () => {
    const result = reconcileNavOrder(
      [item('product:work'), item('product:apps')],
      ['product:apps', 'product:apps', 'product:work'],
    );
    expect(result.visible.map((entry) => entry.id)).toEqual(['product:apps', 'product:work']);
  });
});
