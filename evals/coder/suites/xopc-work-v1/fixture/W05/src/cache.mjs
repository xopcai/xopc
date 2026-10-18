export class Cache { constructor(){this.values=new Map()} get(k,load){if(!this.values.has(k))this.values.set(k,load());return this.values.get(k)} invalidate(k){this.values.delete(k)} }
