import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { canonicalJson, type DesktopOperationIntent } from '@xopcai/endpoint-tools-protocol';
import { expect, it } from 'vitest';

import { DesktopWorkspaceRecoveryStore } from '../desktop/workspace-recovery.js';

it('persists encrypted file recovery location without contents, survives restart and rejects identity substitution or missing context', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'xopc-workspace-recovery-')), key = randomBytes(32);
  const encryption = {
    available: async () => true,
    encrypt: async (value: string) => { const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key, iv); return Buffer.concat([iv, cipher.update(value), cipher.final(), cipher.getAuthTag()]); },
    decrypt: async (value: Buffer) => { const cipher = createDecipheriv('aes-256-gcm', key, value.subarray(0, 12)); cipher.setAuthTag(value.subarray(-16)); return Buffer.concat([cipher.update(value.subarray(12, -16)), cipher.final()]).toString(); },
  };
  const args = { workspaceId: randomUUID(), relativePath: 'private-fixture.txt', text: 'never retain this body', expectedVersion: null };
  const intent: DesktopOperationIntent = { operationId: randomUUID(), gatewayId: randomUUID(), deviceId: randomUUID(), workspaceId: args.workspaceId,
    tool: 'desktop.workspace.write', toolRevision: 'b'.repeat(64), authorizationRevision: 1, expiresAt: Date.now() + 60000,
    argumentHash: createHash('sha256').update(canonicalJson(args)).digest('hex') };
  const root = { path: '/private/synthetic-location', device: '1', inode: '2' };
  try {
    const store = new DesktopWorkspaceRecoveryStore(directory, encryption);
    await expect(store.load(intent)).rejects.toThrow('CONTEXT_UNAVAILABLE');
    await expect(store.save(intent, { ...args, text: 'changed' }, root)).rejects.toThrow('IDENTITY_MISMATCH');
    await store.save(intent, args, root);
    const names = await readdir(directory); expect(names).toEqual([intent.operationId + '.bin']);
    const bytes = await readFile(join(directory, names[0]));
    expect(bytes.includes(Buffer.from(root.path))).toBe(false);
    expect(bytes.includes(Buffer.from(args.text))).toBe(false);
    const decrypted = await encryption.decrypt(bytes);
    expect(decrypted).not.toContain(args.text);
    const restored = await new DesktopWorkspaceRecoveryStore(directory, encryption).load(intent);
    expect(restored).toMatchObject({ root, relativePath: args.relativePath, workspaceId: args.workspaceId });
    await expect(store.load({ ...intent, deviceId: randomUUID() })).rejects.toThrow('CONTEXT_UNAVAILABLE');
    await expect(store.load({ ...intent, argumentHash: 'a'.repeat(64) })).rejects.toThrow('CONTEXT_UNAVAILABLE');
    await writeFile(join(directory, names[0]), bytes.subarray(0, 15));
    await expect(store.load(intent)).rejects.toThrow('CONTEXT_UNAVAILABLE');
    const unavailable = new DesktopWorkspaceRecoveryStore(directory, { ...encryption, available: async () => false });
    await expect(unavailable.save(intent, args, root)).rejects.toThrow('SECURE_STORAGE_UNAVAILABLE');
  } finally { await rm(directory, { recursive: true, force: true }); }
});
