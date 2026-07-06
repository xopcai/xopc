type GatewayEventListener = (detail: unknown) => void;

const listeners = new Map<string, Set<GatewayEventListener>>();

export function subscribeGatewayEvent(eventName: string, listener: GatewayEventListener): () => void {
  const hyphen = eventName.replace(/\./g, '-');
  let set = listeners.get(hyphen);
  if (!set) {
    set = new Set();
    listeners.set(hyphen, set);
  }
  set.add(listener);
  return () => {
    set?.delete(listener);
    if (set?.size === 0) listeners.delete(hyphen);
  };
}

export function emitGatewayEvent(eventName: string, detail: unknown): void {
  const hyphen = eventName.replace(/\./g, '-');
  const set = listeners.get(hyphen);
  if (!set) return;
  for (const fn of set) {
    try {
      fn(detail);
    } catch {
      /* ignore listener errors */
    }
  }
}
