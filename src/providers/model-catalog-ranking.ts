import type { CatalogModel } from './model-catalog-store.js';

const STABILITY_ORDER: Record<NonNullable<CatalogModel['stability']>, number> = {
  stable: 0,
  preview: 1,
  deprecated: 2,
};

export function compareCatalogModels(
  left: CatalogModel,
  right: CatalogModel,
  recommendedModel?: string,
): number {
  if (left.id === recommendedModel) return -1;
  if (right.id === recommendedModel) return 1;
  const stability = STABILITY_ORDER[left.stability ?? 'stable']
    - STABILITY_ORDER[right.stability ?? 'stable'];
  if (stability !== 0) return stability;
  if (left.bestEffort !== right.bestEffort) return left.bestEffort ? 1 : -1;
  if ((left.priority ?? 0) !== (right.priority ?? 0)) {
    return (right.priority ?? 0) - (left.priority ?? 0);
  }
  return left.id.localeCompare(right.id);
}
