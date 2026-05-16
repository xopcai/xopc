import type { MarketplaceCategoryOption } from './adapters/store/store-api-client.js';

const CATCH_ALL_ID = new Set(['other', 'others', 'misc', 'miscellaneous']);

const CATCH_ALL_LABEL = new Set(['其他', 'other', 'others', 'misc', 'miscellaneous']);

function normalizeToken(value: string): string {
  return value.trim().toLowerCase();
}

/** Catch-all marketplace category (e.g. SkillHub curated index "其他") — shown last in filter chips. */
export function isMarketplaceCatchAllCategory(category: Pick<MarketplaceCategoryOption, 'id' | 'label'>): boolean {
  const id = normalizeToken(category.id);
  const label = normalizeToken(category.label);
  return CATCH_ALL_ID.has(id) || CATCH_ALL_LABEL.has(label);
}

/** Stable sort: `compare` first, then pin catch-all categories to the end. */
export function sortMarketplaceCategories<T extends MarketplaceCategoryOption>(
  items: T[],
  compare: (a: T, b: T) => number,
): T[] {
  const regular: T[] = [];
  const catchAll: T[] = [];
  for (const item of items) {
    (isMarketplaceCatchAllCategory(item) ? catchAll : regular).push(item);
  }
  regular.sort(compare);
  catchAll.sort(compare);
  return [...regular, ...catchAll];
}
