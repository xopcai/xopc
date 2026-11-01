import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { REMOTE_COMPUTER_CONTROL_TOOL } from '@xopcai/computer-control-contract';
import { type DesktopOperationIntent } from '@xopcai/endpoint-tools-protocol';
import { expect, it, vi } from 'vitest';

import { DesktopComputerResources } from '../desktop/computer-resources.js';
import { createNativeComputerSession } from '../desktop/computer-native-session.js';

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'xopc-computer-resource-')), key = randomBytes(32);
  const encryption = { available: async () => true,
    encrypt: async (text: string) => { const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key, iv), bytes = Buffer.concat([cipher.update(text), cipher.final()]); return Buffer.concat([iv, cipher.getAuthTag(), bytes]); },
    decrypt: async (bytes: Buffer) => { const cipher = createDecipheriv('aes-256-gcm', key, bytes.subarray(0, 12)); cipher.setAuthTag(bytes.subarray(12, 28)); return Buffer.concat([cipher.update(bytes.subarray(28)), cipher.final()]).toString(); } };
  const intent: DesktopOperationIntent = { operationId: randomUUID(), gatewayId: randomUUID(), deviceId: randomUUID(), tool: REMOTE_COMPUTER_CONTROL_TOOL,
    argumentHash: 'a'.repeat(64), toolRevision: 'b'.repeat(64), authorizationRevision: 1, expiresAt: Date.now() + 30000 };
  const driver = { driverPid: process.pid + 10000, generation: randomUUID() };
  const alive = new Set([process.pid, driver.driverPid]), exists = vi.fn(pid => alive.has(pid));
  const resources = new DesktopComputerResources(root, encryption, exists);
  return { root, encryption, resources, exists, intent, driver, alive, close: () => rm(root, { recursive: true, force: true }) };
}
it('persists only encrypted identity metadata and never accepts a locator from another device or operation scope', async () => {
  const f = await fixture();
  try {
    await f.resources.prepare(f.intent, f.driver);
    expect(await f.resources.load(f.intent)).toMatchObject({ parentPid: process.pid, driver: f.driver, intent: f.intent });
    const bytes = await readFile(join(f.root, f.intent.operationId + '.bin'));
    expect(bytes.includes(Buffer.from(f.intent.deviceId))).toBe(false);
    expect(bytes.includes(Buffer.from(f.driver.generation))).toBe(false);
    await expect(f.resources.load({ ...f.intent, deviceId: randomUUID() })).rejects.toThrow('IDENTITY_MISMATCH');
    await expect(f.resources.prepare(f.intent, { ...f.driver, generation: randomUUID() })).rejects.toThrow('ALREADY_EXISTS');
    expect(await readFile(join(f.root, f.intent.operationId + '.bin'))).toEqual(bytes);
  } finally { await f.close(); }
});
it('requires both the old parent and its private driver to be absent, treating reused live PIDs conservatively', async () => {
  const f = await fixture();
  try {
    await f.resources.prepare(f.intent, f.driver);
    expect(await f.resources.recoverAfterParentExit(f.intent)).toBe(false);
    f.alive.delete(process.pid);
    expect(await f.resources.recoverAfterParentExit(f.intent)).toBe(false);
    f.alive.delete(f.driver.driverPid);
    expect(await f.resources.recoverAfterParentExit(f.intent)).toBe(true);
    f.alive.add(process.pid);
    expect(await f.resources.recoverAfterParentExit(f.intent)).toBe(false);
    f.exists.mockImplementationOnce(() => { throw Object.assign(new Error('fixture permission denied'), { code: 'EPERM' }); });
    await expect(f.resources.recoverAfterParentExit(f.intent)).rejects.toThrow('permission denied');
  } finally { await f.close(); }
});
it('serializes immutable preparation and rejects workspace, local Computer, malformed generation and missing metadata', async () => {
  const f = await fixture();
  try {
    const results = await Promise.allSettled([f.resources.prepare(f.intent, f.driver), f.resources.prepare(f.intent, f.driver)]);
    expect(results.map(result => result.status).sort()).toEqual(['fulfilled', 'rejected']);
    for (const input of [{ ...f.intent, workspaceId: randomUUID() }, { ...f.intent, tool: 'desktop.computer.control' }]) {
      expect(() => f.resources.prepare(input, f.driver)).toThrow();
    }
    expect(() => f.resources.prepare({ ...f.intent, operationId: randomUUID() }, { ...f.driver, generation: '../private/socket' })).toThrow();
    await expect(f.resources.recoverAfterParentExit({ ...f.intent, operationId: randomUUID() })).rejects.toMatchObject({ code: 'ENOENT' });
    const realProbe = new DesktopComputerResources(f.root, f.encryption);
    expect(await realProbe.recoverAfterParentExit(f.intent)).toBe(false);
  } finally { await f.close(); }
});
it('distinguishes death before the native dispatch barrier from a ready daemon that may still be running', async () => {
  const f = await fixture();
  try {
    await f.resources.begin(f.intent);
    expect(await f.resources.load(f.intent)).toMatchObject({ phase: 'preparing', parentPid: process.pid });
    expect(await f.resources.recoverAfterParentExit(f.intent)).toBe(false);
    f.alive.delete(process.pid);
    expect(await f.resources.recoverAfterParentExit(f.intent)).toBe(true);
    await f.resources.ready(f.intent, f.driver);
    expect(await f.resources.recoverAfterParentExit(f.intent)).toBe(false);
    f.alive.delete(f.driver.driverPid);
    expect(await f.resources.recoverAfterParentExit(f.intent)).toBe(true);
  } finally { await f.close(); }
});
it('commits parent identity before warmup and daemon identity before any Broker discovery, refusing metadata failure', async () => {
  const f = await fixture();
  const driver = { warmup: vi.fn(async () => { expect(await f.resources.load(f.intent)).toMatchObject({ phase: 'preparing' }); }),
    ownedProcessIdentity: () => f.driver, discover: vi.fn(async () => { expect(await f.resources.load(f.intent)).toMatchObject({ phase: 'ready', driver: f.driver }); return [{ appId: 'fixture', name: 'Fixture', running: true }]; }),
    resolveTarget: vi.fn(), observe: vi.fn(), perform: vi.fn(), validateAction: vi.fn(), stop: vi.fn(async () => {}) };
  const session = createNativeComputerSession({ driver, resources: f.resources, current: () => true, requestApproval: async () => false,
    uploadFrame: async () => { throw new Error('Unexpected frame'); } });
  try {
    const result = await session.worker(f.intent).run({ op: 'discover', owner: 'conversation', sessionId: 'discovery', query: '' }, new AbortController().signal);
    expect(result.status).toBe('succeeded'); expect(driver.discover).toHaveBeenCalledOnce();
    const next = { ...f.intent, operationId: randomUUID() };
    driver.warmup.mockImplementationOnce(async () => { throw new Error('fixture warmup failed'); });
    await expect(session.worker(next).run({ op: 'discover', owner: 'conversation', sessionId: 'discovery', query: '' }, new AbortController().signal)).rejects.toThrow('warmup failed');
    expect(driver.discover).toHaveBeenCalledOnce(); expect(driver.stop).toHaveBeenCalled();
    expect(await f.resources.load(next)).toMatchObject({ phase: 'preparing' });
  } finally { await session.stop(); await f.close(); }
});
