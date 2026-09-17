import { execFileSync } from 'node:child_process';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';

// Read-only Gateway checks; local starter/slash drafts are removed before completion.
const target = process.argv[2];
if (!target?.startsWith('127.0.0.1:')) throw new Error('This check is emulator-only. Pass its HDC target explicitly.');
const hdc = process.env.HDC_PATH || 'hdc';
const output = fileURLToPath(new URL('../.test/chat-ui/', import.meta.url));
mkdirSync(output, { recursive: true });
interface Node { attributes?: Record<string, string>; children?: Node[] }
type Attr = Record<string, string>;
const command = (...args: string[]) => execFileSync(hdc, ['-t', target, ...args], { encoding: 'utf8', timeout: 15000 });
async function tree(name: string): Promise<Attr[]> {
  await delay(500);
  const remote = '/data/local/tmp/xopc-chat-ui-' + name + '.json';
  command('shell', 'uitest', 'dumpLayout', '-p', remote); command('file', 'recv', remote, join(output, name + '.json'));
  const nodes: Attr[] = [];
  const walk = (node: Node) => { if (node.attributes) nodes.push(node.attributes); for (const child of node.children || []) walk(child); };
  walk(JSON.parse(readFileSync(join(output, name + '.json'), 'utf8'))); return nodes;
}
async function until(name: string, ready: (nodes: Attr[]) => boolean): Promise<Attr[]> {
  for (let attempt = 0; attempt < 12; attempt++) {
    const nodes = await tree(name);
    if (ready(nodes)) return nodes;
  }
  throw new Error('UI did not settle: ' + name);
}
function node(nodes: Attr[], id: string): Attr { const result = nodes.find(item => item.id === id); assert(result, 'Missing ' + id); return result; }
function center(item: Attr): [string, string] {
  const values = item.bounds.match(/\d+/g)!.map(Number); return [String(Math.round((values[0] + values[2]) / 2)), String(Math.round((values[1] + values[3]) / 2))];
}
function click(item: Attr) { command('shell', 'uitest', 'uiInput', 'click', ...center(item)); }
function extent(item: Attr): { width: number; height: number } {
  const [left, top, right, bottom] = item.bounds.match(/-?\d+/g)!.map(Number);
  return { width: right - left, height: bottom - top };
}
async function screen(name: string) {
  const remote = '/data/local/tmp/xopc-chat-ui-' + name + '.jpeg';
  command('shell', 'snapshot_display', '-f', remote); command('file', 'recv', remote, join(output, name + '.jpeg'));
}
const passed: string[] = [];
const skipped: string[] = [];
writeFileSync(join(output, 'result.json'), JSON.stringify({ at: new Date().toISOString(), status: 'running', target }));
process.on('uncaughtException', error => {
  writeFileSync(join(output, 'result.json'), JSON.stringify({ at: new Date().toISOString(), status: 'failed', target, passed, skipped, error: error.message }, null, 2));
  console.error(error); process.exit(1);
});
command('shell', 'aa', 'start', '-a', 'EntryAbility', '-b', 'ai.xopc.mobile');
await delay(1200);
let nodes = await until('root', nodes => nodes.some(item => item.id === 'chat-message-list' || item.id?.startsWith('chat-starter-')));
node(nodes, 'main-tab-dock');
assert.equal(node(nodes, 'chat-composer').text, '', 'Leave the existing draft untouched; this test requires an empty composer.');
assert(!nodes.some(item => item.id === 'chat-stop'), 'Do not interfere with an active conversation run.');
await screen('root');
const pixelScale = extent(node(nodes, 'chat-voice-toggle')).height / 36;
assert(Math.abs(extent(node(nodes, 'chat-composer-shell')).height / pixelScale - 85) < 3, 'Empty composer should be 36vp scope + 48vp compact row + border');
assert(!nodes.some(item => item.id === 'chat-send'), 'Empty draft must not show send');
click(node(nodes, 'chat-composer'));
nodes = await until('composer-empty-keyboard', nodes => !nodes.some(item => item.id === 'main-tab-dock'));
assert(!nodes.some(item => item.id === 'chat-send'));
command('shell', 'uitest', 'uiInput', 'text', 'composer-layout-check');
nodes = await tree('composer-expanded');
assert.equal(node(nodes, 'chat-composer').text, 'composer-layout-check');
assert.equal(node(nodes, 'chat-composer').focused, 'true', 'First keystroke must not replace or blur the editor');
assert(Math.abs(extent(node(nodes, 'chat-composer')).height / pixelScale - 40) < 2);
assert(Math.abs(extent(node(nodes, 'chat-send')).height / pixelScale - 44) < 2);
assert(Math.abs(extent(node(nodes, 'chat-composer-shell')).height / pixelScale - 137) < 3);
await screen('composer-expanded');
command('shell', 'uitest', 'uiInput', 'keyEvent', '2072', '2017');
command('shell', 'uitest', 'uiInput', 'keyEvent', '2055');
nodes = await tree('composer-recollapsed');
assert.equal(node(nodes, 'chat-composer').text, '');
assert(!nodes.some(item => item.id === 'chat-send'));
click(node(nodes, 'chat-voice-toggle'));
nodes = await until('composer-voice', nodes => nodes.some(item => item.id === 'main-tab-dock'));
node(nodes, 'chat-voice-pad'); node(nodes, 'chat-voice-record');
assert(!nodes.some(item => item.id === 'chat-composer'), 'Voice mode must replace, not stack with, the text editor');
assert(Math.abs(extent(node(nodes, 'chat-composer-shell')).height / pixelScale - 85) < 3);
await screen('composer-voice');
click(node(nodes, 'chat-voice-toggle'));
nodes = await until('composer-keyboard-restored', nodes => nodes.some(item => item.id === 'chat-composer' && item.focused === 'true'));
command('shell', 'uitest', 'uiInput', 'keyEvent', 'Back'); nodes = await tree('composer-layout-clean');
assert.equal(node(nodes, 'chat-composer').text, '');
passed.push('compact/expanded dimensions, send visibility, stable input focus, voice/keyboard switch and empty-draft cleanup');
const starters = nodes.filter(item => item.id?.startsWith('chat-starter-'));
if (starters.length) {
  assert.equal(starters.length, 3, 'Welcome should contain three editable starters');
  click(starters[0]); nodes = await tree('starter-prefill');
  assert(node(nodes, 'chat-composer').text.trim().length > 0, 'Starter did not prefill the composer');
  assert(!nodes.some(item => item.id === 'chat-stop'), 'Starter must not automatically send');
  await screen('starter-prefill');
  click(node(nodes, 'chat-composer'));
  command('shell', 'uitest', 'uiInput', 'keyEvent', '2072', '2017');
  command('shell', 'uitest', 'uiInput', 'keyEvent', '2055');
  command('shell', 'uitest', 'uiInput', 'keyEvent', 'Back'); nodes = await tree('starter-cleared');
  assert.equal(node(nodes, 'chat-composer').text, '', 'Starter test draft cleanup failed');
  passed.push('three context starters prefill without sending; local draft cleared');
} else skipped.push('welcome starters: main conversation is not empty');
click(node(nodes, 'chat-open-drawer')); nodes = await tree('drawer'); node(nodes, 'chat-drawer');
assert(!nodes.some(item => item.id === 'main-tab-dock')); await screen('drawer');
click(node(nodes, 'chat-drawer-collapse')); nodes = await tree('closed-drawer'); node(nodes, 'main-tab-dock'); passed.push('drawer opens/closes and hides dock');
const attention = nodes.find(item => item.id === 'chat-attention-open');
if (attention) {
  click(attention); nodes = await tree('attention'); node(nodes, 'chat-attention-sheet'); await screen('attention');
  command('shell', 'uitest', 'uiInput', 'keyEvent', 'Back'); nodes = await tree('closed-attention');
  node(nodes, 'main-tab-dock'); passed.push('attention sheet opens and dismisses without executing actions');
} else skipped.push('attention sheet: no unseen attention fixture on paired Gateway');
click(node(nodes, 'chat-model-picker')); nodes = await tree('models'); await screen('models');
assert(nodes.some(item => item.text.startsWith('✓ ')), 'Current model indicator is missing');
command('shell', 'uitest', 'uiInput', 'keyEvent', 'Back'); nodes = await tree('closed-models');
click(node(nodes, 'chat-composer-actions')); nodes = await tree('panel');
assert(!nodes.some(item => item.id === 'main-tab-dock')); assert(nodes.some(item => item.text === 'Photos' || item.text === '照片')); await screen('panel');
click(node(nodes, 'chat-composer-actions')); nodes = await tree('closed-panel'); node(nodes, 'main-tab-dock'); passed.push('model sheet and composer panel');
for (const index of [1, 2, 3, 0]) {
  click(node(nodes, 'main-tab-' + index)); nodes = await tree('tab-' + index);
  assert.equal(node(nodes, 'main-tab-' + index).selected, 'true');
}
passed.push('four tabs update selected state');
click(node(nodes, 'chat-composer')); nodes = await until('keyboard', nodes => !nodes.some(item => item.id === 'main-tab-dock'));
assert(!nodes.some(item => item.id === 'main-tab-dock'), 'Dock overlaps keyboard');
command('shell', 'uitest', 'uiInput', 'text', '/'); await delay(800); nodes = await tree('palette');
node(nodes, 'chat-command-palette'); assert.equal(node(nodes, 'chat-composer').text, '/'); await screen('palette');
command('shell', 'uitest', 'uiInput', 'keyEvent', 'Back'); nodes = await tree('draft-keyboard-closed');
command('shell', 'aa', 'force-stop', 'ai.xopc.mobile');
command('shell', 'aa', 'start', '-a', 'EntryAbility', '-b', 'ai.xopc.mobile');
await delay(1500); nodes = await tree('draft-after-restart');
assert.equal(node(nodes, 'chat-composer').text, '/'); passed.push('encrypted draft survives cold restart');
click(node(nodes, 'chat-open-drawer')); nodes = await tree('history');
const history = nodes.find(item => item.id?.startsWith('drawer-session-')); assert(history, 'History fixture is required');
click(history); await delay(1000); nodes = await tree('detail');
assert(!nodes.some(item => item.id === 'main-tab-dock')); assert(!nodes.some(item => item.id === 'chat-open-drawer'));
await screen('detail'); command('shell', 'uitest', 'uiInput', 'keyEvent', 'Back'); nodes = await tree('restored-root');
assert.equal(node(nodes, 'chat-composer').text, '/'); node(nodes, 'main-tab-dock'); passed.push('history detail leaves main draft and tab intact');
click(node(nodes, 'chat-open-drawer')); nodes = await tree('manager-drawer');
click(node(nodes, 'chat-drawer-search'));
nodes = await until('sessions-manager', nodes => nodes.some(item => item.id?.startsWith('sessions-row-')));
assert(!nodes.some(item => item.id === 'main-tab-dock')); node(nodes, 'sessions-search'); await screen('sessions-manager');
const firstSession = nodes.find(item => item.id?.startsWith('sessions-row-'))!;
command('shell', 'uitest', 'uiInput', 'longClick', ...center(firstSession)); nodes = await tree('sessions-menu');
assert(!nodes.some(item => item.id === 'sessions-batch-bar'), 'Long press must open the menu, not select immediately');
const renameAction = nodes.find(item => item.text === 'Rename' || item.text === '重命名'); assert(renameAction);
click(renameAction); nodes = await until('sessions-rename', nodes => nodes.some(item => item.id === 'sessions-rename-input'));
node(nodes, 'sessions-rename-save'); await screen('sessions-rename');
command('shell', 'uitest', 'uiInput', 'keyEvent', 'Back'); nodes = await tree('sessions-rename-cancelled');
command('shell', 'uitest', 'uiInput', 'longClick', ...center(node(nodes, firstSession.id))); nodes = await tree('sessions-menu-select');
const selectAction = nodes.find(item => item.text === 'Select conversations' || item.text === '多选会话'); assert(selectAction);
click(selectAction); nodes = await tree('sessions-selected'); node(nodes, 'sessions-batch-bar');
assert.equal(node(nodes, firstSession.id).selected, 'true'); await screen('sessions-selected');
click(node(nodes, 'sessions-batch-delete')); nodes = await tree('sessions-delete-confirm');
assert(nodes.some(item => item.text.includes('cannot be undone') || item.text.includes('无法撤销')));
const cancelDelete = nodes.find(item => item.text === 'Cancel' || item.text === '取消'); assert(cancelDelete); click(cancelDelete);
nodes = await tree('sessions-delete-cancelled'); node(nodes, firstSession.id);
click(node(nodes, 'sessions-back')); nodes = await tree('sessions-selection-exited');
assert(!nodes.some(item => item.id === 'sessions-batch-bar'));
// Use one token: Gateway FTS deliberately ORs punctuation-separated search terms.
click(node(nodes, 'sessions-search')); command('shell', 'uitest', 'uiInput', 'text', 'zzqv748915xopcverificationnomatch');
command('shell', 'uitest', 'uiInput', 'keyEvent', 'Back');
nodes = await until('sessions-empty-search', nodes => nodes.some(item => item.text.includes('No conversations found') || item.text.includes('没有找到会话')));
assert(!nodes.some(item => item.id?.startsWith('sessions-row-'))); await screen('sessions-empty-search');
click(node(nodes, 'sessions-search-close')); nodes = await until('sessions-search-cleared', nodes => nodes.some(item => item.id === firstSession.id));
click(node(nodes, firstSession.id)); nodes = await until('sessions-chat-detail', nodes => nodes.some(item => item.id === 'chat-composer'));
assert(!nodes.some(item => item.id === 'main-tab-dock'));
command('shell', 'uitest', 'uiInput', 'keyEvent', 'Back'); nodes = await tree('sessions-returned'); node(nodes, 'sessions-list');
click(node(nodes, 'sessions-back')); nodes = await tree('sessions-restored-root');
assert.equal(node(nodes, 'chat-composer').text, '/'); node(nodes, 'main-tab-dock');
passed.push('session manager search, long-press menu, rename cancel, explicit selection, batch-delete cancel and detail return preserve main draft');
click(node(nodes, 'chat-composer')); command('shell', 'uitest', 'uiInput', 'keyEvent', '2055');
command('shell', 'uitest', 'uiInput', 'keyEvent', 'Back'); nodes = await tree('clean-root');
assert.equal(node(nodes, 'chat-composer').text, ''); passed.push('slash palette, keyboard avoidance and local draft cleanup');
writeFileSync(join(output, 'result.json'), JSON.stringify({ at: new Date().toISOString(), status: 'passed', target, passed, skipped, gatewayMutations: false }, null, 2));
console.log(JSON.stringify({ passed, skipped, output }));
