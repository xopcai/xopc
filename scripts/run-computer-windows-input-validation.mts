/** Opt-in real model + Windows input check, limited to a disposable native app. */
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { build } from 'esbuild';
import { resolveCredentialsDir } from '../src/config/paths.js';
import { resolveModel } from '../src/providers/index.js';
import { computerModelProfile } from '../src/computer/model-policy.js';
import { getModelCatalogStore } from '../src/providers/model-catalog-store.js';

assert.equal(process.platform, 'win32'); assert.equal(process.arch, 'x64');
const modelRef = process.argv[2] ?? 'xopc-cloud/computer';
const model = resolveModel(modelRef);
const profile = computerModelProfile(model);
assert.ok(profile, 'Use an already configured Computer Use model');
const repo = resolve(import.meta.dirname, '..');
const output = join(repo, '.cache', 'computer-windows-input-validation', randomUUID());
await mkdir(output, { recursive: true });
const fixturePath = join(output, 'XopcInputFixture.exe');
const oraclePath = join(output, 'fixture-state.json');
const compileScript = join(output, 'compile.ps1');
await writeFile(compileScript, `$ErrorActionPreference='Stop'; Add-Type -Path $args[0] -OutputAssembly $args[1] -OutputType WindowsApplication -ReferencedAssemblies System.Windows.Forms,System.Drawing,System.Web.Extensions`);
const compiled = spawnSync(join(process.env.SystemRoot ?? 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe'),
  ['-NoLogo', '-NoProfile', '-NonInteractive', '-File', compileScript, join(repo, 'scripts/computer-input-fixture.cs'), fixturePath],
  { windowsHide: true, encoding: 'utf8', timeout: 30_000 });
assert.equal(compiled.status, 0, compiled.stderr);
// Native GUI fixture owns its own window; no command shell or existing app data.
const fixture = spawn(fixturePath, [oraclePath], { stdio: 'ignore' });
try {
  let ready = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    try { const state = JSON.parse(await readFile(oraclePath, 'utf8')); ready = state.pid === fixture.pid; } catch { /* Wait for the fixture's first write. */ }
    if (ready) break;
    await delay(100);
  }
  assert.ok(ready, 'Disposable input fixture did not start');
  const stateRoot = join(output, 'state'); await mkdir(stateRoot);
  await writeFile(join(stateRoot, 'models.json'), JSON.stringify({ providers: { [model.provider]: {
    baseUrl: model.baseUrl, api: model.api, models: [{ id: model.id, name: model.name, input: model.input,
      contextWindow: model.contextWindow, maxTokens: model.maxTokens, computerUse: { profile } }],
  } } }));
  const source = getModelCatalogStore().getSource(model.provider);
  if (source) await writeFile(join(stateRoot, 'model-catalog.json'), JSON.stringify({ ...source,
    models: source.models.filter(item => item.id === model.id) }));
  const entry = join(output, 'verify.mjs');
  await build({ entryPoints: [join(repo, 'scripts/verify-computer-windows-input.mts')], outfile: entry,
    bundle: true, platform: 'node', format: 'esm',
    external: ['electron', '@trycua/cua-driver', '@earendil-works/*', 'sharp', 'better-sqlite3'],
    banner: { js: 'import { createRequire as __createRequire } from "node:module"; const require = __createRequire(import.meta.url);' } });
  const env = { ...process.env, XOPC_STATE_DIR: stateRoot, XOPC_HOME: stateRoot,
    XOPC_CONFIG_PATH: join(stateRoot, 'xopc.json'), XOPC_CREDENTIALS_DIR: resolveCredentialsDir(),
    XOPC_SQLITE_ASSET_ROOT: join(repo, 'src/storage/sqlite'), XOPC_LOG_LEVEL: 'fatal', XOPC_LOG_FILE: 'false' };
  delete env.ELECTRON_RUN_AS_NODE;
  const result = spawnSync(createRequire(import.meta.url)('electron') as string, [entry,
    join(repo, '.cache/computer-driver/0.36.0/win32-x64/cua-driver.exe'), fixturePath, oraclePath, stateRoot, modelRef],
    { cwd: repo, env, windowsHide: true, stdio: 'inherit', timeout: 600_000 });
  assert.equal(result.status, 0, `Input validation failed without replay: ${result.error?.message ?? 'see output'}`);
  console.log(`Windows input evidence: ${join(output, 'result.json')}`);
} finally { fixture.kill(); }
