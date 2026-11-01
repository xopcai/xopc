import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, it, vi } from 'vitest';

import { RemoteFileSnapshots } from '../files/remote-snapshots.js';

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'xopc-remote-snapshot-')), key = randomBytes(32);
  const encryption = {
    available: async () => true,
    encrypt: async (text: string) => { const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key, iv); return Buffer.concat([iv, cipher.update(text), cipher.final(), cipher.getAuthTag()]); },
    decrypt: async (value: Buffer) => { const cipher = createDecipheriv('aes-256-gcm', key, value.subarray(0, 12)); cipher.setAuthTag(value.subarray(-16)); return Buffer.concat([cipher.update(value.subarray(12, -16)), cipher.final()]).toString(); },
  };
  const namespace = { profileId: randomUUID(), gatewayId: randomUUID(), publicKey: 'synthetic-key-'.repeat(8) };
  const resource = { id: 'space.ZmlsZS50eHQ', spaceId: 'space', name: 'file.txt', relativePath: 'file.txt', parentPath: '', kind: 'file' as const,
    mimeType: 'text/plain', size: 8, modifiedAt: 1, revision: 'v1', capabilities: ['edit' as const] };
  const transport = { read: vi.fn(async () => ({ resource: { ...resource }, text: 'original', etag: 'v1' })),
    put: vi.fn(async (_id: string, text: string, _revision: string, _signal: AbortSignal) => ({ status: 'saved' as const, resource: { ...resource, size: Buffer.byteLength(text), revision: 'v2' } })) };
  let current = true;
  const confirm = vi.fn(async () => true);
  const create = (scope = namespace) => new RemoteFileSnapshots({ root, namespace: scope, encryption, transport, current: () => current, confirm });
  return { root, namespace, resource, transport, confirm, create, invalidate: () => { current = false; }, restore: () => { current = true; }, cleanup: () => rm(root, { recursive: true, force: true }) };
}
it('encrypts downloaded snapshots and drafts; sends only explicit confirmed versioned uploads and isolates Gateway identities', async () => {
  const f = await fixture();
  try {
    const store = f.create(), doc = await store.download(f.resource.id);
    expect(doc.state).toBe('clean'); expect(f.transport.put).not.toHaveBeenCalled();
    const directory = join(f.root, (await readdir(f.root))[0]);
    expect((await readFile(join(directory, doc.id + '.bin'))).includes(Buffer.from('original'))).toBe(false);
    await store.edit(doc.id, 'edited text');
    expect((await f.create().get(doc.id)).text).toBe('edited text');
    expect(await f.create({ ...f.namespace, gatewayId: randomUUID() }).list()).toEqual([]);
    f.confirm.mockResolvedValueOnce(false);
    await expect(store.upload(doc.id)).rejects.toThrow('USER_DENIED'); expect(f.transport.put).not.toHaveBeenCalled();
    const saved = await store.upload(doc.id); expect(saved).toMatchObject({ state: 'clean', resource: { revision: 'v2' } });
    expect(f.transport.put).toHaveBeenCalledWith(f.resource.id, 'edited text', 'v1', expect.any(AbortSignal));
    await expect(store.upload(doc.id)).rejects.toThrow('NOT_DIRTY'); expect(f.transport.put).toHaveBeenCalledTimes(1);
  } finally { await f.cleanup(); }
});
it('preserves a draft on conflict and never retries an uncertain upload after restart', async () => {
  const f = await fixture();
  try {
    const store = f.create(), doc = await store.download(f.resource.id); await store.edit(doc.id, 'edited');
    f.transport.put.mockResolvedValueOnce({ status: 'conflict' } as any);
    expect(await store.upload(doc.id)).toMatchObject({ state: 'conflict', text: 'edited', resource: { revision: 'v1' } });
    await store.edit(doc.id, 'another edit');
    f.transport.put.mockRejectedValueOnce(new Error('Lost reply after server mutation'));
    await expect(store.upload(doc.id)).rejects.toThrow('OUTCOME_UNKNOWN');
    const restarted = f.create(); expect(await restarted.get(doc.id)).toMatchObject({ state: 'unknown', text: 'another edit' });
    await expect(restarted.edit(doc.id, 'retry')).rejects.toThrow('OUTCOME_UNKNOWN');
    await expect(restarted.upload(doc.id)).rejects.toThrow('OUTCOME_UNKNOWN');
    expect(f.transport.put).toHaveBeenCalledTimes(2);
  } finally { await f.cleanup(); }
});
it('rejects version changes, unsafe ids, oversize data and late approval after a connection switch', async () => {
  const f = await fixture();
  try {
    const store = f.create();
    await expect(store.download('../../local')).rejects.toThrow('ID_INVALID'); expect(f.transport.read).not.toHaveBeenCalled();
    f.transport.read.mockResolvedValueOnce({ resource: f.resource, text: 'original', etag: 'changed' });
    await expect(store.download(f.resource.id)).rejects.toThrow('SNAPSHOT_CHANGED');
    const doc = await store.download(f.resource.id); await expect(store.edit(doc.id, '界'.repeat(32768))).rejects.toThrow();
    await store.edit(doc.id, 'edited'); f.confirm.mockImplementationOnce(async () => { f.invalidate(); return true; });
    await expect(store.upload(doc.id)).rejects.toThrow('STALE_CONNECTION_EPOCH'); expect(f.transport.put).not.toHaveBeenCalled();
    f.restore(); expect(await f.create().get(doc.id)).toMatchObject({ state: 'dirty' });
  } finally { await f.cleanup(); }
});
it('durably marks an interrupted upload unknown before allowing restored cache access', async () => {
  const f = await fixture();
  try {
    const store = f.create(), doc = await store.download(f.resource.id); await store.edit(doc.id, 'edited');
    f.transport.put.mockImplementationOnce(async () => { f.invalidate(); throw new Error('connection switched while uploading'); });
    await expect(store.upload(doc.id)).rejects.toThrow('OUTCOME_UNKNOWN');
    f.restore(); const restarted = f.create();
    expect(await restarted.get(doc.id)).toMatchObject({ state: 'unknown' });
    await expect(restarted.upload(doc.id)).rejects.toThrow('OUTCOME_UNKNOWN'); expect(f.transport.put).toHaveBeenCalledOnce();
  } finally { await f.cleanup(); }
});
