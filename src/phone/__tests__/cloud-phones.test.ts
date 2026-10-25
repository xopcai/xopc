import { generateKeyPairSync } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import sharp from 'sharp';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { closeXopcDatabase, openXopcDatabase } from '../../storage/sqlite/connection.js';
import { CloudAdbConnection, parseCloudEndpoint, parseCloudPrivateKey, PhoneCloudKeyStore } from '../cloud-adb.js';
import { CloudPhones } from '../cloud-phones.js';
import { PhoneRepository } from '../repository.js';
import * as permissions from '../cloud-key-permissions.js';
import { PhoneError } from '../contracts.js';

const pem = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ format: 'pem', type: 'pkcs8' }).toString();
let root: string;
beforeEach(async () => { closeXopcDatabase(); openXopcDatabase({ path: ':memory:' }); root = await mkdtemp(join(tmpdir(), 'xopc-cloud-test-')); });
afterEach(async () => { vi.useRealTimers(); vi.restoreAllMocks(); closeXopcDatabase(); await rm(root, { recursive: true, force: true }); });

async function windowsAcl(path: string, weaken = false) {
  const script = `
$ErrorActionPreference = 'Stop'
$target = $env:XOPC_PHONE_TEST_ACL_PATH
if ($env:XOPC_PHONE_TEST_ACL_WEAKEN -eq '1') {
  $acl = Get-Acl -LiteralPath $target
  $everyone = New-Object System.Security.Principal.SecurityIdentifier('S-1-1-0')
  $acl.AddAccessRule((New-Object System.Security.AccessControl.FileSystemAccessRule($everyone, 'Read', 'Allow')))
  Set-Acl -LiteralPath $target -AclObject $acl
}
$acl = Get-Acl -LiteralPath $target
$rules = @($acl.GetAccessRules($true, $true, [System.Security.Principal.SecurityIdentifier]) | ForEach-Object {
  @{ sid = $_.IdentityReference.Value; inherited = $_.IsInherited; type = $_.AccessControlType.ToString(); rights = $_.FileSystemRights.ToString(); inheritance = $_.InheritanceFlags.ToString() }
})
@{ owner = $acl.GetOwner([System.Security.Principal.SecurityIdentifier]).Value; user = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value; protected = $acl.AreAccessRulesProtected; rules = $rules } | ConvertTo-Json -Depth 4 -Compress
`;
  const { stdout } = await promisify(execFile)(join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
    ['-NoProfile', '-NonInteractive', '-OutputFormat', 'Text', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')],
    { windowsHide: true, timeout: 15_000, env: { ...Object.fromEntries(Object.entries(process.env).filter(([name]) => name.toLowerCase() !== 'psmodulepath')), PSModulePath: join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'Modules'), XOPC_PHONE_TEST_ACL_PATH: path, XOPC_PHONE_TEST_ACL_WEAKEN: weaken ? '1' : '0' } });
  return JSON.parse(stdout.trim());
}
async function expectPrivate(path: string, directory: boolean) {
  if (process.platform !== 'win32') {
    expect((await stat(path)).mode & 0o777).toBe(directory ? 0o700 : 0o600);
    return;
  }
  const acl = await windowsAcl(path);
  expect(acl.protected).toBe(true); expect(acl.owner).toBe(acl.user);
  expect(acl.rules).toEqual([{ sid: acl.user, inherited: false, type: 'Allow', rights: 'FullControl', inheritance: directory ? 'ContainerInherit, ObjectInherit' : 'None' }]);
}
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
  await expectPrivate(path, false); await expectPrivate(root, true);
  expect(await readFile(path)).toEqual(parseCloudPrivateKey(pem));
  await expect(manager.add('owner', result.token, 'Again', false)).rejects.toThrow('expired');
  await manager.remove(device); await expect(keys.load(device.connection!.credentialId)).rejects.toThrow('unavailable'); manager.close();
}, 30_000);

it.runIf(process.platform === 'win32')('removes broad existing ACL entries before storing or loading a key', async () => {
  const store = new PhoneCloudKeyStore(root);
  expect((await windowsAcl(root, true)).rules.some(rule => rule.sid === 'S-1-1-0')).toBe(true);
  const id = await store.save(parseCloudPrivateKey(pem));
  const path = join(root, `${id}.der`);
  await expectPrivate(root, true); await expectPrivate(path, false);
  expect((await windowsAcl(path, true)).rules.some(rule => rule.sid === 'S-1-1-0')).toBe(true);
  expect(await store.load(id)).toEqual(parseCloudPrivateKey(pem));
  await expectPrivate(path, false);
}, 30_000);

it('fails closed before writing when directory protection fails', async () => {
  const store = new PhoneCloudKeyStore(root);
  vi.spyOn(permissions, 'protectPhoneCredential').mockRejectedValue(new PhoneError('PHONE_KEY_PERMISSIONS', 'Unable to secure credentials', 500));
  await expect(store.save(parseCloudPrivateKey(pem))).rejects.toMatchObject({ code: 'PHONE_KEY_PERMISSIONS' });
  expect(await readdir(root)).toEqual([]);
});

it('removes the credential and refuses registration when file protection fails', async () => {
  const { manager, repository } = await fixture();
  const draft = await manager.test('owner', 'cloud.example:10001', pem, new AbortController().signal);
  const protect = permissions.protectPhoneCredential;
  vi.spyOn(permissions, 'protectPhoneCredential').mockImplementation(async (path, directory) => {
    if (directory) return protect(path, directory);
    throw new PhoneError('PHONE_KEY_PERMISSIONS', 'Unable to secure credentials', 500);
  });
  await expect(manager.add('owner', draft.token, 'Phone', false)).rejects.toMatchObject({ code: 'PHONE_KEY_PERMISSIONS' });
  expect(await readdir(root)).toEqual([]); expect(repository.list()).toEqual([]); manager.close();
});

it('refuses to load a key if its permissions cannot be secured', async () => {
  const store = new PhoneCloudKeyStore(root); const id = await store.save(parseCloudPrivateKey(pem));
  vi.spyOn(permissions, 'protectPhoneCredential').mockRejectedValue(new PhoneError('PHONE_KEY_PERMISSIONS', 'Unable to secure credentials', 500));
  await expect(store.load(id)).rejects.toMatchObject({ code: 'PHONE_KEY_PERMISSIONS' });
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
