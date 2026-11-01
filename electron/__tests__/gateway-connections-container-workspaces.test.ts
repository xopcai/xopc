import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, it, vi } from 'vitest';

import { DesktopContainerSession } from '../desktop/container-session.js';
import { DesktopContainerWorkspaces } from '../desktop/container-workspaces.js';
import type { DesktopContainerEngine } from '../desktop/container-engine.js';
import type { DesktopContainerResources } from '../desktop/container-resources.js';

it('retains encrypted data identity across restart without sharing it across Gateway identities or overwriting a workspace', async () => {
  const root = await mkdtemp(join(tmpdir(), 'xopc-container-registry-')), key = randomBytes(32);
  const encryption = {
    available: async () => true,
    encrypt: async (text: string) => { const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key, iv); return Buffer.concat([iv, cipher.update(text), cipher.final(), cipher.getAuthTag()]); },
    decrypt: async (value: Buffer) => { const cipher = createDecipheriv('aes-256-gcm', key, value.subarray(0, 12)); cipher.setAuthTag(value.subarray(-16)); return Buffer.concat([cipher.update(value.subarray(12, -16)), cipher.final()]).toString(); },
  };
  const binding = { profileId: randomUUID(), gatewayId: randomUUID(), origin: 'https://fixture.invalid', publicKey: 'a'.repeat(100) };
  const input = { socketPath: '/private/fixture.sock', engineId: 'fixture-engine', imageId: 'sha256:' + 'a'.repeat(64), label: 'private fixture workspace' };
  try {
    const first = new DesktopContainerWorkspaces(root, encryption), record = await first.create(binding, input);
    const restarted = new DesktopContainerWorkspaces(root, encryption);
    expect(await restarted.list(binding)).toEqual([record]);
    for (const changed of [{ gatewayId: randomUUID() }, { profileId: randomUUID() }, { origin: 'https://other.invalid' }, { publicKey: 'b'.repeat(100) }]) {
      expect(await restarted.list({ ...binding, ...changed })).toEqual([]);
      await expect(restarted.load({ ...binding, ...changed }, record.workspaceId)).rejects.toThrow();
    }
    await expect(restarted.create(binding, input, record)).rejects.toThrow('ALREADY_RECORDED');
    expect(await restarted.load(binding, record.workspaceId)).toEqual(record);
    const directory = join(root, (await readdir(root))[0]);
    expect((await readFile(join(directory, record.workspaceId + '.bin'))).includes(Buffer.from(input.label))).toBe(false);
    await expect(restarted.load(binding, '../escape')).rejects.toThrow();
    const unavailable = new DesktopContainerWorkspaces(root, { ...encryption, available: async () => false });
    await expect(unavailable.load(binding, record.workspaceId)).rejects.toThrow('SECURE_STORAGE_UNAVAILABLE');
  } finally { await rm(root, { recursive: true, force: true }); }
});

it('requires fresh authorization and never recreates missing retained data or authorizes a cancelled session', async () => {
  const engine = { ensureWorkspace: vi.fn(async () => 'volume'), checkWorkspace: vi.fn(async () => { throw new Error('DESKTOP_CONTAINER_WORKSPACE_UNAVAILABLE'); }) };
  const retained = { workspaceId: randomUUID(), ownerId: randomUUID(), existing: true, persist: vi.fn(async () => {}) };
  let current = true;
  const session = new DesktopContainerSession(engine as unknown as DesktopContainerEngine, 'sha256:' + 'a'.repeat(64), {} as DesktopContainerResources, () => current, retained);
  expect(engine.checkWorkspace).not.toHaveBeenCalled();
  await expect(session.authorizeWorkspace(new AbortController().signal)).rejects.toThrow('WORKSPACE_UNAVAILABLE');
  expect(engine.ensureWorkspace).not.toHaveBeenCalled();
  const cancelled = new AbortController(); cancelled.abort();
  await expect(session.authorizeWorkspace(cancelled.signal)).rejects.toThrow();
  expect(retained.persist).toHaveBeenCalledOnce();
  current = false;
  await expect(session.authorizeWorkspace(new AbortController().signal)).rejects.toThrow('AUTHORITY_INVALID');
  expect(engine.checkWorkspace).toHaveBeenCalledOnce();
});
