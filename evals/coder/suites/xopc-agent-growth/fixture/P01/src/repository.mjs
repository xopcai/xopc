export function createRepository(seed) {
  const stock = new Map(Object.entries(seed));
  return { get(sku) { if (!stock.has(sku)) throw new Error('Unknown SKU'); return stock.get(sku); },
    set(sku, quantity) { stock.set(sku, quantity); } };
}
