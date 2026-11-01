import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { REMOTE_BROWSER_CONTROL_TOOL } from '@xopcai/browser-control-contract/remote';
import { expect, it, vi } from 'vitest';

import { DesktopBrowserResources } from '../desktop/browser-resources.js';

it('commits encrypted immutable barriers and requires the parent and entire private process group to be absent', async () => {
  const root = await mkdtemp(join(tmpdir(), 'xopc-browser-resources-')), key = randomBytes(32);
  const encryption = { available: async () => true, encrypt: async (text: string) => {
    const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key, iv), bytes = Buffer.concat([cipher.update(text), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), bytes]);
  }, decrypt: async (bytes: Buffer) => {
    const cipher = createDecipheriv('aes-256-gcm', key, bytes.subarray(0, 12)); cipher.setAuthTag(bytes.subarray(12, 28));
    return Buffer.concat([cipher.update(bytes.subarray(28)), cipher.final()]).toString();
  } };
  const intent = { operationId: randomUUID(), gatewayId: randomUUID(), deviceId: randomUUID(), tool: REMOTE_BROWSER_CONTROL_TOOL,
    argumentHash: 'a'.repeat(64), toolRevision: 'b'.repeat(64), authorizationRevision: 1, expiresAt: Date.now() + 30000 };
  const identity = { workerGroup: process.pid + 100000, generation: randomUUID() }, alive = new Set([process.pid, -identity.workerGroup]);
  const exists = vi.fn((pid: number) => alive.has(pid));
  const resources = new DesktopBrowserResources(root, encryption, exists);
  try {
    await resources.begin(intent); expect(await resources.recoverAfterParentExit(intent)).toBe(false);
    alive.delete(process.pid); expect(await resources.recoverAfterParentExit(intent)).toBe(true);
    await resources.ready(intent, identity); expect(await resources.recoverAfterParentExit(intent)).toBe(false);
    const bytes = await readFile(join(root, intent.operationId + '.bin'));
    expect(bytes.includes(Buffer.from(intent.deviceId))).toBe(false); expect(bytes.includes(Buffer.from(identity.generation))).toBe(false);
    alive.delete(-identity.workerGroup); expect(await resources.recoverAfterParentExit(intent)).toBe(true);
    alive.add(-identity.workerGroup); expect(await resources.recoverAfterParentExit(intent)).toBe(false);
    await expect(resources.ready(intent, identity)).rejects.toThrow('ALREADY_EXISTS');
    await expect(resources.begin(intent)).rejects.toThrow('ALREADY_EXISTS');
    await expect(resources.recoverAfterParentExit({ ...intent, deviceId: randomUUID() })).rejects.toThrow('IDENTITY_MISMATCH');
    expect(() => resources.ready(intent, { ...identity, generation: '../wrong' })).toThrow();
    exists.mockImplementationOnce(() => { throw Object.assign(new Error('permission denied'), { code: 'EPERM' }); });
    await expect(resources.recoverAfterParentExit(intent)).rejects.toThrow('permission denied');
    expect(await readFile(join(root, intent.operationId + '.bin'))).toEqual(bytes);
  } finally { await rm(root, { recursive: true, force: true }); }
});
