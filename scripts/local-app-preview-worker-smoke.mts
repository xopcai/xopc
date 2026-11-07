/** Verify the separately bundled Electron worker without opening the production database. */
import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { createProductDispatcher } from '../src/capabilities/runtime/product.js';
import { NotesService } from '../src/notes/service.js';

const file = resolve('out/server/preview-worker.js'); assert.ok(existsSync(file), 'Build the Electron server first');
const root = mkdtempSync(join(tmpdir(), 'xopc-packaged-preview-'));
const runs = join(root, 'local-apps', 'preview-runs'); mkdirSync(runs, { recursive: true });
const directory = mkdtempSync(join(runs, 'run-'));
const worker = fork(file, [], { execArgv: ['--max-old-space-size=192'], cwd: directory, stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
  env: { PATH: process.env.PATH, XOPC_LOCAL_APP_PREVIEW_WORKER: '1', XOPC_STATE_DIR: directory, XOPC_LOG_LEVEL: 'fatal', ELECTRON_RUN_AS_NODE: '1' } });
let stderr = ''; worker.stderr?.on('data', data => { stderr = (stderr + data).slice(-4000); });
async function rpc(payload: Record<string, unknown>): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const requestId = crypto.randomUUID();
    const cleanup = () => { clearTimeout(timer); worker.off('message', receive); worker.off('exit', exited); };
    const exited = () => { cleanup(); reject(new Error(`Worker exited: ${stderr}`)); };
    const receive = (message: { requestId: string; data?: unknown; error?: unknown }) => {
      if (message.requestId !== requestId) return; cleanup();
      if (message.error) reject(new Error(JSON.stringify(message.error))); else resolve(message.data);
    };
    const timer = setTimeout(() => { cleanup(); reject(new Error(`Worker timed out: ${stderr}`)); }, 15000);
    worker.on('message', receive); worker.once('exit', exited); worker.send({ ...payload, requestId });
  });
}
try {
  const dispatcher = createProductDispatcher(() => new NotesService());
  const descriptor = dispatcher.describe('xopc.notes.create', { principalId: 'test', surface: 'extension', scopes: ['gateway.admin'], authorize: () => true });
  const { id, majorVersion, descriptorDigest } = descriptor;
  await rpc({ type: 'init', bindings: [{ id, majorVersion, descriptorDigest }], fixtures: { schemaVersion: 1, notes: [], tasks: [] } });
  const result = await rpc({ type: 'call', id, call: { majorVersion, descriptorDigest, idempotencyKey: 'packaged-write', input: { title: 'Packaged example' } } });
  assert.equal((result as { note: { title: string } }).note.title, 'Packaged example');
  console.log('PASS: bundled worker opens its own schema, runs a real write capability and returns the narrow result.');
} finally {
  if (worker.exitCode === null && worker.signalCode === null) {
    const exited = new Promise<void>(resolve => worker.once('exit', () => resolve())); worker.kill('SIGTERM');
    const timer = setTimeout(() => worker.kill('SIGKILL'), 1000); await exited; clearTimeout(timer);
  }
  rmSync(root, { recursive: true, force: true });
}
