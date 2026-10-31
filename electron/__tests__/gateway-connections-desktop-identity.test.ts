import { createCipheriv, createDecipheriv, generateKeyPairSync, randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, expect, it } from 'vitest';

import { DesktopIdentityStore, type DesktopIdentity } from '../desktop/device-identity.js';

let root: string;
const encryptionKey = randomBytes(32), encryption = {
  available: async () => true,
  encrypt: async (value: string) => { const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', encryptionKey, iv); const bytes = Buffer.concat([cipher.update(value), cipher.final()]); return Buffer.concat([iv, cipher.getAuthTag(), bytes]); },
  decrypt: async (bytes: Buffer) => { const decipher = createDecipheriv('aes-256-gcm', encryptionKey, bytes.subarray(0, 12)); decipher.setAuthTag(bytes.subarray(12, 28)); return Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString(); },
};
beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'xopc-desktop-identity-')); });
afterEach(async () => { await rm(root, { recursive: true, force: true }); });
function record(): DesktopIdentity {
  const device = generateKeyPairSync('ec', { namedCurve: 'prime256v1' }), gateway = generateKeyPairSync('ed25519');
  return { version: 1, phase: 'pending', binding: { profileId: randomUUID(), gatewayId: randomUUID(), origin: 'https://gateway.example.com', publicKey: gateway.publicKey.export({ type: 'spki', format: 'pem' }).toString() },
    privateKey: device.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(), displayName: 'Synthetic desktop', requestId: randomUUID(), completionKey: randomUUID(),
    pairingToken: 'synthetic-pairing-token', initialRefreshToken: `xopc_rt_${randomUUID()}_${randomBytes(32).toString('base64url')}` };
}
it('encrypts the entire atomic identity and separates profile, gateway identity and origin', async () => {
  const store = new DesktopIdentityStore(root, encryption), identity = record(); await store.save(identity);
  expect(await store.load(identity.binding)).toEqual(identity);
  const files = await readdir(root); expect(files).toHaveLength(1);
  const bytes = await readFile(join(root, files[0])); expect(bytes.includes(Buffer.from('PRIVATE KEY'))).toBe(false); expect(bytes.includes(Buffer.from(identity.initialRefreshToken))).toBe(false);
  for (const binding of [{ ...identity.binding, profileId: randomUUID() }, { ...identity.binding, gatewayId: randomUUID() }, { ...identity.binding, origin: 'https://other.example.com' }]) expect(await store.load(binding)).toBeUndefined();
});
it('rejects a validly encrypted but substituted binding and corrupted ciphertext', async () => {
  const store = new DesktopIdentityStore(root, encryption), identity = record(); await store.save(identity); const file = join(root, (await readdir(root))[0]);
  await writeFile(file, await encryption.encrypt(JSON.stringify({ ...identity, binding: { ...identity.binding, gatewayId: randomUUID() } })));
  await expect(store.load(identity.binding)).rejects.toThrow('DESKTOP_IDENTITY_BINDING_MISMATCH');
  await writeFile(file, Buffer.alloc(48)); await expect(store.load(identity.binding)).rejects.toThrow();
});
it('fails closed when secure storage is unavailable without creating identity files', async () => {
  const store = new DesktopIdentityStore(root, { ...encryption, available: async () => false }), identity = record();
  await expect(store.save(identity)).rejects.toThrow('SECURE_STORAGE_UNAVAILABLE'); await expect(store.load(identity.binding)).rejects.toThrow('SECURE_STORAGE_UNAVAILABLE'); expect(await readdir(root)).toEqual([]);
});
it('quarantines a failed disk commit until a new process reloads state', async () => {
  const file = join(root, 'blocked'); await writeFile(file, 'not a directory'); const store = new DesktopIdentityStore(file, encryption), identity = record();
  await expect(store.save(identity)).rejects.toThrow(); await expect(store.load(identity.binding)).rejects.toThrow('DESKTOP_IDENTITY_RESTART_REQUIRED');
});
