export class Cache {
  constructor(now = Date.now) { this.now = now; this.items = new Map(); }
  set(key, value, ttl) {
    if (!Number.isFinite(ttl) || ttl < 0) throw new RangeError('invalid ttl');
    this.items.set(key, { value, expires: this.now() + ttl });
  }
  get(key) {
    const entry = this.items.get(key);
    if (!entry) return undefined;
    if (this.now() >= entry.expires) { this.items.delete(key); return undefined; }
    return entry.value;
  }
}
