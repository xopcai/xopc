export function createReservations(repository, catalog) {
  return { reserve(sku, quantity) {
    if (!Number.isInteger(quantity) || quantity <= 0) throw new RangeError('Invalid quantity');
    const available = catalog.available(sku);
    if (available < quantity) throw new Error('Insufficient stock');
    repository.set(sku, available - quantity);
    return {sku, reserved: quantity, remaining: available - quantity};
  } };
}
