/** Fail-closed validation of the exact Windows installer, payload, and updater metadata. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { load } from 'js-yaml';
import { readWindowsSignature, windowsPublishers, windowsSignatureFailure } from '../electron/windows-signature.js';

assert.equal(process.platform, 'win32', 'Verify Windows releases on Windows');
const root = resolve(process.argv[2] ?? 'dist/release');
const expectedPublisher = process.env.XOPC_WINDOWS_PUBLISHER;
assert.ok(expectedPublisher?.startsWith('CN='), 'Set XOPC_WINDOWS_PUBLISHER to the exact certificate Subject DN');
const unpacked = join(root, 'win-unpacked');
const publishers = windowsPublishers(join(unpacked, 'resources/app-update.yml'));
assert.deepEqual(publishers, [expectedPublisher], 'Updater publisher must equal the approved release publisher');
const config = load(await readFile(join(unpacked, 'resources/app-update.yml'), 'utf8')) as any;
assert.equal(config.provider, 'generic'); assert.equal(config.url, 'https://xopc.ai/api/download');
const manifest = load(await readFile(join(root, 'latest.yml'), 'utf8')) as any;
assert.match(manifest.version, /^\d+\.\d+\.\d+$/);
assert.ok(Array.isArray(manifest.files) && manifest.files.length > 0);
const installerEvidence: any[] = [];
for (const file of manifest.files) {
  assert.match(file.url, /^xopc-\d+\.\d+\.\d+-(x64|arm64)\.exe$/);
  assert.ok(file.url.startsWith(`xopc-${manifest.version}-`));
  const bytes = await readFile(join(root, file.url));
  assert.equal(bytes.length, file.size); assert.equal(createHash('sha512').update(bytes).digest('base64'), file.sha512);
  assert.ok((await readFile(join(root, file.url + '.blockmap'))).length > 0);
  const signature = await readWindowsSignature(join(root, file.url));
  assert.equal(windowsSignatureFailure(signature, publishers), null, `Invalid release installer: ${file.url}`);
  installerEvidence.push({ file: file.url, sha256: createHash('sha256').update(bytes).digest('hex'), size: bytes.length, signature });
}
assert.equal(manifest.path, manifest.files[0].url); assert.equal(manifest.sha512, manifest.files[0].sha512);
// Include all PE payloads, not just the outer NSIS container.
async function binaries(dir: string): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...await binaries(path));
    else if (/\.(exe|dll|node)$/i.test(entry.name)) files.push(path);
  }
  return files;
}
const payload: any[] = [];
for (const path of await binaries(unpacked)) {
  const signature = await readWindowsSignature(path);
  // Electron and Microsoft components may retain their original trusted publisher.
  assert.equal(signature.status, 'Valid', `Untrusted payload signature: ${path}`);
  const relative = path.slice(unpacked.length + 1).replaceAll('\\', '/');
  if (relative === 'xopc.exe' || relative.startsWith('resources/bin/')) {
    assert.equal(windowsSignatureFailure(signature, publishers), null, `Invalid application payload: ${relative}`);
  }
  payload.push({ file: relative, signature });
}
assert.ok(payload.some(file => file.file === 'xopc.exe'));
const evidence = { passed: true, version: manifest.version, verifiedAt: new Date().toISOString(), publishers, installers: installerEvidence, payload };
await writeFile(join(root, 'windows-release-verification.json'), JSON.stringify(evidence, null, 2) + '\n');
console.log(`Verified signed Windows release ${manifest.version}: ${installerEvidence.length} installer(s), ${payload.length} PE payloads`);
