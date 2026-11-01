import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

import electron from 'electron';
import { createAcceptanceOutput, withTimeout } from './electron-local-connection-support.mjs';

const output = await createAcceptanceOutput(join(process.cwd(), 'reports/browser-process.json'));
const root = await mkdtemp(join(tmpdir(), 'xopc-browser-process-'));
const report = { passed: false, startedAt: new Date().toISOString(), scope: 'Development private Electron Browser worker: blank-page isolation and process-group stop only; not native approval or installed-app acceptance', cases: [] };
const groupExists = id => { try { process.kill(-id, 0); return true; } catch (error) { if (error.code === 'ESRCH') return false; if (error.code === 'EPERM') return true; throw error; } };
const parents = [], groups = [];
try {
  for (const scenario of ['stop', 'parent-death']) {
    const directory = join(root, scenario); await mkdir(directory);
    const generation = randomUUID(), messages = [], waiters = [];
    const parent = spawn(process.execPath, [join(process.cwd(), 'scripts/fixtures/desktop-browser-parent.mjs'), electron, join(process.cwd(), 'out/main/index.js'), directory, generation], {
      serialization: 'json', stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
    }); parents.push(parent);
    let parentDiagnostic = '';
    parent.stderr.on('data', chunk => { if (parentDiagnostic.length < 4000) parentDiagnostic += chunk.toString().slice(0, 4000 - parentDiagnostic.length); });
    parent.on('message', message => { messages.push(message); for (const waiter of waiters.splice(0)) waiter(); });
    parent.once('exit', (code, signal) => { messages.push({ event: 'parent-exit', code, signal, diagnostic: parentDiagnostic }); for (const waiter of waiters.splice(0)) waiter(); });
    const receive = async predicate => {
      const until = performance.now() + 30000;
      while (performance.now() < until) {
        const index = messages.findIndex(predicate); if (index >= 0) return messages.splice(index, 1)[0];
        const exited = messages.find(message => ['child-exit', 'parent-exit'].includes(message.event)); if (exited) throw new Error('Private Browser exited: ' + JSON.stringify(exited));
        await withTimeout(new Promise(resolve => waiters.push(resolve)), Math.max(1, until - performance.now()), 'Private Browser worker response timeout');
      } throw new Error('Private Browser worker response timeout');
    };
    const spawned = await receive(message => message.event === 'spawned'), worker = spawned.workerPid; assert(Number.isSafeInteger(worker) && worker > 1); groups.push(worker);
    const item = { scenario, workerPid: worker }; report.cases.push(item);
    await receive(message => message.id === 0 && message.generation === generation && message.value?.ready === true);
    let sequence = 0;
    const rpc = async (command, input) => {
      const id = ++sequence; parent.send({ id, generation, command, ...(input ? { input } : {}) });
      const reply = await receive(message => message.id === id); assert.equal(reply.ok, true, reply.error + '\n' + messages.filter(message => message.event === 'diagnostic').map(message => message.text).join('')); return reply.value;
    };
    assert.deepEqual(await rpc('initialize'), { workerGroup: worker, generation });
    const owner = randomUUID(), sessionId = randomUUID();
    const result = await rpc('execute', { version: 1, owner, sessionId, actionId: randomUUID(), input: { action: 'observe', visual: 'never' } });
    assert.equal(result.result.ok, true); assert.equal(result.result.receipt.observation.url, 'about:blank');
    assert.deepEqual(result.result.receipt.observation.nodes, []);
    const rows = execFileSync('/bin/ps', ['-axo', 'pid=,ppid=,pgid='], { encoding: 'utf8' }).trim().split('\n').map(line => line.trim().split(/\s+/).map(Number));
    const owned = new Set([worker]); let changed = true;
    while (changed) { changed = false; for (const [pid, ppid] of rows) if (owned.has(ppid) && !owned.has(pid)) { owned.add(pid); changed = true; } }
    const descendants = rows.filter(([pid]) => owned.has(pid));
    item.descendants = descendants;
    assert(descendants.length >= 2, 'Expected the private Electron worker and its renderer descendants');
    assert(descendants.every(([, , pgid]) => pgid === worker), 'Every Browser descendant must share the owned process group');
    const started = performance.now();
    if (scenario === 'stop') parent.send({ id: ++sequence, generation, command: 'stop' });
    else parent.kill('SIGKILL');
    while (groupExists(worker) && performance.now() - started < 3000) await delay(20);
    assert.equal(groupExists(worker), false, 'Private Browser group survived the original three-second stop budget');
    Object.assign(item, { groupIsolationVerified: true, stopped: true, stopElapsedMs: performance.now() - started });
  }
  report.passed = true;
} catch (error) { report.error = String(error.stack ?? error); report.failureStateDirectory = root; process.exitCode = 1; }
finally {
  for (const parent of parents) if (parent.exitCode === null && parent.signalCode === null) parent.kill('SIGKILL');
  // Test-only live groups are retained on unconfirmed exit; never kill a persisted or arbitrary process identity.
  report.groupsStillPresent = groups.filter(groupExists).length;
  if (report.passed) await rm(root, { recursive: true, force: true });
  report.finishedAt = new Date().toISOString(); await writeFile(output, JSON.stringify(report, null, 2) + '\n'); console.log(JSON.stringify(report));
}
