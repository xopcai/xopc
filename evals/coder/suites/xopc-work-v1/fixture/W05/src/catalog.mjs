export class Catalog { constructor(store,cache){this.store=store;this.cache=cache} get(sku){return this.cache.get(sku,()=>({...this.store.get(sku)}))} }
