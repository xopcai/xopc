import { describe, expect, it } from 'vitest';

import {
  isMarketplaceCatchAllCategory,
  sortMarketplaceCategories,
} from '../marketplace/marketplace-category-order.js';

const byLabel = (a: { label: string }, b: { label: string }) =>
  a.label.localeCompare(b.label, 'zh-Hans-CN', { sensitivity: 'base' });

describe('isMarketplaceCatchAllCategory', () => {
  it('matches Chinese and English catch-all labels and ids', () => {
    expect(isMarketplaceCatchAllCategory({ id: '其他', label: '其他' })).toBe(true);
    expect(isMarketplaceCatchAllCategory({ id: 'other', label: 'Other' })).toBe(true);
    expect(isMarketplaceCatchAllCategory({ id: 'misc', label: 'Misc' })).toBe(true);
    expect(isMarketplaceCatchAllCategory({ id: 'ai', label: 'AI增强' })).toBe(false);
  });
});

describe('sortMarketplaceCategories', () => {
  it('pins 其他 after locale sort', () => {
    const input = [
      { id: '办公协同', label: '办公协同' },
      { id: '其他', label: '其他' },
      { id: 'AI增强', label: 'AI增强' },
    ];
    const sorted = sortMarketplaceCategories(input, byLabel);
    expect(sorted.at(-1)?.label).toBe('其他');
    expect(sorted.every((c, i) => i === sorted.length - 1 || !isMarketplaceCatchAllCategory(c))).toBe(true);
  });
});
