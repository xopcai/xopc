export async function mapLimit(items, limit, mapper) {
  if (!Number.isInteger(limit) || limit < 1) throw new RangeError('invalid limit');
  const result = new Array(items.length); let next = 0, failed = false;
  async function worker() {
    while (!failed && next < items.length) {
      const index = next++;
      try { result[index] = await mapper(items[index], index); }
      catch (error) { failed = true; throw error; }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return result;
}
