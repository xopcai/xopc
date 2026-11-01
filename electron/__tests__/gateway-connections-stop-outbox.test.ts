import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, it, vi } from 'vitest';

import { DesktopExecutionStopOutbox } from '../desktop/execution-stop-outbox.js';

it('persists only encrypted stop-only receipts, isolates Gateway identity and removes an item only after a verified acknowledgement', async () => {
  const root = await mkdtemp(join(tmpdir(), 'xopc-stop-outbox-')), key = randomBytes(32);
  const encryption = { available: async () => true, encrypt: async (text: string) => {
    const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key, iv), data = Buffer.concat([cipher.update(text), cipher.final()]); return Buffer.concat([iv, cipher.getAuthTag(), data]);
  }, decrypt: async (bytes: Buffer) => {
    const cipher = createDecipheriv('aes-256-gcm', key, bytes.subarray(0, 12)); cipher.setAuthTag(bytes.subarray(12, 28)); return Buffer.concat([cipher.update(bytes.subarray(28)), cipher.final()]).toString();
  } };
  const binding = { profileId: randomUUID(), gatewayId: randomUUID(), publicKey: 'p'.repeat(100), origin: 'https://fixture.invalid' };
  const signed = { receipt: { version: 1 as const, stopId: randomUUID(), gatewayId: binding.gatewayId, deviceId: randomUUID(), grantId: randomUUID(), authorizationRevision: 1,
    leaseGeneration: randomUUID(), executionStopped: true as const }, signature: 'a'.repeat(86) };
  try {
    let outbox = new DesktopExecutionStopOutbox(root, encryption);
    await outbox.save(binding, signed); await outbox.save(binding, signed);
    const bytes = await readFile(join(root, signed.receipt.stopId + '.bin'));
    expect(bytes.includes(Buffer.from(binding.gatewayId))).toBe(false); expect(bytes.includes(Buffer.from(signed.signature))).toBe(false);
    outbox = new DesktopExecutionStopOutbox(root, encryption);
    const interrupted = join(root, '.pending-' + randomUUID()); await writeFile(interrupted, 'interrupted atomic write');
    expect(await outbox.pending(binding)).toEqual([signed]);
    expect(await readFile(interrupted, 'utf8')).toBe('interrupted atomic write');
    expect(await outbox.pending({ ...binding, gatewayId: randomUUID() })).toEqual([]);
    expect(await outbox.pending({ ...binding, publicKey: 'q'.repeat(100) })).toEqual([]);
    const submitExecutionStop = vi.fn(async () => { throw new Error('Lost acknowledgement'); });
    expect(await outbox.flush(binding, { submitExecutionStop } as never)).toEqual({ confirmed: 0, pending: 1 });
    expect(await outbox.pending(binding)).toEqual([signed]);
    await expect(outbox.confirm({ ...signed, signature: 'b'.repeat(86) })).rejects.toThrow('CONFLICT');
    submitExecutionStop.mockResolvedValue(undefined as never);
    expect(await outbox.flush({ ...binding, profileId: randomUUID(), origin: 'https://new-fixture.invalid' }, { submitExecutionStop } as never)).toEqual({ confirmed: 1, pending: 0 });
    expect(await outbox.pending(binding)).toEqual([]);
    expect(submitExecutionStop).toHaveBeenCalledTimes(2);
    await expect(outbox.save({ ...binding, gatewayId: randomUUID() }, signed)).rejects.toThrow();
  } finally { await rm(root, { recursive: true, force: true }); }
});
