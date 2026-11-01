import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, it } from 'vitest';

import { DesktopExecutionLease, DesktopOperationJournal } from '../../../electron/desktop/operation-journal.js';

it('releases the physical OS lock on process death but never repeats a side effect whose result was lost', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'xopc-execution-crash-'));
  const operation = { operationId: randomUUID(), gatewayId: randomUUID(), deviceId: randomUUID(), tool: 'fixture.append', argumentHash: 'a'.repeat(64), toolRevision: 'd'.repeat(64), authorizationRevision: 1, expiresAt: Date.now() + 60000 };
  const child = spawn(process.execPath, ['--import', 'tsx/esm', join(import.meta.dirname, 'fixtures/desktop-operation-crash.mts'), directory, JSON.stringify(operation)], { stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
  let output = ''; child.stderr!.on('data', chunk => { output += String(chunk); });
  let lease: DesktopExecutionLease | undefined, journal: DesktopOperationJournal | undefined;
  try {
    const message = await Promise.race([once(child, 'message'), once(child, 'exit').then(() => { throw new Error(output || 'Fixture exited before side effect'); })]);
    expect(message[0]).toBe('effect-complete-without-result');
    expect(() => new DesktopExecutionLease(directory)).toThrow('DESKTOP_EXECUTOR_ALREADY_OWNED');
    const exited = once(child, 'exit'); child.kill('SIGKILL'); await exited;
    lease = new DesktopExecutionLease(directory); journal = new DesktopOperationJournal(lease);
    expect(journal.record(operation)).toMatchObject({ fresh: false, receipt: { state: 'unknown' } });
    expect(() => journal!.start(operation, { invocationId: randomUUID(), connectionInstanceId: randomUUID() })).toThrow('DESKTOP_OPERATION_STATE_INVALID');
    expect(await readFile(join(directory, 'synthetic-effect.txt'), 'utf8')).toBe('one-effect\n');
  } finally {
    if (child.exitCode === null && child.signalCode === null) { const exited = once(child, 'exit'); child.kill('SIGKILL'); await exited; }
    journal?.close(); lease?.close(); await rm(directory, { recursive: true, force: true });
  }
}, 15000);
