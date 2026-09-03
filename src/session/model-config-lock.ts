const pending = new Map<string, Promise<unknown>>();

/** Serialize configuration changes with input acceptance for one conversation. */
export async function withModelConfigLock<T>(sessionKey: string, operation: () => Promise<T>): Promise<T> {
  const previous = pending.get(sessionKey) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(operation);
  pending.set(sessionKey, next);
  try {
    return await next;
  } finally {
    if (pending.get(sessionKey) === next) pending.delete(sessionKey);
  }
}
