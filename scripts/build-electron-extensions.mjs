#!/usr/bin/env node
/** Build Electron-only bundled extensions as self-contained ESM modules. */
import * as esbuild from 'esbuild';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { builtinModules } from 'node:module';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const srcRoot = join(root, 'dist/extensions');
const outRoot = join(root, 'dist/electron/extensions');

if (!existsSync(srcRoot)) {
  console.error(`[build-electron-extensions] Missing ${srcRoot}. Run \`pnpm run build:node\` first.`);
  process.exit(1);
}

const builtins = new Set([...builtinModules, ...builtinModules.map((name) => `node:${name}`)]);

const resolverPlugin = {
  name: 'xopc-electron-extension-resolver',
  setup(build) {
    build.onResolve({ filter: /^@xopcai\/xopc(?:\/(.*))?$/ }, (args) => {
      const subpath = args.path === '@xopcai/xopc' ? 'index.js' : args.path.slice('@xopcai/xopc/'.length);
      return { path: join(root, 'dist/src', subpath) };
    });
    build.onResolve({ filter: /.*/ }, (args) => {
      if (builtins.has(args.path)) return { path: args.path, external: true };
      if (args.path === 'silk-wasm') return { path: args.path, external: true };
      return undefined;
    });
  },
};

rmSync(outRoot, { recursive: true, force: true });
mkdirSync(outRoot, { recursive: true });

const manifests = readdirSync(srcRoot, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => {
    const extensionDir = join(srcRoot, entry.name);
    const manifestPath = join(extensionDir, 'xopc.extension.json');
    if (!existsSync(manifestPath)) return null;
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    return manifest?.id && manifest?.main ? { id: String(manifest.id), extensionDir, manifest } : null;
  })
  .filter(Boolean);

for (const { id, extensionDir, manifest } of manifests) {
  const entry = join(extensionDir, manifest.main);
  if (!existsSync(entry)) {
    throw new Error(`[build-electron-extensions] Missing entry for ${id}: ${relative(root, entry)}`);
  }

  const outDir = join(outRoot, id);
  mkdirSync(outDir, { recursive: true });

  await esbuild.build({
    entryPoints: [entry],
    outfile: join(outDir, 'index.js'),
    bundle: true,
    platform: 'node',
    target: 'node22',
    format: 'esm',
    packages: 'bundle',
    plugins: [resolverPlugin],
    minify: process.env['XOPC_ELECTRON_EXTENSIONS_MINIFY'] !== '0',
    sourcemap: false,
    banner: {
      js: [
        "import { createRequire as __xopcCreateRequire } from 'node:module';",
        "import { fileURLToPath as __xopcFileURLToPath } from 'node:url';",
        "import { dirname as __xopcDirname } from 'node:path';",
        'const __filename = __xopcFileURLToPath(import.meta.url);',
        'const __dirname = __xopcDirname(__filename);',
        'globalThis.require = __xopcCreateRequire(import.meta.url);',
      ].join('\n'),
    },
  });

  writeFileSync(join(outDir, 'xopc.extension.json'), `${JSON.stringify({ ...manifest, main: 'index.js' }, null, 2)}\n`);
  const packageJson = join(extensionDir, 'package.json');
  if (existsSync(packageJson)) cpSync(packageJson, join(outDir, 'package.json'));
  console.log(`[build-electron-extensions] Bundled ${id}`);
}
