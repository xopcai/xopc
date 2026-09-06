export function paginate(items, after, limit) {
  if (!Number.isInteger(limit) || limit < 0) throw new RangeError('invalid limit');
  return [...items].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
    .filter(item => after == null || item.id > after).slice(0, limit);
}
