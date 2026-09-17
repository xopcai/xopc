import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

// Main-chat navigation only: no message sends, conversation creation or Gateway mutations.
const target = process.argv[2];
assert(target, 'Pass an explicit HDC target with the paired main Chat open.');
const hdc = process.env.HDC_PATH || 'hdc';
const output = fileURLToPath(new URL('../.test/chat-navigation/', import.meta.url));
mkdirSync(output, { recursive: true });
interface UiNode { attributes?: Record<string, string>; children?: UiNode[] }
type Attr = Record<string, string>;
const command = (...args: string[]) => execFileSync(hdc, ['-t', target, ...args], { encoding: 'utf8', timeout: 15000 });
async function tree(name: string): Promise<Attr[]> {
  await delay(500);
  const remote = '/data/local/tmp/xopc-navigation-' + name + '.json';
  command('shell', 'uitest', 'dumpLayout', '-p', remote);
  command('file', 'recv', remote, join(output, name + '.json'));
  const nodes: Attr[] = [];
  const walk = (item: UiNode) => { if (item.attributes) nodes.push(item.attributes); item.children?.forEach(walk); };
  walk(JSON.parse(readFileSync(join(output, name + '.json'), 'utf8')));
  return nodes;
}
function node(nodes: Attr[], id: string): Attr {
  const item = nodes.find(item => item.id === id); assert(item, 'Missing ' + id); return item;
}
function click(item: Attr): void {
  const [left, top, right, bottom] = item.bounds.match(/-?\d+/g)!.map(Number);
  command('shell', 'uitest', 'uiInput', 'click', String(Math.round((left + right) / 2)), String(Math.round((top + bottom) / 2)));
}
async function until(name: string, ready: (nodes: Attr[]) => boolean): Promise<Attr[]> {
  for (let attempt = 0; attempt < 15; attempt++) {
    const nodes = await tree(name); if (ready(nodes)) return nodes;
  }
  throw new Error('UI did not settle: ' + name);
}
function main(nodes: Attr[]): boolean {
  return nodes.some(item => item.id === 'main-tab-dock') && nodes.some(item => item.id === 'chat-open-drawer')
    && !nodes.some(item => item.id === 'chat-drawer' || item.id === 'sessions-list');
}
async function screen(name: string): Promise<void> {
  const remote = '/data/local/tmp/xopc-navigation-' + name + '.jpeg';
  command('shell', 'snapshot_display', '-f', remote); command('file', 'recv', remote, join(output, name + '.jpeg'));
}
const passed: string[] = [];
try {
  let nodes = await until('root', items => main(items) && items.some(item => item.id?.startsWith('chat-starter-') || item.type === 'ListItem'));
  assert.equal(node(nodes, 'chat-composer').text, '', 'Leave existing drafts untouched; requires an empty main draft.');
  assert(!nodes.some(item => item.id === 'chat-stop'), 'Do not interfere with an active run.');
  click(node(nodes, 'chat-open-drawer'));
  nodes = await until('initial-drawer', items => items.some(item => item.id?.startsWith('drawer-session-') && item.selected === 'true'));
  const original = nodes.find(item => item.id?.startsWith('drawer-session-') && item.selected === 'true')!.id;
  const other = nodes.find(item => item.id?.startsWith('drawer-session-') && item.id !== original);
  assert(other, 'A second existing conversation is required.');
  const otherId = other.id;
  click(node(nodes, 'chat-drawer-collapse')); nodes = await until('before-draft', main);
  click(node(nodes, 'chat-composer'));
  const marker = 'navigation-draft-check';
  command('shell', 'uitest', 'uiInput', 'text', marker);
  nodes = await until('draft', items => items.some(item => item.id === 'chat-composer' && item.text === marker));
  click(node(nodes, 'chat-open-drawer')); nodes = await until('select-other', items => items.some(item => item.id === otherId));
  click(node(nodes, otherId)); nodes = await until('other-main', main);
  assert.notEqual(node(nodes, 'chat-composer').text, marker, 'Draft leaked into another conversation.');
  await screen('other-main');
  click(node(nodes, 'chat-open-drawer'));
  nodes = await until('other-selected', items => items.some(item => item.id === otherId && item.selected === 'true'));
  click(node(nodes, otherId)); nodes = await until('same-main', main);
  click(node(nodes, 'main-tab-1')); nodes = await tree('progress');
  assert.equal(node(nodes, 'main-tab-1').selected, 'true');
  click(node(nodes, 'main-tab-0')); nodes = await until('chat-return', main);
  click(node(nodes, 'chat-open-drawer'));
  nodes = await until('chat-return-selected', items => items.some(item => item.id === otherId && item.selected === 'true'));
  passed.push('drawer selection stays in main Chat, same-row selection and tab round trip preserve selection');
  click(node(nodes, 'chat-drawer-search'));
  nodes = await until('manager', items => items.some(item => item.id === 'sessions-row-' + original.slice('drawer-session-'.length)));
  click(node(nodes, 'sessions-row-' + original.slice('drawer-session-'.length)));
  nodes = await until('manager-main', items => main(items) && node(items, 'chat-composer').text === marker);
  await screen('manager-main');
  click(node(nodes, 'chat-open-drawer'));
  nodes = await until('original-selected', items => items.some(item => item.id === original && item.selected === 'true'));
  click(node(nodes, 'chat-drawer-collapse')); nodes = await until('restored-main', main);
  assert.equal(node(nodes, 'chat-composer').text, marker);
  passed.push('session manager opens main Chat without a detail stack; original per-conversation draft restored');
  click(node(nodes, 'chat-composer'));
  command('shell', 'uitest', 'uiInput', 'keyEvent', '2072', '2017');
  command('shell', 'uitest', 'uiInput', 'keyEvent', '2055');
  command('shell', 'uitest', 'uiInput', 'keyEvent', 'Back');
  nodes = await until('clean', items => main(items) && node(items, 'chat-composer').text === '');
  passed.push('only the temporary local draft removed; original main selection restored');
  writeFileSync(join(output, 'result.json'), JSON.stringify({ status: 'passed', at: new Date().toISOString(), target, passed, gatewayMutations: false }, null, 2));
  console.log(JSON.stringify({ passed, output }));
} catch (error) {
  writeFileSync(join(output, 'result.json'), JSON.stringify({ status: 'failed', at: new Date().toISOString(), target, passed, error: String(error) }, null, 2));
  throw error;
}
