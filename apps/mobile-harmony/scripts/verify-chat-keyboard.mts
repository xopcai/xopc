import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

// Physical-device safe: focus/touch only. No typing, sending or Gateway mutations.
const target = process.argv[2];
const edgeOnly = process.argv.includes('--edge-only');
assert(target, 'Pass an explicit HDC device target with Chat already open.');
const hdc = process.env.HDC_PATH || 'hdc';
const output = fileURLToPath(new URL('../.test/chat-keyboard/', import.meta.url));
mkdirSync(output, { recursive: true });
interface UiNode { attributes?: Record<string, string>; children?: UiNode[] }
type Attr = Record<string, string>;
const command = (...args: string[]) => execFileSync(hdc, ['-t', target, ...args], { encoding: 'utf8', timeout: 15000 });
async function tree(name: string): Promise<Attr[]> {
  await delay(500);
  const remote = '/data/local/tmp/xopc-keyboard-' + name + '.json';
  command('shell', 'uitest', 'dumpLayout', '-p', remote);
  command('file', 'recv', remote, join(output, name + '.json'));
  const nodes: Attr[] = [];
  const walk = (item: UiNode) => { if (item.attributes) nodes.push(item.attributes); item.children?.forEach(walk); };
  walk(JSON.parse(readFileSync(join(output, name + '.json'), 'utf8')));
  return nodes;
}
function node(nodes: Attr[], id: string): Attr {
  const item = nodes.find(item => item.id === id);
  assert(item, 'Missing ' + id);
  return item;
}
function bounds(item: Attr): number[] { return item.bounds.match(/-?\d+/g)!.map(Number); }
function click(item: Attr): void {
  const [left, top, right, bottom] = bounds(item);
  command('shell', 'uitest', 'uiInput', 'click', String(Math.round((left + right) / 2)), String(Math.round((top + bottom) / 2)));
}
async function until(name: string, ready: (nodes: Attr[]) => boolean): Promise<Attr[]> {
  for (let attempt = 0; attempt < 10; attempt++) {
    const nodes = await tree(name);
    if (ready(nodes)) return nodes;
  }
  throw new Error('UI did not settle: ' + name);
}
async function screen(name: string): Promise<void> {
  const remote = '/data/local/tmp/xopc-keyboard-' + name + '.jpeg';
  command('shell', 'snapshot_display', '-f', remote);
  command('file', 'recv', remote, join(output, name + '.jpeg'));
}
const passed: string[] = [];
try {
  let nodes = await tree('before');
  node(nodes, 'chat-composer');
  nodes = await until('before', items => items.some(item => item.id?.startsWith('chat-starter-') || item.type === 'ListItem'));
  const draft = node(nodes, 'chat-composer').text;
  assert.notEqual(node(nodes, 'chat-composer').focused, 'true', 'Start with the keyboard closed.');
  assert(!nodes.some(item => item.id === 'chat-stop'), 'Do not interfere with an active run.');
  const surfaceId = nodes.some(item => item.id === 'chat-welcome') ? 'chat-welcome' : 'chat-message-list';
  const initialTop = bounds(node(nodes, surfaceId))[1];
  const initialBottom = bounds(node(nodes, 'chat-composer-shell'))[3];
  const starterIds = nodes.filter(item => item.id?.startsWith('chat-starter-')).map(item => item.id);
  const hasDock = nodes.some(item => item.id === 'main-tab-dock');
  for (let cycle = 0; cycle < (edgeOnly ? 3 : 6); cycle++) {
    click(node(nodes, 'chat-composer'));
    nodes = await until('open-' + cycle, items => {
      const editor = items.find(item => item.id === 'chat-composer');
      return editor?.focused === 'true' && bounds(node(items, 'chat-composer-shell'))[3] < initialBottom - 100
        && (!hasDock || !items.some(item => item.id === 'main-tab-dock'));
    });
    const surface = node(nodes, surfaceId);
    assert.equal(bounds(surface)[1], initialTop, 'Keyboard must not push the message area/header above the window.');
    for (const id of starterIds) node(nodes, id);
    assert.equal(node(nodes, 'chat-composer').text, draft, 'Focus must preserve the draft.');
    if (cycle === 0) await screen('open');
    const [left, top, right, bottom] = bounds(surface);
    const strip = bounds(node(nodes, 'chat-drawer-gesture-strip'));
    const tapX = !edgeOnly && cycle < 3 ? left + (right - left) * 0.08 : (strip[0] + strip[2]) / 2;
    command('shell', 'uitest', 'uiInput', 'click', String(Math.round(tapX)), String(Math.round((top + bottom) / 2)));
    nodes = await until('closed-' + cycle, items => node(items, 'chat-composer').focused === 'false'
      && Math.abs(bounds(node(items, 'chat-composer-shell'))[3] - initialBottom) < 3
      && (!hasDock || items.some(item => item.id === 'main-tab-dock')));
    assert.equal(node(nodes, 'chat-composer').text, draft);
    assert.equal(bounds(node(nodes, surfaceId))[1], initialTop);
  }
  await screen('closed');
  passed.push(surfaceId + (edgeOnly ? ': three drawer-edge' : ': three body and three drawer-edge') + ' focus/dismiss cycles preserve draft, content and header position');
  writeFileSync(join(output, 'result.json'), JSON.stringify({ status: 'passed', at: new Date().toISOString(), target, passed, gatewayMutations: false }, null, 2));
  console.log(JSON.stringify({ passed, output }));
} catch (error) {
  writeFileSync(join(output, 'result.json'), JSON.stringify({ status: 'failed', at: new Date().toISOString(), target, passed, error: String(error) }, null, 2));
  throw error;
}
