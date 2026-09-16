const pending = new Map<string, Promise<unknown>>();

/** Serialize configuration changes with input acceptance for one conversation. */
export async function withModelConfigLock<T>(conversationId: string, operation: () => Promise<T>): Promise<T> {
  const previous = pending.get(conversationId) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(operation);
  pending.set(conversationId, next);
  try {
    return await next;
  } finally {
    if (pending.get(conversationId) === next) pending.delete(conversationId);
  }
}
