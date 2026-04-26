export interface FeishuDedupe {
  claim(id: string): boolean;
}

export function createFeishuDedupe(options?: { max?: number; ttlMs?: number }): FeishuDedupe {
  const max = options?.max ?? 10_000;
  const ttlMs = options?.ttlMs ?? 10 * 60_000;
  const seen = new Map<string, number>();

  function prune(now: number) {
    for (const [k, t] of seen) {
      if (now - t > ttlMs) {
        seen.delete(k);
      }
    }
    if (seen.size <= max) return;
    const extra = seen.size - max;
    let i = 0;
    for (const k of seen.keys()) {
      seen.delete(k);
      i++;
      if (i >= extra) break;
    }
  }

  return {
    claim(id: string): boolean {
      const key = id.trim();
      if (!key) return false;
      const now = Date.now();
      prune(now);
      if (seen.has(key)) return false;
      seen.set(key, now);
      return true;
    },
  };
}

