export class Store { constructor(rows){this.rows=new Map(rows.map(r=>[r.sku,{...r}]))} get(sku){return this.rows.get(sku)} save(sku,available){this.rows.set(sku,{...this.get(sku),available})} }
