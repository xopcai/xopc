export class Cache {
  constructor(now = Date.now) { this.now = now; this.items = new Map(); }
  set(key, value, ttl) { this.items.set(key, { value, expires: this.now() + ttl }); }
  get(key) { return this.items.get(key)?.value; }
}
