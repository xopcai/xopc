import {test} from 'node:test';import assert from 'node:assert/strict';import {exportOrders} from '../src/export.mjs';
test('unlimited export excludes cancelled',()=>{assert.deepEqual(exportOrders([{id:'a',status:'paid',cents:100},{id:'b',status:'cancelled',cents:999}]),{ids:['a'],totalCents:100});});
