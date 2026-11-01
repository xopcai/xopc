import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

/** Verify the public registry and downloaded bytes, after npm's publish-time scan. */
export async function checkNpmPublication({ name, version, tag, expectedSha256 }, fetchImpl = fetch) {
  const endpoint = `https://registry.npmjs.org/${encodeURIComponent(name)}`;
  const get = async (url, timeoutMs = 30_000) => {
    const response = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs), headers: { 'Cache-Control': 'no-cache' } });
    assert(response.ok, `Public registry returned HTTP ${response.status}`);
    return response;
  };
  const metadata = await (await get(`${endpoint}/${encodeURIComponent(version)}`)).json();
  assert.equal(metadata.name, name, 'Published package name differs');
  assert.equal(metadata.version, version, 'Published version differs');
  if (tag) {
    const tagged = await (await get(`${endpoint}/${encodeURIComponent(tag)}`)).json();
    assert.equal(tagged.version, version, `npm tag ${tag} points to a different version`);
  }
  const url = new URL(metadata.dist.tarball);
  assert(url.protocol === 'https:' && url.hostname === 'registry.npmjs.org', 'Unexpected npm tarball origin');
  const bytes = Buffer.from(await (await get(url.href, 120_000)).arrayBuffer());
  const integrity = `sha512-${createHash('sha512').update(bytes).digest('base64')}`;
  assert.equal(integrity, metadata.dist.integrity, 'Published tarball integrity differs');
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  if (expectedSha256) assert.equal(sha256, expectedSha256, 'Public tarball differs from the tested build');
  return { name, version, tag, bytes: bytes.length, sha256, integrity };
}

export async function waitForNpmPublication(options, { check = checkNpmPublication, wait = delay, now = Date.now, log = console.log } = {}) {
  const deadline = now() + (options.timeoutMs ?? 15 * 60_000);
  for (;;) {
    try { return await check(options); } catch (error) {
      const remaining = deadline - now();
      if (remaining <= 0) throw error;
      log(`Waiting for public npm availability: ${error.message}`);
      await wait(Math.min(30_000, remaining));
    }
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  const result = await waitForNpmPublication({ name: pkg.name, version: process.env.VERSION ?? pkg.version,
    tag: process.env.NPM_TAG ?? 'latest', expectedSha256: process.env.PACKAGE_SHA256 || undefined });
  console.log('Public npm publication verified:', JSON.stringify(result));
}
