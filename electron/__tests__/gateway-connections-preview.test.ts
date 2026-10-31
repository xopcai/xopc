import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { IpcMain, IpcMainInvokeEvent, WebContents } from 'electron';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { GatewayConnectionPreview } from '../gateway/connection-manager.js';
import { ConnectionCredentialStore, type ConnectionEncryption } from '../gateway/credentials.js';
import { ConnectionProfileStore, parseRemoteProfile } from '../gateway/profiles.js';
import { CONNECTION_CHANNELS, ConnectionWindowPolicy, installConnectionIpcBoundary } from '../gateway/restricted-ipc.js';

const id = randomUUID();
const input = { name: 'Server', origin: 'https://example.com', transport: 'direct' };
let root: string;
let store: ConnectionProfileStore;
let credentials: ConnectionCredentialStore;
let encryption: ConnectionEncryption;
let manager: GatewayConnectionPreview;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'xopc-connection-tests-'));
  const key = randomBytes(32);
  encryption = {
    available: vi.fn(async () => true),
    encrypt: vi.fn(async text => {
      const nonce = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key, nonce);
      const body = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
      return Buffer.concat([nonce, cipher.getAuthTag(), body]);
    }),
    decrypt: vi.fn(async bytes => {
      const cipher = createDecipheriv('aes-256-gcm', key, bytes.subarray(0, 12));
      cipher.setAuthTag(bytes.subarray(12, 28));
      return Buffer.concat([cipher.update(bytes.subarray(28)), cipher.final()]).toString('utf8');
    }),
  };
  store = new ConnectionProfileStore(root);
  credentials = new ConnectionCredentialStore(join(root, 'credentials'), encryption);
  manager = new GatewayConnectionPreview(store, credentials);
  await manager.initialize();
});
afterEach(async () => { await rm(root, { recursive: true, force: true }); vi.useRealTimers(); });

describe('remote connection preview', () => {
  it.each(['http://example.com', 'https://user:secret@example.com', 'https://example.com/path',
    'https://example.com/a/..', 'https://example.com?token=abc', 'https://example.com/#chat', 'file:///tmp/a'])('rejects unsafe origin %s', origin => {
    expect(() => parseRemoteProfile({ ...input, id, mode: 'remote', origin })).toThrow();
  });
  it('keeps SSH logically remote and permits only explicit loopback HTTP', () => {
    expect(parseRemoteProfile({ ...input, id, mode: 'remote', transport: 'ssh', origin: 'http://127.0.0.1:5432' }).mode).toBe('remote');
    for (const origin of ['http://example.com', 'http://0.0.0.0:42', 'http://127.1:42', 'https://localhost']) {
      expect(() => parseRemoteProfile({ ...input, id, mode: 'remote', transport: 'ssh', origin })).toThrow();
    }
  });
  it('persists no raw credential or claimed Gateway identity and never becomes ready', async () => {
    const saved = await manager.save(0, { ...input, credential: 'test-secret' });
    expect(saved).toMatchObject({ epoch: 1, localCapabilities: false, status: 'unselected' });
    expect(JSON.stringify(saved)).not.toMatch(/test-secret|credentialRef|gatewayId/);
    const disk = await readFile(join(root, 'profiles.json'), 'utf8');
    expect(disk).not.toContain('test-secret');
    const profile = (await store.load())[0];
    const encrypted = await readFile(join(root, 'credentials', `${profile.credentialRef}.bin`));
    expect(encrypted.includes(Buffer.from('test-secret'))).toBe(false);
    expect(await manager.select(1, saved.profiles[0].id)).toMatchObject({ epoch: 2, status: 'remote-chat-unavailable' });
    const restarted = new GatewayConnectionPreview(store, credentials);
    await restarted.initialize();
    expect(restarted.snapshot()).toMatchObject({ status: 'unselected', epoch: 0, profiles: [{ hasCredential: true }] });
  });
  it('pins only a main-process verified identity, retains it on same-origin edits and rejects replacement', async () => {
    const saved = await manager.save(0, { ...input, credential: 'secret' });
    const id = saved.profiles[0].id;
    const identity = { gatewayId: randomUUID(), publicKey: 'p'.repeat(100) };
    const pinned = await manager.pinIdentity(1, id, identity);
    expect(pinned.epoch).toBe(2);
    await expect(manager.pinIdentity(2, id, { ...identity, gatewayId: randomUUID() })).rejects.toThrow('GATEWAY_IDENTITY_CHANGED');
    expect((await manager.privateConnection(2, id)).token).toBe('secret');
    expect(JSON.stringify(pinned)).not.toMatch(/secret|credentialRef/);
    await manager.save(2, { ...input, id, name: 'Renamed' });
    expect((await store.load())[0].identity).toEqual(identity);
    expect(JSON.parse(await readFile(join(root, 'profiles.json'), 'utf8')).version).toBe(2);
    await manager.save(3, { ...input, id, origin: 'https://other.example.com' });
    expect((await store.load())[0].identity).toBeUndefined();
    await expect(manager.privateConnection(4, id)).rejects.toThrow('REMOTE_CREDENTIAL_REQUIRED');
  });
  it('does not inherit credentials after changing destination', async () => {
    const saved = await manager.save(0, { ...input, credential: 'old-secret' });
    await manager.save(1, { ...input, id: saved.profiles[0].id, origin: 'https://other.example.com' });
    expect(manager.snapshot().profiles[0].hasCredential).toBe(false);
    expect(await readdir(join(root, 'credentials'))).toEqual([]);
  });
  it('removes selected metadata and encrypted credentials without reusing its epoch', async () => {
    const saved = await manager.save(0, { ...input, credential: 'secret' });
    await manager.select(1, saved.profiles[0].id);
    expect(await manager.remove(2, saved.profiles[0].id)).toMatchObject({ status: 'unselected', epoch: 3, profiles: [] });
    expect(await readdir(join(root, 'credentials'))).toEqual([]);
    await expect(manager.select(2, saved.profiles[0].id)).rejects.toThrow('STALE_CONNECTION_EPOCH');
  });
  it('serializes competing changes and rejects the queued stale epoch', async () => {
    const [a, b] = await Promise.allSettled([manager.save(0, input), manager.save(0, { ...input, name: 'Other' })]);
    expect(a.status).toBe('fulfilled');
    expect(b).toMatchObject({ status: 'rejected', reason: new Error('STALE_CONNECTION_EPOCH') });
    expect(manager.snapshot().profiles).toHaveLength(1);
  });
  it('fails closed without encryption and leaves no partial profile', async () => {
    vi.mocked(encryption.available).mockResolvedValue(false);
    await expect(manager.save(0, { ...input, credential: 'secret' })).rejects.toThrow('SECURE_STORAGE_UNAVAILABLE');
    expect(manager.snapshot().epoch).toBe(0);
    expect(await store.load()).toEqual([]);
  });
  it('bounds encryption waits and ignores a late encryption completion', async () => {
    vi.useFakeTimers();
    let resolve!: (value: Buffer) => void;
    vi.mocked(encryption.encrypt).mockImplementation(() => new Promise(r => { resolve = r; }));
    const save = manager.save(0, { ...input, credential: 'secret' });
    const rejected = expect(save).rejects.toThrow('CONNECTION_STORAGE_TIMEOUT_RESTART_REQUIRED');
    await vi.advanceTimersByTimeAsync(15_001);
    await rejected;
    resolve(Buffer.from('late'));
    await Promise.resolve();
    expect(await store.load()).toEqual([]);
    expect(manager.snapshot().epoch).toBe(0);
    expect(manager.snapshot().status).toBe('storage-error');
    await expect(manager.save(0, input)).rejects.toThrow('PROFILE_STORAGE_UNAVAILABLE');
  });
  it('rejects an undecryptable credential before selection', async () => {
    const saved = await manager.save(0, { ...input, credential: 'secret' });
    vi.mocked(encryption.decrypt).mockRejectedValue(new Error('sensitive OS detail'));
    await expect(manager.select(1, saved.profiles[0].id)).rejects.toThrow('CREDENTIAL_UNAVAILABLE');
    expect(manager.snapshot().selectedId).toBeUndefined();
  });
  it('removes a newly encrypted orphan when the profile commit fails', async () => {
    vi.spyOn(store, 'save').mockRejectedValue(new Error('disk full'));
    await expect(manager.save(0, { ...input, credential: 'secret' })).rejects.toThrow('disk full');
    expect(await readdir(join(root, 'credentials'))).toEqual([]);
    expect(manager.snapshot().profiles).toEqual([]);
  });
  it('reaps a credential orphaned by a crash without dropping a referenced one', async () => {
    await manager.save(0, { ...input, credential: 'referenced' });
    await credentials.put('orphaned-before-profile-commit');
    expect(await readdir(join(root, 'credentials'))).toHaveLength(2);
    await new GatewayConnectionPreview(store, credentials).initialize();
    expect(await readdir(join(root, 'credentials'))).toHaveLength(1);
    await credentials.verify((await store.load())[0].credentialRef!);
  });
  it('preserves corrupt configuration and offers an error state rather than overwriting', async () => {
    await writeFile(join(root, 'profiles.json'), '{bad');
    await manager.initialize();
    expect(manager.snapshot().status).toBe('storage-error');
    await expect(manager.save(0, input)).rejects.toThrow('PROFILE_STORAGE_UNAVAILABLE');
    expect(await readFile(join(root, 'profiles.json'), 'utf8')).toBe('{bad');
  });
  it('rejects oversized and duplicate persisted state', async () => {
    await writeFile(join(root, 'profiles.json'), 'x'.repeat(128 * 1024 + 1));
    await expect(store.load()).rejects.toThrow('CONNECTION_STORAGE_TOO_LARGE');
    const profile = { ...input, id, mode: 'remote' };
    await writeFile(join(root, 'profiles.json'), JSON.stringify({ version: 1, profiles: [profile, profile] }));
    await expect(store.load()).rejects.toThrow('DUPLICATE_PROFILE');
  });
});

describe('connection window authority', () => {
  const url = 'file:///installed/gateway-connections.html';
  function context() {
    const frame = { url }, window = { mainFrame: frame, isDestroyed: () => false, getURL: () => url } as unknown as WebContents;
    const event = { sender: window, senderFrame: frame } as unknown as IpcMainInvokeEvent;
    const policy = new ConnectionWindowPolicy();
    policy.register(window, url);
    return { frame, window, event, policy };
  }
  it('permits only the registered configuration top frame and fixed channels', () => {
    const { policy, event } = context();
    expect(() => policy.authorize(event, 'connections:snapshot')).not.toThrow();
    expect(() => policy.authorize(event, 'file:read')).toThrow('REMOTE_CAPABILITY_DISABLED');
    expect(() => policy.authorize({ ...event, senderFrame: { url } } as IpcMainInvokeEvent, 'connections:save')).toThrow('UNTRUSTED');
    expect(() => policy.authorize({ ...event, sender: { getURL: () => url } } as IpcMainInvokeEvent, 'connections:snapshot')).toThrow('UNTRUSTED');
    policy.revoke();
    expect(() => policy.authorize(event, 'connections:snapshot')).toThrow('UNTRUSTED');
  });
  it('does not trust a redirected/loopback page through the registered WebContents', () => {
    const { policy, event, frame } = context();
    frame.url = 'http://127.0.0.1:18790';
    expect(() => policy.authorize(event, 'connections:snapshot')).toThrow('UNTRUSTED');
  });
  it('blocks invocation and send/MessagePort handlers before their side effects', async () => {
    const { policy, event } = context();
    const handlers = new Map<string, (...args: unknown[]) => unknown>();
    const ipc = Object.assign(new EventEmitter(), {
      handle: (channel: string, listener: (...args: unknown[]) => unknown) => { handlers.set(channel, listener); },
      handleOnce: (channel: string, listener: (...args: unknown[]) => unknown) => { handlers.set(channel, listener); },
    }) as unknown as IpcMain;
    installConnectionIpcBoundary(ipc, (e, channel) => policy.authorize(e, channel));
    const effect = vi.fn();
    for (const channel of ['file:read', 'clipboard:read-text', 'terminal:create', 'gateway:get-credential', 'computer:status', 'browser:ensure']) {
      ipc.handle(channel, effect);
      expect(() => handlers.get(channel)!(event)).toThrow('REMOTE_CAPABILITY_DISABLED');
    }
    ipc.prependListener('terminal:prepend-write', effect);
    ipc.prependOnceListener('terminal:prepend-port', effect);
    ipc.on('terminal:write', effect);
    ipc.once('computer-preview:port', effect);
    const close = vi.fn();
    ipc.emit('terminal:prepend-write', event, 'command');
    ipc.emit('terminal:prepend-port', { ...event, ports: [{ close }] });
    ipc.emit('terminal:write', event, 'command');
    ipc.emit('computer-preview:port', { ...event, ports: [{ close }] });
    expect(close).toHaveBeenCalledTimes(2);
    expect(effect).not.toHaveBeenCalled();
    ipc.handle(CONNECTION_CHANNELS[0], () => 'status');
    expect(handlers.get(CONNECTION_CHANNELS[0])!(event)).toBe('status');
    const once = vi.fn();
    ipc.once(CONNECTION_CHANNELS[0], once);
    ipc.emit(CONNECTION_CHANNELS[0], event);
    ipc.emit(CONNECTION_CHANNELS[0], event);
    expect(once).toHaveBeenCalledTimes(1);
    ipc.prependOnceListener(CONNECTION_CHANNELS[0], once);
    ipc.emit(CONNECTION_CHANNELS[0], event);
    ipc.emit(CONNECTION_CHANNELS[0], event);
    expect(once).toHaveBeenCalledTimes(2);
    expect(ipc.listenerCount(CONNECTION_CHANNELS[0])).toBe(0);
  });
});

it('advances the epoch on every explicit connection attempt, including already-pinned profiles', async () => {
  await manager.initialize();
  const saved = await manager.save(0, { ...input, credential: 'owner-token' });
  const id = saved.profiles[0].id;
  const first = await manager.beginConnection(saved.epoch, id);
  const pinned = await manager.pinIdentity(first.epoch, id, { gatewayId: randomUUID(), publicKey: 'public-key'.repeat(10) });
  const second = await manager.beginConnection(pinned.epoch, id);
  expect(second.epoch).toBeGreaterThan(pinned.epoch);
  await expect(manager.beginConnection(pinned.epoch, id)).rejects.toThrow('STALE_CONNECTION_EPOCH');
});
