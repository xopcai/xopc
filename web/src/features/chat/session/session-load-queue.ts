/** Preserve pagination/refresh order within a session without blocking other sessions. */
export class SessionLoadQueue {
  private tails = new Map<string, Promise<unknown>>();

  run<T>(key: string, load: () => Promise<T>): Promise<T> {
    const previous = this.tails.get(key);
    const pending = previous ? previous.then(load, load) : Promise.resolve().then(load);
    const tail = pending.finally(() => {
      if (this.tails.get(key) === tail) this.tails.delete(key);
    });
    this.tails.set(key, tail);
    // The caller owns error handling; the scheduling tail must never reject unobserved.
    void tail.catch(() => {});
    return pending;
  }
}
