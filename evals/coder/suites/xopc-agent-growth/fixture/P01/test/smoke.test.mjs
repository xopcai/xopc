import {test} from 'node:test';import assert from 'node:assert/strict';import {createInventory} from '../src/index.mjs';
test('single reservation and validation',()=>{const app=createInventory({a:5});assert.deepEqual(app.reserve('a',2),{sku:'a',reserved:2,remaining:3});assert.throws(()=>app.reserve('a',0),RangeError);});
