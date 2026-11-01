import { spawn, type ChildProcess } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, it } from 'vitest';

import { DesktopExecutionLease, DesktopOperationJournal } from '../../../electron/desktop/operation-journal.js';
import { DesktopOperationSupervisor } from '../../../electron/desktop/operation-supervisor.js';

for (const confirmed of [true, false]) it(`supervises an actual worker with executor stop confirmation ${confirmed}`, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'xopc-worker-supervision-'));
  const lease = new DesktopExecutionLease(directory), journal = new DesktopOperationJournal(lease);
  let child: ChildProcess | undefined;
  const started = Promise.withResolvers<void>();
  const authority = { active: true, gatewayId: randomUUID(), deviceId: randomUUID(), toolRevision: 'a'.repeat(64), authorizationRevision: 1, expiresAt: Date.now() + 10000 };
  const intent = { operationId: randomUUID(), gatewayId: authority.gatewayId, deviceId: authority.deviceId, toolRevision: authority.toolRevision,
    authorizationRevision: 1, tool: 'fixture.append', argumentHash: createHash('sha256').update('{}').digest('hex'), expiresAt: Date.now() + 2000 };
  try {
    const supervisor = new DesktopOperationSupervisor({ journal, authority: () => authority, createWorker: () => ({
      run: async () => {
        child = spawn(process.execPath, ['--import', 'tsx/esm', join(import.meta.dirname, 'fixtures/desktop-supervised-worker.mts'), directory], { stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
        child.once('message', message => { if (message === 'effect-recorded') started.resolve(); });
        const [code] = await once(child, 'exit'); return { status: code === 0 ? 'succeeded' : 'failed', result: { exitCode: code } };
      }, stop: async () => {
        if (!confirmed) return { confirmed: false };
        if (!child || child.exitCode !== null || child.signalCode !== null) return { confirmed: true };
        const exited = once(child, 'exit'); child.kill('SIGTERM'); await exited;
        return { confirmed: child.signalCode === 'SIGTERM' || child.exitCode !== null };
      },
    }) });
    const pending = supervisor.execute({ intent, arguments: {}, invocationId: randomUUID(), connectionInstanceId: randomUUID(), signal: new AbortController().signal });
    await started.promise;
    expect(journal.inspect(intent)?.state).toBe('running');
    // Confirmed case deliberately relies only on the local deadline watchdog.
    if (!confirmed) expect(await supervisor.stop()).toEqual({ state: 'unknown' });
    expect(await pending).toMatchObject({ receipt: { state: confirmed ? 'stopped' : 'unknown' } });
    expect(await readFile(join(directory, 'supervised-effect.txt'), 'utf8')).toBe('one-effect\n');
    if (!confirmed) {
      expect(child!.exitCode).toBeNull(); expect(child!.signalCode).toBeNull();
      expect(() => new DesktopExecutionLease(directory)).toThrow('DESKTOP_EXECUTOR_ALREADY_OWNED');
      expect(supervisor.status().blocked).toBe(true);
    }
  } finally {
    if (child && child.exitCode === null && child.signalCode === null) { const exited = once(child, 'exit'); child.kill('SIGKILL'); await exited; }
    journal.close(); lease.close(); await rm(directory, { recursive: true, force: true });
  }
}, 10000);
