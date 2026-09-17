import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import assert from 'node:assert/strict';

const target = process.argv[2];
if (!target?.startsWith('127.0.0.1:')) throw new Error('Use an unpaired test emulator, never a personal phone.');
const output = fileURLToPath(new URL('../.test/pairing-ui/', import.meta.url));
mkdirSync(output, { recursive: true });
type Attr = Record<string, string>;
interface Tree { attributes?: Attr; children?: Tree[] }
const run = (...args: string[]) => execFileSync(process.env.HDC_PATH || 'hdc', ['-t', target, ...args], { encoding: 'utf8', timeout: 15000 });
async function tree(name: string) {
  await delay(450);
  const remote = '/data/local/tmp/xopc-pairing-ui.json';
  run('shell', 'uitest', 'dumpLayout', '-p', remote);
  run('file', 'recv', remote, join(output, name + '.json'));
  const nodes: Attr[] = [];
  function walk(item: Tree) { if (item.attributes) nodes.push(item.attributes); item.children?.forEach(walk); }
  walk(JSON.parse(readFileSync(join(output, name + '.json'), 'utf8'))); return nodes;
}
function get(nodes: Attr[], id: string) { const item = nodes.find(n => n.id === id); assert(item, `Missing ${id}`); return item; }
function click(nodes: Attr[], id: string) {
  const [left, top, right, bottom] = get(nodes, id).bounds.match(/\d+/g)!.map(Number);
  run('shell', 'uitest', 'uiInput', 'click', String(Math.round((left + right) / 2)), String(Math.round((top + bottom) / 2)));
}
async function screen(name: string) {
  const remote = '/data/local/tmp/xopc-pairing-ui.jpeg';
  run('shell', 'snapshot_display', '-f', remote); run('file', 'recv', remote, join(output, name + '.jpeg'));
}
const passed: string[] = [];
writeFileSync(join(output, 'result.json'), JSON.stringify({ status: 'running', target }));
process.on('uncaughtException', error => {
  writeFileSync(join(output, 'result.json'), JSON.stringify({ status: 'failed', passed, error: error.message }));
  console.error(error); process.exit(1);
});
run('shell', 'aa', 'start', '-a', 'EntryAbility', '-b', 'ai.xopc.mobile');
let nodes = await tree('root');
get(nodes, 'pairing-scan');
assert(!nodes.some(n => n.id === 'pairing-link'), 'Manual input should not clutter the landing page');
await screen('root-en');
click(nodes, 'pairing-manual'); nodes = await tree('manual');
assert.equal(get(nodes, 'pairing-link').text, '', 'Preserve existing draft: test requires an empty field');
assert.equal(get(nodes, 'pairing-connect').enabled, 'false');
click(nodes, 'pairing-link');
run('shell', 'uitest', 'uiInput', 'text', 'invalid-test-link');
run('shell', 'uitest', 'uiInput', 'keyEvent', 'Back'); nodes = await tree('manual-filled');
assert.equal(get(nodes, 'pairing-link').text, 'invalid-test-link');
assert.equal(get(nodes, 'pairing-connect').enabled, 'true');
click(nodes, 'pairing-connect'); nodes = await tree('invalid');
assert.match(get(nodes, 'pairing-error').text, /not a valid|不是有效/);
await screen('invalid');
click(nodes, 'pairing-link');
run('shell', 'uitest', 'uiInput', 'keyEvent', '2072', '2017');
run('shell', 'uitest', 'uiInput', 'keyEvent', '2055');
run('shell', 'uitest', 'uiInput', 'keyEvent', 'Back'); nodes = await tree('cleared');
assert.equal(get(nodes, 'pairing-link').text, '');
click(nodes, 'pairing-back'); nodes = await tree('returned'); get(nodes, 'pairing-scan');
passed.push('scan-first hierarchy, manual entry, disabled empty submit, localized invalid-link error, draft cleanup and return');
click(nodes, 'pairing-help'); nodes = await tree('help');
assert(nodes.some(n => n.text.includes('xopc.ai'))); await screen('help');
run('shell', 'uitest', 'uiInput', 'keyEvent', 'Back'); nodes = await tree('help-closed'); get(nodes, 'pairing-scan');
passed.push('setup help and system-back navigation');
writeFileSync(join(output, 'result.json'), JSON.stringify({ status: 'passed', target, passed, gatewayMutations: false }, null, 2));
console.log(JSON.stringify({ passed, output }));
