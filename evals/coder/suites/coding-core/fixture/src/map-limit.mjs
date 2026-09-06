export async function mapLimit(items, limit, mapper) {
  return Promise.all(items.map(mapper));
}
