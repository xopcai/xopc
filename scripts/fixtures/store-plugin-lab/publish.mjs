import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
// Run inside the Store server workspace. Keys remain in memory and are revoked in finally.
import { createAuth, loadAuthEnv, getAuthDatabase, closeAuthDatabases, STORE_CLI_CONFIG_ID } from '@xopc/auth';
import dotenv from 'dotenv';
dotenv.config({ path: '/var/www/xopc-platform/.env', quiet: true });
const authEnv = loadAuthEnv(process.env), auth = createAuth(authEnv), database = getAuthDatabase(authEnv);
const key = await auth.api.createApiKey({ body: { name: 'Plugin Lab E2E', userId: 'xopc-plugins-publisher', configId: STORE_CLI_CONFIG_ID, expiresIn: 86400 } });
const headers = { 'x-api-key': key.key };
const artifactDir = process.argv[2] || '/tmp/xopc-plugin-lab-artifacts';
const release = JSON.parse(await readFile(join(artifactDir, 'release.json'), 'utf8'));
async function call(path, init) {
  const response = await fetch(`http://127.0.0.1:3001${path}`, { ...init, headers: { ...headers, ...init?.headers } });
  const result = await response.json();
  if (!response.ok) throw new Error(`${path}: ${response.status}: ${JSON.stringify(result)}`);
  return result;
}
try {
  for (const resource of release.resources) {
    const uploaded = await call(`/api/v1/developer/resources/${resource.sha256}`, { method: 'PUT', headers: { 'Content-Type': 'application/octet-stream' }, body: await readFile(join(artifactDir, resource.file)) });
    console.log(JSON.stringify({ resource: uploaded.sha256, bytes: uploaded.bytes, url: uploaded.url }));
  }
  for (const pkg of release.packages) {
    const existing = await fetch(`http://127.0.0.1:3001/api/v1/packages/${pkg.name}/versions/${pkg.version}`);
    if (existing.ok) { console.log(JSON.stringify({ name: pkg.name, version: pkg.version, status: 'already-published' })); continue; }
    const form = new FormData();
    form.set('type', pkg.type); form.set('version', pkg.version); form.set('channel', pkg.version.includes('e2e-invalid') ? 'beta' : 'stable'); form.set('description', 'TEST ONLY: synthetic Store installation, setup, OAuth and local tool verification.');
    form.set('file', new Blob([await readFile(join(artifactDir, pkg.file))], { type: 'application/zip' }), pkg.file);
    const submitted = await call(`/api/v1/developer/packages/${pkg.name}/versions`, { method: 'POST', body: form });
    await call(`/api/v1/admin/versions/${submitted.versionId}/approve`, { method: 'POST' });
    console.log(JSON.stringify({ name: pkg.name, version: pkg.version, status: 'published', sha256: pkg.sha256 }));
  }
} finally {
  database.prepare('DELETE FROM apikey WHERE id = ? AND "referenceId" = ?').run(key.id, 'xopc-plugins-publisher');
  closeAuthDatabases();
}
