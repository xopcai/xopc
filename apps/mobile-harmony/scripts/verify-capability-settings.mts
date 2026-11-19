import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

// Requires a paired phone on main Chat or Capabilities, with the bundled coder agent enabled.
// Opens settings without saving; only the locally remembered capability category changes.
const target = process.argv[2];
assert(target, 'Pass an explicit HDC target.');
const hdc = process.env.HDC_PATH || 'hdc';
const output = fileURLToPath(new URL('../.test/capability-settings/', import.meta.url));
mkdirSync(output, { recursive: true });
interface UiNode { attributes?: Record<string, string>; children?: UiNode[] }
type Attr = Record<string, string>;
const command = (...args: string[]) => execFileSync(hdc, ['-t', target, ...args], { encoding: 'utf8', timeout: 20000 });
const passed: string[] = [];

async function tree(name: string): Promise<Attr[]> {
  await delay(400);
  const remote = '/data/local/tmp/xopc-capability-settings-' + name + '.json';
  command('shell', 'uitest', 'dumpLayout', '-p', remote);
  const local = join(output, name + '.json');
  command('file', 'recv', remote, local);
  const nodes: Attr[] = [];
  const walk = (item: UiNode) => { if (item.attributes) nodes.push(item.attributes); item.children?.forEach(walk); };
  walk(JSON.parse(readFileSync(local, 'utf8')));
  return nodes;
}
function node(nodes: Attr[], id: string): Attr {
  const item = nodes.find(item => item.id === id); assert(item, 'Missing ' + id); return item;
}
function click(item: Attr): void {
  const [left, top, right, bottom] = item.bounds.match(/-?\d+/g)!.map(Number);
  assert(right > left && bottom > top, 'Element is clipped: ' + item.id);
  command('shell', 'uitest', 'uiInput', 'click', String(Math.round((left + right) / 2)), String(Math.round((top + bottom) / 2)));
}
async function until(name: string, id: string): Promise<Attr[]> {
  for (let attempt = 0; attempt < 10; attempt++) {
    const nodes = await tree(name); if (nodes.some(item => item.id === id)) return nodes;
  }
  throw new Error('UI did not settle: ' + name + ' / ' + id);
}
function screen(name: string): void {
  const remote = '/data/local/tmp/xopc-capability-settings-' + name + '.jpeg';
  command('shell', 'snapshot_display', '-f', remote);
  command('file', 'recv', remote, join(output, name + '.jpeg'));
}
async function openCapabilities(): Promise<Attr[]> {
  let nodes = await until('main-chat', 'chat-header-sidebar');
  click(node(nodes, 'chat-header-sidebar'));
  nodes = await until('sidebar', 'chat-sidebar-capabilities');
  click(node(nodes, 'chat-sidebar-capabilities'));
  return until('capabilities', 'capability-pager');
}

async function selectCategory(nodes: Attr[], key: string): Promise<Attr[]> {
  click(node(nodes, 'capability-page-menu'));
  nodes = await until(key + '-menu', 'capability-category-' + key);
  click(node(nodes, 'capability-category-' + key));
  return until(key + '-selected', 'capability-pager');
}

try {
  let nodes = await tree('initial');
  if (!nodes.some(item => item.id === 'capability-pager')) nodes = await openCapabilities();
  assert(!nodes.some(item => item.id === 'capability-panel-close'), 'Close any existing capability panel first.');
  for (const origin of ['connections', 'plugins', 'channels']) {
    nodes = await selectCategory(nodes, origin);
    // Re-enter to make the origin the initial Swiper index, then change category before opening a sheet.
    click(node(nodes, 'capability-back'));
    nodes = await openCapabilities();
    nodes = await selectCategory(nodes, 'agents');
    nodes = await until(origin + '-agents', 'capability-settings-coder');
    click(node(nodes, 'capability-settings-coder'));
    nodes = await until(origin + '-settings', 'capability-field-name');
    node(nodes, 'capability-field-description');
    node(nodes, 'capability-chat-setup-agents');
    assert(!nodes.some(item => item.id === 'capability-panel-inspect'), 'Expert settings became connection settings.');
    screen(origin + '-settings');
    click(node(nodes, 'capability-panel-close'));
    nodes = await until(origin + '-closed', 'capability-settings-coder');
    node(nodes, 'capability-chat-setup-agents');
    passed.push(origin + ' → agents → expert settings → close preserves the selected category');
  }
  writeFileSync(join(output, 'result.json'), JSON.stringify({ status: 'passed', at: new Date().toISOString(), target, passed, gatewayMutations: false }, null, 2));
  console.log(JSON.stringify({ passed, output }));
} catch (error) {
  writeFileSync(join(output, 'result.json'), JSON.stringify({ status: 'failed', at: new Date().toISOString(), target, passed, error: String(error) }, null, 2));
  throw error;
}
