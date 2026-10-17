// Evaluator-only oracle: calibration evidence, never a model score.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

const [id, workspace] = process.argv.slice(2);
const put = (path, text) => writeFileSync(join(workspace, path), text);
put('report.md', 'Calibration only. This report and the reference implementation are supplied by the evaluator to check its positive and negative controls. They are not evidence of model ability or natural-language quality.');
if (id === 'I01') put('result.json', JSON.stringify({ledgerId:'settlement-oct',netCents:17000,settledCount:2,evidencePaths:['workspace.json','services/settlement/service.json','data/live/october.json','contracts/settlement.md']}));
else if (id === 'I02') put('result.json', JSON.stringify({service:'exporter',timeoutMs:12000,maxAttempts:3,configPath:'releases/2026-10/exporter/config.json',contractPath:'releases/2026-10/exporter/contract.md'}));
else if (id === 'E02') {
  put('src/export.mjs', `import {eligible} from './orders.mjs';
export function exportOrders(orders, {limit = orders.length} = {}) {
  if (!Number.isInteger(limit) || limit < 0) throw new RangeError('Invalid limit');
  const all = eligible(orders);
  return {ids: all.slice(0,limit).map(order=>order.id), totalCents: all.reduce((sum,order)=>sum+order.cents,0)};
}`);
  put('test/regression.test.mjs', `import {test} from 'node:test';import assert from 'node:assert/strict';import {exportOrders} from '../src/export.mjs';
test('total covers all eligible orders',()=>assert.deepEqual(exportOrders([{id:'a',status:'paid',cents:4},{id:'b',status:'paid',cents:7}],{limit:1}),{ids:['a'],totalCents:11}));`);
} else if (id === 'P01') {
  put('src/reservations.mjs', `export function createReservations(repository, catalog) {
  return { reserve(sku, quantity) {
    if (!Number.isInteger(quantity) || quantity <= 0) throw new RangeError('Invalid quantity');
    const available = catalog.available(sku);
    if (available < quantity) throw new Error('Insufficient stock');
    repository.set(sku, available - quantity);
    catalog.invalidate(sku);
    return {sku, reserved: quantity, remaining: available - quantity};
  } };
}`);
  put('test/regression.test.mjs', `import {test} from 'node:test';import assert from 'node:assert/strict';import {createInventory} from '../src/index.mjs';
test('cached availability reflects reservations',()=>{const app=createInventory({a:5});app.available('a');app.reserve('a',2);assert.equal(app.available('a'),3);assert.throws(()=>app.reserve('a',4));});`);
} else if (id === 'P02') {
  put('src/query.mjs', `export function selectTickets(tickets, {status, labels} = {}) {
  if (labels !== undefined && (!Array.isArray(labels) || !labels.every(label=>typeof label==='string'))) throw new TypeError('Invalid labels');
  return tickets.filter(ticket=>(status===undefined || ticket.status===status) && (labels===undefined || labels.every(label=>(ticket.labels??[]).includes(label))));
}`);
  put('test/regression.test.mjs', `import {test} from 'node:test';import assert from 'node:assert/strict';import {listTickets} from '../src/api.mjs';
test('all labels filter before limit',()=>{const rows=[{id:'a',labels:['red']},{id:'b',labels:['red','urgent']}];assert.deepEqual(listTickets(rows,{labels:['red','urgent'],limit:1}),[rows[1]]);assert.throws(()=>listTickets(rows,{labels:'red'}),TypeError);});`);
} else if (id !== 'E01') throw new Error('Unknown case');
