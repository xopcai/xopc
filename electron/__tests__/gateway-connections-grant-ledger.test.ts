import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from 'node:crypto';
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, it } from 'vitest';

import { DesktopExecutionManager } from '../desktop/execution-manager.js';
import { DesktopExecutionGrantLedger } from '../desktop/execution-grant-ledger.js';

it('retains an encrypted immutable grant across restart and preserves interrupted files without admitting them as grants', async () => {
  const root = await mkdtemp(join(tmpdir(), 'xopc-grant-ledger-')), key = randomBytes(32);
  const encryption = { available: async () => true, encrypt: async (text: string) => {
    const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key, iv), data = Buffer.concat([cipher.update(text), cipher.final()]); return Buffer.concat([iv, cipher.getAuthTag(), data]);
  }, decrypt: async (bytes: Buffer) => {
    const cipher = createDecipheriv('aes-256-gcm', key, bytes.subarray(0, 12)); cipher.setAuthTag(bytes.subarray(12, 28)); return Buffer.concat([cipher.update(bytes.subarray(28)), cipher.final()]).toString();
  } };
  const binding = { profileId: randomUUID(), gatewayId: randomUUID(), publicKey: 'p'.repeat(100), origin: 'https://fixture.invalid' };
  const record = { version: 1 as const, binding, transport: 'direct' as const, deviceId: randomUUID(), authorizationRevision: 1,
    leaseGeneration: randomUUID(), parentPid: process.pid,
    grant: { version: 1 as const, grantId: randomUUID(), localApprovalId: randomUUID(), expiresAt: Date.now() + 120000, toolRevisions: { 'desktop.clipboard.write': 'a'.repeat(64) } } };
  try {
    let ledger = new DesktopExecutionGrantLedger(root, encryption);
    await ledger.save(record); await ledger.save(record);
    const file = join(root, record.grant.grantId + '.bin'), bytes = await readFile(file);
    expect(bytes.includes(Buffer.from(binding.gatewayId))).toBe(false); expect(bytes.includes(Buffer.from(record.leaseGeneration))).toBe(false);
    ledger = new DesktopExecutionGrantLedger(root, encryption);
    const interrupted = join(root, '.pending-' + randomUUID()); await writeFile(interrupted, 'interrupted');
    expect(await ledger.pending()).toEqual([record]); expect(await readFile(interrupted, 'utf8')).toBe('interrupted');
    await expect(ledger.save({ ...record, deviceId: randomUUID() })).rejects.toThrow('CONFLICT');
    await expect(ledger.close({ ...record, parentPid: process.pid + 1 })).rejects.toThrow('CONFLICT');
    expect(await readFile(file)).toEqual(bytes);
    await ledger.close(record); expect(await ledger.pending()).toEqual([]);
    await writeFile(join(root, randomUUID() + '.bin'), bytes);
    await expect(ledger.pending()).rejects.toThrow('IDENTITY_INVALID');
  } finally { await rm(root, { recursive: true, force: true }); }
});

it('leaves pure remote chat without an executor database when no durable grant exists', async () => {
  const root = await mkdtemp(join(tmpdir(), 'xopc-empty-grant-ledger-'));
  const executorRoot = join(root, 'executor');
  const encryption = { available: async () => { throw new Error('Secure storage must not be consulted'); },
    encrypt: async () => { throw new Error('No grant'); }, decrypt: async () => { throw new Error('No grant'); } };
  const execution = new DesktopExecutionManager({ executorRoot, grantLedger: new DesktopExecutionGrantLedger(join(executorRoot, 'grant-ledger'), encryption),
    stopOutbox: {} as never, manager: {} as never, store: {} as never, catalog: {} as never, appVersion: 'fixture', foreground: () => true,
    consent: async () => { throw new Error('No consent'); }, confirm: async () => { throw new Error('No confirmation'); }, createWorker: () => { throw new Error('No worker'); } });
  try { await execution.requireStopped(); await expect(access(executorRoot)).rejects.toMatchObject({ code: 'ENOENT' }); }
  finally { await rm(root, { recursive: true, force: true }); }
});
