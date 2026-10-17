import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repository = resolve(root, '../..');
const targets = {
  ios: 'apps/mobile-ios/XopcMobile/Resources/Charts',
  android: 'apps/mobile-android/app/src/main/assets/charts',
  harmony: 'apps/mobile-harmony/entry/src/main/resources/rawfile/charts',
};
const requested = process.argv.slice(2);
for (const target of requested) if (!(target in targets)) throw new Error(`Unknown target: ${target}`);
const output = resolve(root, 'dist/mobile-' + (requested.join('-') || 'preview'));
const require = createRequire(resolve(repository, 'web/package.json'));
const echarts = dirname(require.resolve('echarts/package.json'));
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
await build({ entryPoints: [resolve(root, 'mobile/host.ts')], outfile: resolve(output, 'host.js'),
  bundle: true, format: 'iife', target: 'es2020', minify: true, legalComments: 'eof',
  plugins: [{ name: 'local-echarts', setup(builder) {
    builder.onResolve({ filter: /^echarts\// }, args => ({ path: require.resolve(args.path) }));
  } }],
});
for (const file of ['index.html', 'host.css']) await cp(resolve(root, 'mobile', file), resolve(output, file));
await cp(resolve(echarts, 'LICENSE'), resolve(output, 'ECharts-LICENSE.txt'));
await cp(resolve(echarts, 'NOTICE'), resolve(output, 'ECharts-NOTICE.txt'));
const zrender = dirname(createRequire(resolve(echarts, 'package.json')).resolve('zrender/package.json'));
await cp(resolve(zrender, 'LICENSE'), resolve(output, 'ZRender-LICENSE.txt'));
const info = JSON.parse(await readFile(resolve(echarts, 'package.json'), 'utf8'));
await writeFile(resolve(output, 'source.json'), JSON.stringify({ dialect: 'chart-v1', echarts: info.version }) + '\n');
for (const target of requested) {
  const destination = resolve(repository, targets[target]);
  await rm(destination, { recursive: true, force: true });
  await cp(output, destination, { recursive: true });
  if (target === 'ios') {
    const html = await readFile(resolve(destination, 'index.html'), 'utf8');
    await writeFile(resolve(destination, 'index.html'), html.replace('<script src="host.js"></script>', ''));
  }
}
console.log(`Local chart resources generated with ECharts ${info.version}`);
