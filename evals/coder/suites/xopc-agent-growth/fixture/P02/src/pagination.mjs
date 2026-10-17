export function page(items, {after, limit = 20} = {}) {
  if (!Number.isInteger(limit) || limit < 0) throw new RangeError('Invalid limit');
  return items.filter(item => after === undefined || item.id > after).slice(0, limit);
}
