const pending = new Map<string, Promise<void>>();

/** Serialize release mutations sharing an extension directory, including across service instances. */
export async function withLocalAppReleaseLock<T>(root: string, action: () => Promise<T>): Promise<T> {
  const previous = pending.get(root) ?? Promise.resolve();
  let release!: () => void;
  const next = new Promise<void>((resolve) => { release = resolve; });
  pending.set(root, next);
  await previous;
  try {
    return await action();
  } finally {
    release();
    if (pending.get(root) === next) pending.delete(root);
  }
}
