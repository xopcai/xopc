export function paginate(items, after, limit) {
  return items.sort((a, b) => a.id.localeCompare(b.id)).filter(x => !after || x.id > after).slice(0, limit);
}
