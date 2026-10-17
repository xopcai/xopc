import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { lstatSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const id = process.argv[2];
assert.ok(['I01', 'I02', 'E01', 'E02', 'P01', 'P02'].includes(id), 'Unknown case');
function regular(path) {
  assert.ok(lstatSync(path).isFile() && !lstatSync(path).isSymbolicLink(), 'Deliverable must be a regular file');
  assert.equal(realpathSync(path), resolve(path), 'No symlink ancestors');
  return readFileSync(path, 'utf8');
}
assert.ok(regular('report.md').trim().length >= 80, 'Require a complete report, not a semantic prose grade');
if (id === 'I01') {
  const result = JSON.parse(regular('result.json'));
  assert.ok(Array.isArray(result.evidencePaths));
  result.evidencePaths.sort();
  assert.deepEqual(result, { ledgerId: 'settlement-oct', netCents: 17000, settledCount: 2,
    evidencePaths: ['contracts/settlement.md', 'data/live/october.json', 'services/settlement/service.json', 'workspace.json'] });
} else if (id === 'I02') {
  assert.deepEqual(JSON.parse(regular('result.json')), {service: 'exporter', timeoutMs: 12000, maxAttempts: 3,
    configPath: 'releases/2026-10/exporter/config.json', contractPath: 'releases/2026-10/exporter/contract.md'});
} else {
  const trace = JSON.parse(regular('.xopc-eval-hidden/trace.json'));
  assert.ok(trace.events.some(event => {
    const payload = event.payload?.payload;
    const verification = payload?.result?.details?.verification;
    return event.type === 'tool.finished' && payload?.status === 'success'
      && verification?.kind === 'check' && verification?.status === 'passed';
  }), 'Require an actually observed successful standalone check, not a written completion claim');
  // Execute public and new tests in a separate bounded process.
  const tests = readdirSync('test').filter(name => name.endsWith('.test.mjs')).map(name => `test/${name}`);
  if (id !== 'E01') assert.ok(tests.some(name => name !== 'test/smoke.test.mjs'), 'Require added regression coverage');
  execFileSync(process.execPath, ['--test', ...tests], { timeout: 15_000, stdio: 'pipe' });
  if (id !== 'E01') {
    const paths = execFileSync('git', ['ls-tree', '-r', '--name-only', 'HEAD', '--', 'src'], {encoding:'utf8'}).trim().split('\n');
    const changed = paths.map(path => [path, readFileSync(path)]);
    let rejectedOriginal = false;
    try {
      for (const path of paths) writeFileSync(path, execFileSync('git', ['show', `HEAD:${path}`]));
      try { execFileSync(process.execPath, ['--test', ...tests], {timeout:15000,stdio:'pipe'}); }
      catch (error) { rejectedOriginal = typeof error.status === 'number' && error.status > 0; }
    } finally {
      for (const [path, bytes] of changed) writeFileSync(path, bytes);
    }
    assert.ok(rejectedOriginal, 'Added tests must reject the original incomplete implementation');
  }
  const module = async path => import(pathToFileURL(resolve(path)).href);
  const frozen = value => {
    if (value && typeof value === 'object') { Object.values(value).forEach(frozen); Object.freeze(value); }
    return value;
  };
  if (id === 'E01') {
    const added = execFileSync('git', ['ls-files', '--others', '--exclude-standard'], {encoding:'utf8'})
      .trim().split('\n').filter(path => path && !path.startsWith('.xopc-eval-hidden/'));
    assert.deepEqual(added, ['report.md'], 'Only the requested report may be added to the completed task');
    assert.deepEqual(JSON.parse(regular('deliverables/result.json')), {rowCount: 2, totalCents: 3500});
    assert.ok(regular('deliverables/report.md').length >= 80);
    const {summarize} = await module('src/summarize.mjs');
    assert.deepEqual(summarize(frozen([{cents:17},{cents:23},{cents:0}])), {rowCount:3,totalCents:40});
  } else if (id === 'E02') {
    const {exportOrders} = await module('src/export.mjs');
    for (const base of [1, 37, 250]) {
      const rows = frozen([{id:'z',status:'paid',cents:base},{id:'a',status:'cancelled',cents:99999},{id:'m',status:'shipped',cents:base+9}]);
      assert.deepEqual(exportOrders(rows,{limit:1}),{ids:['z'],totalCents:base*2+9});
      assert.deepEqual(exportOrders(rows,{limit:0}),{ids:[],totalCents:base*2+9});
      assert.deepEqual(exportOrders(rows),{ids:['z','m'],totalCents:base*2+9});
    }
    for (const limit of [-1, 1.5, NaN, Infinity, '1']) assert.throws(()=>exportOrders([],{limit}),RangeError);
    assert.deepEqual(exportOrders([]),{ids:[],totalCents:0});
  } else if (id === 'P01') {
    const {createInventory} = await module('src/index.mjs');
    for (const quantity of [5, 13, 48]) {
      const app = createInventory(frozen({alpha:quantity,beta:7}));
      assert.equal(app.available('alpha'),quantity);
      assert.deepEqual(app.reserve('alpha',2),{sku:'alpha',reserved:2,remaining:quantity-2});
      assert.equal(app.available('alpha'),quantity-2);
      assert.deepEqual(app.reserve('alpha',quantity-2),{sku:'alpha',reserved:quantity-2,remaining:0});
      assert.equal(app.available('alpha'),0);
      assert.throws(()=>app.reserve('alpha',1));
      assert.equal(app.available('alpha'),0);
      assert.equal(app.available('beta'),7);
      for (const bad of [0,-1,1.5,NaN,Infinity,'2']) assert.throws(()=>app.reserve('beta',bad),RangeError);
      assert.equal(app.available('beta'),7);
      assert.throws(()=>app.reserve('unknown',1));
      assert.equal(createInventory({alpha:quantity}).available('alpha'),quantity);
    }
  } else if (id === 'P02') {
    const {listTickets} = await module('src/api.mjs');
    const rows = frozen([{id:'z',status:'open',labels:['red']},{id:'b',status:'open',labels:['red','urgent']},
      {id:'c',status:'closed',labels:['urgent']},{id:'d',status:'open'},{id:'e',status:'open',labels:['red','urgent']}]);
    assert.deepEqual(listTickets(rows,frozen({labels:['red','urgent'],status:'open',after:'a',limit:1})),[rows[1]]);
    assert.deepEqual(listTickets(rows,{labels:[]}),rows);
    assert.deepEqual(listTickets(rows,{labels:['urgent']}),[rows[1],rows[2],rows[4]]);
    assert.deepEqual(listTickets(rows,{labels:['absent']}),[]);
    assert.deepEqual(listTickets(rows,{labels:['red'],limit:0}),[]);
    assert.deepEqual(listTickets(rows,{status:'open',after:'c'}),[rows[0],rows[3],rows[4]]);
    for (const labels of [null,'red',[1],['red',null],{},42]) assert.throws(()=>listTickets(rows,{labels}),TypeError);
    assert.deepEqual(listTickets([], {labels:['red']}),[]);
    assert.equal(listTickets(rows,{limit:1})[0],rows[0]);
    assert.equal(listTickets(Array.from({length:23},(_,i)=>({id:String(i)}))).length,20);
    for (const limit of [-1,1.5,NaN,'2']) assert.throws(()=>listTickets(rows,{limit}),RangeError);
  }
}
console.log(`${id}: independent behavior and artifact checks passed`);
