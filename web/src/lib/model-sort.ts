const modelNameCollator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });

/** Descending natural order: newer numbered versions and dated variants appear first. */
export function compareModelNamesDescending(left: string, right: string): number {
  return modelNameCollator.compare(right, left);
}

export function compareModelsDescending(left: { id: string; name: string }, right: { id: string; name: string }): number {
  return compareModelNamesDescending(left.name, right.name) || compareModelNamesDescending(left.id, right.id);
}
