import { test } from 'node:test';
import assert from 'node:assert/strict';
import { paginate } from '../src/paginate.mjs';
import { parseCsv } from '../src/csv.mjs';
import { Cache } from '../src/cache.mjs';
import { mapLimit } from '../src/map-limit.mjs';
import { invoice } from '../src/invoice.mjs';
test('existing public behavior', async () => {
  assert.deepEqual(paginate([{id:'a'}], null, 1), [{id:'a'}]);
  assert.deepEqual(parseCsv('a,b'), [['a','b']]);
  const cache = new Cache(() => 0); cache.set('a', 2, 10); assert.equal(cache.get('a'), 2);
  assert.deepEqual(await mapLimit([1,2], 1, x => x * 2), [2,4]);
  assert.equal(invoice([{price:'1.50', quantity:2}]), 300);
});
