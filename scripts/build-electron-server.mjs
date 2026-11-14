#!/usr/bin/env node
/**
 * Build the Electron CLI launcher and its self-contained Gateway bundle in out/server.
 * Bundle current sources, just like the desktop main process. Never reuse stale dist code.
 * Run after `pnpm run build` for generated runtime assets. Invoked by electron:server:build.
 */
import * as esbuild from 'esbuild';
import { writeDependencyRecords } from './electron-dependency-inventory.mjs';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { copySqliteAssets } from './sqlite-assets.mjs';
import { buildPersonalResultWorker } from './build-personal-result-worker.mjs';

import { ELECTRON_GATEWAY_EXTERNALS } from './electron-runtime-externals.mjs';
import { electronPiCredentialsPlugin } from './electron-pi-credentials.mjs';
import { electronPiRuntimePlugin } from './electron-pi-runtime.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
mkdirSync(dirname(join(root, 'out/server/autoglm-upstream.LICENSE')), { recursive: true });
cpSync(join(root, 'src/phone/autoglm-upstream.LICENSE'), join(root, 'out/server/autoglm-upstream.LICENSE'));
const entry = join(root, 'src/cli/bin.ts');
const outfile = join(root, 'out/server/index.js');
const runtimeFile = join(root, 'out/server/gateway.js');
const retiredVoiceRuntimeOutfile = join(root, 'out/server/voice-runtime.js');

if (!existsSync(entry)) {
  console.error(
    `[build-electron-server] Missing source entry ${entry}. Run from a complete source checkout.\n`,
  );
  process.exit(1);
}

// Exclude Electron-only or optional native / heavy deps the gateway subprocess does not need bundled.
// Marketplace adapters (store, skillhub, clawhub) are built-in under src/agent/skills/marketplace/.
const external = ELECTRON_GATEWAY_EXTERNALS;
const minify = process.env['XOPC_ELECTRON_SERVER_MINIFY'] !== '0';

// Older builds emitted a separate local-STT worker. Ensure incremental builds
// cannot accidentally carry that retired bundle into the packaged app.
rmSync(retiredVoiceRuntimeOutfile, { force: true });

const esmEntries = new Map();
const commonJsEntries = new Map();
const sidecarDirectory = join(dirname(runtimeFile), 'runtime');
const modelCatalogs = new Map();
const zodEntry = fileURLToPath(import.meta.resolve('zod'));

const optionalPackages = new Map([
  ['@dicebear/collection', 'avatar-styles'],
  ['@composio/core', 'composio'],
  ['highlight.js/lib/index.js', 'highlight-languages'],
  ['./jiti-static-loader.js', 'jiti'],
]);
const lazyProviderApis = new Set([
  'anthropic-messages', 'azure-openai-responses', 'google-generative-ai', 'google-vertex',
  'openai-codex-responses', 'openai-completions', 'openai-responses',
]);

// Highlight language registration mutates the same core used by pi's renderer.
function sharedHighlightCore(relativePrefix) {
  return {
    name: 'gateway-highlight-core',
    setup(build) {
      build.onResolve({ filter: /^(?:highlight\.js\/lib\/core\.js|\.\/core)$/ }, async (args) => {
        if (args.pluginData?.resolveGatewayDependency) return;
        if (args.path === './core' && !args.importer.replaceAll('\\', '/').endsWith('/highlight.js/lib/index.js')) return;
        const resolved = await build.resolve(args.path, {
          resolveDir: args.resolveDir,
          kind: 'require-call',
          pluginData: { resolveGatewayDependency: true },
        });
        if (resolved.errors.length) return { errors: resolved.errors };
        const name = 'highlight-core';
        const existing = commonJsEntries.get(name);
        if (existing && existing !== resolved.path) throw new Error('Conflicting highlight.js core modules');
        commonJsEntries.set(name, resolved.path);
        return { path: `${relativePrefix}${name}.cjs`, external: true };
      });
    },
  };
}

const gatewayRuntimeFiles = {
  name: 'gateway-runtime-files',
  setup(build) {
    // Resolve peer variants of the pinned pi-ai release to the same provider modules.
    build.onResolve({ filter: /^@earendil-works\/pi-ai(?:\/|$)/ }, ({ path }) => ({
      path: fileURLToPath(import.meta.resolve(path)),
    }));
    build.onResolve({ filter: /^(?:zod|undici)$/ }, async (args) => {
      if (args.pluginData?.resolveGatewayDependency) return;
      if (args.path === 'zod') {
        esmEntries.set('zod', zodEntry);
        return { path: './runtime/zod.js', external: true };
      }
      const resolved = await build.resolve(args.path, {
        importer: args.importer,
        resolveDir: args.resolveDir,
        kind: 'require-call',
        pluginData: { resolveGatewayDependency: true },
      });
      if (resolved.errors.length) return { errors: resolved.errors };
      const version = JSON.parse(readFileSync(join(dirname(resolved.path), 'package.json'), 'utf8')).version;
      const name = `undici-${version}`;
      const existing = commonJsEntries.get(name);
      if (existing && existing !== resolved.path) {
        throw new Error(`Conflicting Gateway runtime module: ${name}`);
      }
      commonJsEntries.set(name, resolved.path);
      return { path: `./runtime/${name}.cjs`, external: true };
    });
    // Keep implementations reached through dynamic imports out of the startup bundle.
    build.onResolve({ filter: /^(?:@dicebear\/collection|@composio\/core|highlight\.js\/lib\/index\.js|\.\/[\w-]+\.js)$/ }, async (args) => {
      if (args.kind !== 'dynamic-import' || args.pluginData?.resolveGatewayDependency) return;
      const importer = args.importer.replaceAll('\\', '/');
      const providerApi = args.path.slice(2, -3);
      const name = optionalPackages.get(args.path) ?? (
        importer.includes('/pi-ai/dist/api/') && lazyProviderApis.has(providerApi) ? providerApi : undefined
      );
      if (!name) return;
      const resolved = await build.resolve(args.path, {
        importer: args.importer,
        resolveDir: args.resolveDir,
        kind: args.kind,
        pluginData: { resolveGatewayDependency: true },
      });
      if (resolved.errors.length) return { errors: resolved.errors };
      const existing = esmEntries.get(name);
      if (existing && existing !== resolved.path) {
        throw new Error(`Conflicting Gateway runtime module: ${name}`);
      }
      esmEntries.set(name, resolved.path);
      return { path: `./runtime/${name}.js`, external: true };
    });
    // Keep catalog JSON under Node's JSON loader. Native import attributes preserve its semantics.
    build.onResolve({ filter: /^\.\/data\/[^/]+\.json$/ }, (args) => {
      if (!args.importer.replaceAll('\\', '/').includes('/pi-ai/dist/providers/')) return;
      const file = args.path.split('/').at(-1);
      const path = join(args.resolveDir, args.path);
      const data = readFileSync(path);
      const name = `models-${createHash('sha256').update(data).digest('hex').slice(0, 12)}-${file}`;
      modelCatalogs.set(name, data);
      return { path: `./runtime/${name}`, external: true };
    });
  },
};

const gatewayBuild = await esbuild.build({
  entryPoints: [entry],
  bundle: true,
  platform: 'node',
  target: 'node22',
  outfile: runtimeFile,
  external,
  plugins: [gatewayRuntimeFiles, sharedHighlightCore('./runtime/'), electronPiCredentialsPlugin(), electronPiRuntimePlugin()],
  format: 'esm',
  define: { PI_BUNDLED_NODE: 'true' },
  // ESM bundle: dependents (e.g. @larksuiteoapi/node-sdk) use `__dirname` / CJS `require`.
  banner: {
    js: [
      "import { createRequire as __xopcCreateRequire } from 'module';",
      "import { fileURLToPath as __xopcFileURLToPath } from 'node:url';",
      "import { dirname as __xopcDirname } from 'node:path';",
      'const __filename = __xopcFileURLToPath(import.meta.url);',
      'const __dirname = __xopcDirname(__filename);',
      'globalThis.require = __xopcCreateRequire(import.meta.url);',
    ].join('\n'),
  },
  minify,
  sourcemap: false,
  metafile: true,
});

mkdirSync(sidecarDirectory, { recursive: true });
for (const [name, data] of modelCatalogs) writeFileSync(join(sidecarDirectory, name), data);

const esmBuild = await esbuild.build({
  entryPoints: Object.fromEntries(esmEntries), outdir: sidecarDirectory,
  bundle: true, platform: 'node', format: 'esm', target: 'node22', external, minify, metafile: true,
  plugins: [sharedHighlightCore('./'), electronPiRuntimePlugin()],
  banner: { js: [
    "import { createRequire as __xopcCreateRequire } from 'node:module';",
    "import { fileURLToPath as __xopcFileURLToPath } from 'node:url';",
    "import { dirname as __xopcDirname } from 'node:path';",
    'const require = __xopcCreateRequire(import.meta.url);',
    'const __filename = __xopcFileURLToPath(import.meta.url);',
    'const __dirname = __xopcDirname(__filename);',
  ].join('\n') },
});
const commonJsBuild = await esbuild.build({
  entryPoints: Object.fromEntries(commonJsEntries), outdir: sidecarDirectory, outExtension: { '.js': '.cjs' },
  bundle: true, platform: 'node', format: 'cjs', target: 'node22', external, minify, metafile: true,
});

const gatewayRuntimeInputs = [
  ...Object.keys(gatewayBuild.metafile.inputs),
  ...Object.keys(esmBuild.metafile.inputs),
  ...Object.keys(commonJsBuild.metafile.inputs),
];
const runtimeFiles = [...esmEntries.keys()].map(name => `${name}.js`).concat(
  [...commonJsEntries.keys()].map(name => `${name}.cjs`),
  [...modelCatalogs.keys()],
).sort();
for (const name of readdirSync(sidecarDirectory)) {
  if (!runtimeFiles.includes(name)) rmSync(join(sidecarDirectory, name), { force: true });
}
writeFileSync(join(dirname(runtimeFile), 'runtime-files.json'), JSON.stringify(runtimeFiles) + '\n');

const previewWorkerBuild = await esbuild.build({
  entryPoints: [join(root, 'src/local-apps/preview-worker.ts')],
  outfile: join(root, 'out/server/preview-worker.js'),
  bundle: true, platform: 'node', target: 'node22', format: 'esm', external,
  plugins: [electronPiCredentialsPlugin(), electronPiRuntimePlugin()],
  define: { PI_BUNDLED_NODE: 'true' }, minify, sourcemap: false, metafile: true,
  banner: { js: [
    "import { createRequire as __xopcCreateRequire } from 'module';",
    "import { fileURLToPath as __xopcFileURLToPath } from 'node:url';",
    "import { dirname as __xopcDirname } from 'node:path';",
    'const __filename = __xopcFileURLToPath(import.meta.url);',
    'const __dirname = __xopcDirname(__filename);',
    'globalThis.require = __xopcCreateRequire(import.meta.url);',
  ].join('\n') },
});
writeDependencyRecords(join(root, 'out/server/dependency-records.json'), [
  ...gatewayRuntimeInputs,
  ...Object.keys(previewWorkerBuild.metafile.inputs),
], root);

for (const module of ['extensions/mcp/oauth.js', 'core/auth-storage.js']) {
  if (!gatewayRuntimeInputs.some(input =>
    input.endsWith(`/@earendil-works/pi-coding-agent/dist/${module}`))) {
    throw new Error(`[build-electron-server] Native MCP credential module was not bundled: ${module}`);
  }
}

// The result parser must remain outside the gateway event loop in packaged builds too.
await buildPersonalResultWorker(root, join(root, 'out/server/result-extraction.js'), minify);

// Use pi's release worker, which is self-contained and supports data: URL startup.
const piEntry = fileURLToPath(import.meta.resolve('@earendil-works/pi-coding-agent'));
cpSync(join(dirname(piEntry), 'bundle/chunks/codemode-worker.js'), join(root, 'out/server/codemode-worker.js'));

const requiredPiRuntimeModules = [
  ...['anthropic', 'openai-codex', 'openai-chatgpt', 'github-copilot', 'openrouter',
    'kimi-coding', 'meta', 'xai', 'radius'].map(name => `auth/oauth/${name}.js`),
  'api/bedrock-converse-stream.js',
];
for (const module of requiredPiRuntimeModules) {
  if (!gatewayRuntimeInputs.some(input =>
    input.endsWith(`/@earendil-works/pi-ai/dist/${module}`))) {
    throw new Error(`[build-electron-server] Required pi runtime module was not bundled: ${module}`);
  }
}

console.log(`[build-electron-server] Wrote ${runtimeFile}${minify ? ' (minified)' : ''}`);
// Enable V8's cache before the runtime bundle itself is loaded and compiled.
const launcher = `#!/usr/bin/env node
import { enableCompileCache } from 'node:module';

enableCompileCache();
await import('./gateway.js');
`;
writeFileSync(`${outfile}.tmp`, launcher, { mode: 0o755 });
renameSync(`${outfile}.tmp`, outfile);

copySqliteAssets(join(root, 'src/storage/sqlite'), join(root, 'out/server'));

// workspace-seed.ts resolves bundled templates next to the running module (`__dirname/workspace-templates`).
// Keep templates beside the Gateway bundle under out/server/.
const tplCandidates = [
  join(root, 'dist/src/agent/context/workspace-templates'),
  join(root, 'src/agent/context/workspace-templates'),
];
const tplSrc = tplCandidates.find((p) => existsSync(p));
const tplDest = join(root, 'out/server/workspace-templates');
if (tplSrc) {
  mkdirSync(dirname(tplDest), { recursive: true });
  cpSync(tplSrc, tplDest, { recursive: true });
  console.log(`[build-electron-server] Copied workspace templates to ${tplDest}`);
} else {
  console.error(
    `[build-electron-server] Missing workspace templates (tried:\n` +
      tplCandidates.map((p) => `  - ${p}`).join('\n') +
      `\n). Run \`pnpm run build\` first.\n`,
  );
  process.exit(1);
}
