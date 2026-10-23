import { generateKeyPairSync } from 'node:crypto';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import sharp from 'sharp';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { closeXopcDatabase, openXopcDatabase } from '../../storage/sqlite/connection.js';
import { CloudAdbConnection, parseCloudEndpoint, parseCloudPrivateKey, PhoneCloudKeyStore } from '../cloud-adb.js';
import { CloudPhones } from '../cloud-phones.js';
import { PhoneRepository } from '../repository.js';

const pem = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ format: 'pem', type: 'pkcs8' }).toString();
let root: string;
beforeEach(async () => { closeXopcDatabase(); openXopcDatabase({ path: ':memory:' }); root = await mkdtemp(join(tmpdir(), 'xopc-cloud-test-')); });
afterEach(async () => { vi.useRealTimers(); closeXopcDatabase(); await rm(root, { recursive: true, force: true }); });
async function fixture() {
  const repository = new PhoneRepository(); const keys = new PhoneCloudKeyStore(root); const save = vi.spyOn(keys, 'save');
  const pixels = await sharp({ create: { width: 20, height: 40, channels: 3, background: 'white' } }).png().toBuffer();
  const command = vi.fn(async (_path: string, args: string[]) => args.includes('screencap') ? Buffer.from(pixels) : Buffer.from(args.includes('ro.product.model') ? 'Cloud phone' : '12'));
  const dispose = vi.fn();
  const manager = new CloudPhones(repository, keys, () => ({ command, dispose }) as unknown as CloudAdbConnection);
  return { repository, keys, save, command, dispose, manager };
}
it('rejects commands, URLs, invalid ports and invalid keys before connecting', () => {
  for (const address of ['adb connect 1.2.3.4:5555', 'https://phone:5555', 'phone:0', 'phone:65536', 'phone:5555/path', 'phone:5555;id']) expect(() => parseCloudEndpoint(address)).toThrow();
  expect(parseCloudEndpoint('Phone.EXAMPLE:10001').endpoint).toBe('phone.example:10001');
  expect(() => parseCloudPrivateKey('not a key')).toThrow('RSA 2048');
  const weak = generateKeyPairSync('rsa', { modulusLength: 1024 }).privateKey.export({ format: 'pem', type: 'pkcs1' }).toString();
  expect(() => parseCloudPrivateKey(weak)).toThrow();
  expect(parseCloudPrivateKey(pem).length).toBeGreaterThan(1000);
});
it('tests without persisting keys, binds the result to its owner and consumes it once', async () => {
  const { manager, repository, save, dispose, keys } = await fixture();
  const result = await manager.test('owner', 'cloud.example:10001', pem, new AbortController().signal);
  expect(result).toMatchObject({ model: 'Cloud phone', androidVersion: '12', media: 'snapshot' });
  expect(result.screenshot).toMatch(/^data:image\/jpeg;base64,/); expect(save).not.toHaveBeenCalled(); expect(repository.list()).toEqual([]); expect(dispose).toHaveBeenCalled();
  await expect(manager.add('other', result.token, 'Phone', false)).rejects.toThrow('expired');
  const device = await manager.add('owner', result.token, 'Phone', true);
  expect(repository.defaultDevice()).toBe(device.id); expect(JSON.stringify(device)).not.toContain('PRIVATE KEY');
  const path = join(root, `${device.connection!.credentialId}.der`);
  expect((await stat(path)).mode & 0o777).toBe(0o600); expect((await stat(root)).mode & 0o777).toBe(0o700);
  expect(await readFile(path)).toEqual(parseCloudPrivateKey(pem));
  await expect(manager.add('owner', result.token, 'Again', false)).rejects.toThrow('expired');
  await manager.remove(device); await expect(keys.load(device.connection!.credentialId)).rejects.toThrow('unavailable'); manager.close();
});
it('releases the device lease and connection on test failure', async () => {
  const { manager, repository, command, dispose, save } = await fixture(); command.mockRejectedValueOnce(new Error('offline'));
  await expect(manager.test('owner', 'cloud.example:10001', pem, new AbortController().signal)).rejects.toThrow('offline');
  expect(dispose).toHaveBeenCalled(); expect(save).not.toHaveBeenCalled();
  const lease = repository.acquire('cloud.example:10001'); repository.release('cloud.example:10001', lease); manager.close();
});
it('expires abandoned test credentials and cleans a duplicate add credential', async () => {
  const { manager, keys, repository } = await fixture();
  const result = await manager.test('owner', 'cloud.example:10001', pem, new AbortController().signal);
  repository.save({ serial: result.endpoint, name: 'Existing', enabled: true, allowedApps: ['com.android.settings'] });
  const removed = vi.spyOn(keys, 'remove');
  await expect(manager.add('owner', result.token, 'Duplicate', false)).rejects.toThrow('already registered'); expect(removed).toHaveBeenCalledOnce();
  const another = await manager.test('owner', 'other.example:10001', pem, new AbortController().signal);
  manager.cancel('other', another.token);
  vi.useFakeTimers(); vi.setSystemTime(another.expiresAt + 1);
  await expect(manager.add('owner', another.token, 'Expired', false)).rejects.toThrow('expired'); manager.close();
});
