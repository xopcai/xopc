import { cp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repository = resolve(root, '../..');
const output = resolve(root, 'dist/mobile-' + (process.argv.slice(2).join('-') || 'preview'));
const require = createRequire(import.meta.url);
const katexRoot = dirname(require.resolve('katex/package.json'));
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
await build({ entryPoints: [resolve(root, 'mobile/host.ts')], outfile: resolve(output, 'host.js'),
  bundle: true, format: 'iife', target: 'es2020', minify: true, legalComments: 'eof' });
for (const file of ['index.html', 'host.css']) await cp(resolve(root, 'mobile', file), resolve(output, file));
await cp(resolve(katexRoot, 'dist/katex.min.css'), resolve(output, 'katex.min.css'));
await cp(resolve(katexRoot, 'dist/fonts'), resolve(output, 'fonts'), { recursive: true });
await cp(resolve(katexRoot, 'LICENSE'), resolve(output, 'KaTeX-LICENSE.txt'));
const info = JSON.parse(await readFile(resolve(katexRoot, 'package.json'), 'utf8'));
await writeFile(resolve(output, 'source.json'), JSON.stringify({ dialect: 'xopc-math-v1', katex: info.version }, null, 2) + '\n');
const targets = {
  ios: 'apps/mobile-ios/XopcMobile/Resources/Math',
  android: 'apps/mobile-android/app/src/main/assets/math',
  harmony: 'apps/mobile-harmony/entry/src/main/resources/rawfile/math',
};
for (const target of process.argv.slice(2)) {
  if (!(target in targets)) throw new Error(`Unknown mobile target: ${target}`);
  const destination = resolve(repository, targets[target]);
  await rm(destination, { recursive: true, force: true });
  await cp(output, destination, { recursive: true });
  if (target === 'ios') {
    const html = await readFile(resolve(destination, 'index.html'), 'utf8');
    await writeFile(resolve(destination, 'index.html'), html.replace('<script src="host.js"></script>', ''));
  }
}
console.log(`Local math resources generated with KaTeX ${info.version}`);
