// Stapling changes bytes; refresh updater hashes and blockmaps only after all tickets are attached.
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { readFileSync, writeFileSync } from 'node:fs';
import yaml from 'js-yaml';

const require = createRequire(import.meta.url);
const builderRequire = createRequire(require.resolve('electron-builder/package.json'));
const builderRoot = dirname(builderRequire.resolve('app-builder-lib'));
const { buildBlockMap } = builderRequire(join(builderRoot, 'targets/blockmap/blockmap.js'));
const directory = resolve(process.argv[2] ?? 'dist/release');
const metadataPath = join(directory, 'latest-mac.yml');
const metadata = yaml.load(readFileSync(metadataPath, 'utf8'));
for (const file of metadata.files) {
  const artifact = join(directory, file.url);
  const result = await buildBlockMap(artifact, 'gzip', artifact + '.blockmap');
  file.sha512 = result.sha512;
  file.size = result.size;
}
const primary = metadata.files.find(file => file.url === metadata.path);
if (!primary) throw new Error('Primary macOS updater artifact is missing');
metadata.sha512 = primary.sha512;
writeFileSync(metadataPath, yaml.dump(metadata, { lineWidth: -1 }));
console.log(JSON.stringify({ updated: metadata.files.map(file => ({ url: file.url, size: file.size })) }));
