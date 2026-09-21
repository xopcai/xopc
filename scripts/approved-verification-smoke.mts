/** Opt-in real Docker verification; uses only synthetic files and an already installed image. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { removeCommandContainer } from '../src/agent/commands/command-isolation.js';
import { runProcess } from '../src/process/run-process.js';
import { verifyTaskWorkspace } from '../src/agent/commands/approved-verification.js';

const image = process.env.XOPC_SCENE_TEST_IMAGE;
assert.ok(image && /@sha256:[a-f0-9]{64}$/.test(image), 'Set XOPC_SCENE_TEST_IMAGE to an installed digest-pinned Node image');
const workspace = mkdtempSync(join(tmpdir(), 'xopc-development-docker-'));
const executions: string[] = [];
const verify = (command: string, signal = AbortSignal.timeout(30_000), executionId = randomUUID()) => {
  executions.push(executionId);
  return verifyTaskWorkspace({ workspace, image, command, signal, executionId, guard: () => signal.throwIfAborted() });
};
const inspect = (id: string) => runProcess({ program: 'docker', args: ['container', 'inspect', '--format', '{{.State.Running}}', `xopc-command-${id}`],
  timeoutMs: 5000, maxOutputBytes: 1000 });

try {
  writeFileSync(join(workspace, 'app.cjs'), 'module.exports = (a, b) => a + b;\n');
  writeFileSync(join(workspace, '.env'), 'SYNTHETIC_ONLY=must-not-be-visible\n');
  writeFileSync(join(workspace, 'app.test.cjs'), `
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
test('project behavior', () => assert.equal(require('./app.cjs')(2, 3), 5));
test('source mount is read-only', () => assert.throws(() => fs.writeFileSync('/workspace/app.cjs', 'corrupted'), { code: 'EROFS' }));
test('credentials are masked', () => assert.equal(fs.readFileSync('/workspace/.env', 'utf8'), ''));
test('network is disabled', () => assert.ok(Object.values(os.networkInterfaces()).flat().every(address => address.internal)));
test('temporary output is writable', () => { fs.writeFileSync('/tmp/result', 'ok'); assert.equal(fs.readFileSync('/tmp/result', 'utf8'), 'ok'); });
`);
  const passing = await verify('node --test app.test.cjs');
  assert.equal(passing.passed, true, passing.output);
  assert.equal(readFileSync(join(workspace, 'app.cjs'), 'utf8'), 'module.exports = (a, b) => a + b;\n');
  writeFileSync(join(workspace, 'app.cjs'), 'module.exports = (a, b) => a - b;\n');
  const failing = await verify('node --test app.test.cjs');
  assert.equal(failing.passed, false);
  assert.match(failing.output, /not ok/);

  const controller = new AbortController();
  const executionId = randomUUID();
  const interrupted = verify('node -e "setInterval(() => {}, 1000)"', controller.signal, executionId)
    .then(() => ({ rejected: false }), () => ({ rejected: true }));
  try {
    let running = false;
    for (let attempt = 0; attempt < 30; attempt++) {
      const state = await inspect(executionId);
      if (state.exitCode === 0 && state.stdout.trim() === 'true') { running = true; break; }
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    assert.equal(running, true, 'Verification container did not start');
  } finally { controller.abort(); }
  assert.equal((await interrupted).rejected, true);
  for (const id of executions) assert.notEqual((await inspect(id)).exitCode, 0, 'Verification container was left running');
  console.log(JSON.stringify({ passed: true, image, checks: ['real project test pass', 'test failure is not certified',
    'read-only source', 'credential masking', 'network disabled', 'temporary output', 'abort and container cleanup'] }));
} finally {
  for (const id of executions) await removeCommandContainer(`xopc-command-${id}`);
  rmSync(workspace, { recursive: true, force: true });
}
