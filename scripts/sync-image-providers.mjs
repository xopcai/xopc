import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, rmSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const source = fileURLToPath(new URL('../packages/image-providers/', import.meta.url));
const destination = process.argv[2];
if (!destination) throw new Error('Usage: node scripts/sync-image-providers.mjs <platform-root>');
const build = spawnSync('pnpm', ['exec', 'tsc', '-p', resolve(source, 'tsconfig.json')], { stdio: 'inherit', cwd: resolve(source, '../..') });
if (build.status !== 0) process.exit(build.status ?? 1);
const output = resolve(destination, 'vendor/image-providers');
rmSync(output, { recursive: true, force: true });
mkdirSync(output, { recursive: true });
const hashes = {};
for (const name of readdirSync(resolve(source, 'dist')).sort()) {
  const content = readFileSync(resolve(source, 'dist', name));
  writeFileSync(resolve(output, name), content);
  hashes[name] = createHash('sha256').update(content).digest('hex');
}
const pkg = JSON.parse(readFileSync(resolve(source, 'package.json'), 'utf8'));
writeFileSync(resolve(output, 'package.json'), JSON.stringify({ name: pkg.name, version: pkg.version, type: 'module', license: pkg.license,
  exports: { '.': { types: './index.d.ts', import: './index.js' } } }, null, 2) + '\n');
writeFileSync(resolve(output, 'source.json'), JSON.stringify({ source: 'xopc/packages/image-providers', version: pkg.version, hashes }, null, 2) + '\n');
