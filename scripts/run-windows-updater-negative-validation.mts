/** Uses an existing unsigned local installer; creates no Windows trust-store entries. */
import assert from 'node:assert/strict';
import { createHash, randomUUID, X509Certificate } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:https';
import { createRequire } from 'node:module';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { build } from 'esbuild';
import { readWindowsSignature } from '../electron/windows-signature.js';

assert.equal(process.platform, 'win32');
const repo = resolve(import.meta.dirname, '..');
const installer = resolve(process.argv[2] ?? 'dist/release/xopc-0.0.416-x64.exe');
assert.equal((await readWindowsSignature(installer)).status, 'NotSigned', 'Supply an unsigned test installer');
const root = join(repo, '.cache', `windows-updater-negative-${randomUUID()}`); await mkdir(root, { recursive: true });
const openssl = process.env.XOPC_TEST_OPENSSL ?? 'C:/Program Files/Git/usr/bin/openssl.exe';
const certificate = spawnSync(openssl, ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', join(root, 'tls.key'),
  '-out', join(root, 'tls.crt'), '-days', '1', '-subj', '/CN=127.0.0.1', '-addext', 'subjectAltName=IP:127.0.0.1'],
  { windowsHide: true, encoding: 'utf8', timeout: 30_000, env: { ...process.env, MSYS_NO_PATHCONV: '1' } });
assert.equal(certificate.status, 0, 'Set XOPC_TEST_OPENSSL to an OpenSSL executable');
const bytes = await readFile(installer), sha512 = createHash('sha512').update(bytes).digest('base64');
const counts = { manifests: 0, installers: 0 };
const server = createServer({ key: await readFile(join(root, 'tls.key')), cert: await readFile(join(root, 'tls.crt')) }, (request, response) => {
  if (/^\/(unsigned|checksum)\/latest\.yml(?:\?.*)?$/.test(request.url!)) {
    counts.manifests++;
    const hash = request.url!.startsWith('/checksum/') ? Buffer.alloc(64).toString('base64') : sha512;
    response.end(`version: 0.0.416\nfiles:\n  - url: xopc-0.0.416-x64.exe\n    sha512: ${hash}\n    size: ${bytes.length}\npath: xopc-0.0.416-x64.exe\nsha512: ${hash}\n`);
  } else if (/^\/(unsigned|checksum)\/xopc-0\.0\.416-x64\.exe$/.test(request.url!)) {
    counts.installers++; response.writeHead(200, { 'Content-Length': bytes.length, 'Content-Type': 'application/octet-stream' }); response.end(bytes);
  } else { response.writeHead(404); response.end(); }
});
await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
try {
  const entry = join(root, 'verify.mjs');
  await build({ entryPoints: [join(repo, 'scripts/verify-windows-updater-negative.mts')], outfile: entry,
    bundle: true, platform: 'node', format: 'esm', external: ['electron'],
    banner: { js: 'import { createRequire as __makeRequire } from "node:module"; const require = __makeRequire(import.meta.url);' } });
  const env = { ...process.env, XOPC_UPDATE_TEST_ROOT: root, XOPC_UPDATE_TEST_FEED: `https://127.0.0.1:${(server.address() as any).port}`,
    XOPC_UPDATE_TEST_FINGERPRINT: new X509Certificate(await readFile(join(root, 'tls.crt'))).fingerprint256 };
  delete env.ELECTRON_RUN_AS_NODE;
  const electron = createRequire(import.meta.url)('electron') as string;
  const child = spawn(electron, [entry], { cwd: repo, env, windowsHide: true, stdio: 'inherit' });
  const status = await new Promise<number | null>((resolve, reject) => {
    const timer = setTimeout(() => { child.kill(); reject(new Error('Real updater negative validation timed out')); }, 120_000);
    child.on('error', error => { clearTimeout(timer); reject(error); }); child.on('exit', code => { clearTimeout(timer); resolve(code); });
  });
  assert.equal(status, 0);
  assert.equal(counts.manifests, 2); assert.equal(counts.installers, 2);
  const evidence = JSON.parse(await readFile(join(root, 'result.json'), 'utf8'));
  Object.assign(evidence, { network: counts, installerSha256: createHash('sha256').update(bytes).digest('hex'), verifiedAt: new Date().toISOString() });
  await writeFile(join(root, 'result.json'), JSON.stringify(evidence, null, 2) + '\n');
  console.log(`Real Windows updater rejection evidence: ${join(root, 'result.json')}`);
} finally { await new Promise<void>(r => server.close(() => r())); }
