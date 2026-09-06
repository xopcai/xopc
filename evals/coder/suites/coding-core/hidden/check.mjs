import assert from 'node:assert/strict';
import { resolve } from 'node:path';

const id = process.argv[2];
const module = await import(`../src/${id}.mjs`);
if (id === 'paginate') {
  const input = Object.freeze([{id:'b'}, {id:'Z'}, {id:'a'}, {id:'A'}]);
  assert.deepEqual(module.paginate(input, 'A', 2).map(x => x.id), ['Z', 'a']);
  assert.deepEqual(module.paginate(input, '', 0), []);
  for (const n of [-1, 1.5, NaN, Infinity]) assert.throws(() => module.paginate(input, null, n));
} else if (id === 'csv') {
  assert.deepEqual(module.parseCsv(''), []);
  assert.deepEqual(module.parseCsv(' a ,"b,c",\r\n"line\nnext","say ""hi""",x\r\n'), [
    [' a ', 'b,c', ''], ['line\nnext', 'say "hi"', 'x'],
  ]);
  assert.deepEqual(module.parseCsv(','), [['', '']]);
  assert.deepEqual(module.parseCsv('\n'), [['']]);
  assert.deepEqual(module.parseCsv('""'), [['']]);
  assert.throws(() => module.parseCsv('"open'));
} else if (id === 'cache') {
  let now = 10; const cache = new module.Cache(() => now);
  cache.set('a', false, 5); now = 14; assert.equal(cache.get('a'), false);
  now = 15; assert.equal(cache.get('a'), undefined);
  cache.set('a', 0, 0); assert.equal(cache.get('a'), undefined);
  cache.set('b', '', 5); now++; cache.set('b', 7, 10); now = 25; assert.equal(cache.get('b'), 7);
  now = 26; assert.equal(cache.get('b'), undefined);
  for (const ttl of [-1, NaN, Infinity]) assert.throws(() => cache.set('x', 1, ttl));
} else if (id === 'map-limit') {
  let active = 0, max = 0;
  const result = await module.mapLimit([4,3,2,1], 2, async (value, index) => {
    active++; max = Math.max(max, active);
    await new Promise(resolve => setTimeout(resolve, value * 3)); active--;
    return `${index}:${value}`;
  });
  assert.equal(max, 2); assert.deepEqual(result, ['0:4','1:3','2:2','3:1']);
  for (const n of [0, -1, 1.5, NaN]) await assert.rejects(module.mapLimit([1], n, x => x));
  const error = new Error('mapper'); let count = 0;
  await assert.rejects(module.mapLimit([1,2,3], 1, () => { count++; throw error; }), e => e === error);
  assert.equal(count, 1); assert.deepEqual(await module.mapLimit([], 3, x => x), []);
} else if (id === 'path') {
  const root = resolve('test-root');
  assert.equal(module.safePath(root, 'src/../a'), resolve(root, 'a'));
  assert.equal(module.safePath(root, '.'), root);
  assert.throws(() => module.safePath(root, '../test-root-sibling/secret'));
  assert.throws(() => module.safePath(root, '../secret'));
  assert.throws(() => module.safePath(root, resolve(root, '../outside')));
} else if (id === 'retry') {
  const reason = new Error('cancelled'), controller = new AbortController(); controller.abort(reason);
  let calls = 0;
  await assert.rejects(module.retry(() => { calls++; return 1; }, {signal: controller.signal}), e => e === reason);
  assert.equal(calls, 0);
  const active = new AbortController();
  await assert.rejects(module.retry(() => { calls++; active.abort(reason); throw new Error('operation'); }, {signal: active.signal}), e => e === reason);
  assert.equal(calls, 1);
  const error = new Error('exhausted'); const indices = [];
  await assert.rejects(module.retry(i => { indices.push(i); throw error; }, {attempts:2}), e => e === error);
  assert.deepEqual(indices, [0,1]);
  for (const attempts of [0, -1, 1.5, NaN]) await assert.rejects(module.retry(() => 1, {attempts}));
} else if (id === 'invoice') {
  const { toCents } = await import('../src/money.mjs');
  assert.equal(toCents('90071992547409.91'), Number.MAX_SAFE_INTEGER);
  assert.equal(module.invoice([{price:'0.29', quantity:3}, {price:'1.1', quantity:2}]), 307);
  assert.equal(module.invoice([]), 0);
  for (const price of ['-1', '1.001', '1e2', ' 1', '1.', '', '90071992547409.92']) assert.throws(() => toCents(price));
  for (const quantity of [-1, .5, Infinity]) assert.throws(() => module.invoice([{price:'1', quantity}]));
  assert.throws(() => module.invoice([{price:'90071992547409.91', quantity:2}]));
  assert.throws(() => module.invoice([{price:'90071992547409.91', quantity:1}, {price:'0.01', quantity:1}]));
} else if (id === 'migrations') {
  for (const failure of ['none', 'begin', 'step', 'commit']) {
    const events = [], error = new Error(failure);
    const db = Object.fromEntries(['begin','commit','rollback'].map(name => [name, async () => {
      events.push(name); if (name === failure || name === 'rollback') throw name === failure ? error : new Error('rollback');
    }]));
    const steps = [{up: async () => { events.push('step1'); if (failure === 'step') throw error; }},
      {up: async () => { events.push('step2'); }}];
    if (failure === 'none') await module.migrate(db, steps);
    else await assert.rejects(module.migrate(db, steps), e => e === error);
    assert.deepEqual(events, failure === 'begin' ? ['begin'] : failure === 'step' ? ['begin','step1','rollback']
      : failure === 'commit' ? ['begin','step1','step2','commit','rollback'] : ['begin','step1','step2','commit']);
  }
} else throw new Error(`Unknown case: ${id}`);
