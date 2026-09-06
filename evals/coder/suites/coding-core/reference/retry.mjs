export async function retry(operation, { attempts = 3, signal } = {}) {
  if (!Number.isInteger(attempts) || attempts < 1) throw new RangeError('invalid attempts');
  for (let attempt = 0; attempt < attempts; attempt++) {
    signal?.throwIfAborted();
    try { return await operation(attempt); } catch (error) {
      signal?.throwIfAborted();
      if (attempt === attempts - 1) throw error;
    }
  }
}
