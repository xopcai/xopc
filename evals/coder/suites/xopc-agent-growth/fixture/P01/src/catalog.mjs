export function createCatalog(repository) {
  const cache = new Map();
  return { available(sku) { if (!cache.has(sku)) cache.set(sku, repository.get(sku)); return cache.get(sku); },
    invalidate(sku) { cache.delete(sku); } };
}
