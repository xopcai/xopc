import { appendFileSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export function resolveNpmTag(version) {
  const match = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-([a-z][a-z0-9-]*)(?:\.[0-9A-Za-z-]+)*)?$/.exec(version);
  if (!match) throw new Error(`Unsupported release version: ${version}`);
  const prerelease = match[1];
  if (!prerelease) return 'latest';
  if (prerelease === 'latest') throw new Error('A prerelease cannot use the latest npm tag');
  return prerelease === 'alpha' ? 'dev' : prerelease;
}

export async function checkNpmRelease(pkg, { eventName, refName, fetchImpl = fetch }) {
  const { name, version } = pkg;
  const tag = resolveNpmTag(version);
  if (eventName === 'push' && refName !== `v${version}`) {
    throw new Error(`Package version ${version} does not match release tag ${refName}`);
  }
  const response = await fetchImpl(
    `https://registry.npmjs.org/${encodeURIComponent(name)}/${encodeURIComponent(version)}`,
    { signal: AbortSignal.timeout(30_000) },
  );
  if (response.status === 404) return { version, tag, exists: false };
  if (!response.ok) throw new Error(`npm registry check failed: HTTP ${response.status}`);
  const published = await response.json();
  if (published.name !== name || published.version !== version) {
    throw new Error('npm registry returned unexpected package metadata');
  }
  return { version, tag, exists: true };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = await checkNpmRelease(JSON.parse(readFileSync('package.json', 'utf8')), {
    eventName: process.env.GITHUB_EVENT_NAME,
    refName: process.env.GITHUB_REF_NAME,
  });
  for (const [key, value] of Object.entries(result)) {
    appendFileSync(process.env.GITHUB_OUTPUT, `${key}=${value}\n`);
  }
  console.log(`Version ${result.version}, npm tag ${result.tag}, already published: ${result.exists}`);
}
