const writes = new WeakMap<object, Promise<unknown>>();

/** Keep HTTP read/merge/write sequences together, across configuration endpoints. */
export async function withGatewayConfigWriteLock<T>(service: object, operation: () => Promise<T>): Promise<T> {
  const previous = writes.get(service) ?? Promise.resolve();
  const next = previous.catch(() => {}).then(operation);
  writes.set(service, next);
  try { return await next; }
  finally { if (writes.get(service) === next) writes.delete(service); }
}
