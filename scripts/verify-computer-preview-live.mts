/** Opt-in local capture acceptance against a disposable native fixture. */
import assert from 'node:assert/strict';
import { spawn, execFile } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdir, readFile, writeFile, copyFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { build } from 'esbuild';

assert.equal(process.platform, 'darwin');
const repo = resolve(import.meta.dirname, '..');
const root = join(repo, '.cache/computer-preview-live', new Date().toISOString().replace(/[:.]/g, '-'));
const contents = join(root, 'XopcPreviewBenchmark.app/Contents');
await mkdir(join(contents, 'MacOS'), { recursive: true });
await mkdir(join(root, 'main'), { recursive: true }); await mkdir(join(root, 'preload'), { recursive: true });
await writeFile(join(contents, 'Info.plist'), '<?xml version="1.0"?><plist version="1.0"><dict><key>CFBundleIdentifier</key><string>ai.xopc.preview-benchmark</string><key>CFBundleName</key><string>XopcPreviewBenchmark</string><key>CFBundleExecutable</key><string>XopcPreviewBenchmark</string><key>CFBundlePackageType</key><string>APPL</string></dict></plist>');
const swift = (await readFile(join(repo, 'scripts/fixtures/ComputerInputBenchmark.swift'), 'utf8'))
  .replace('window.makeKeyAndOrderFront(nil)', 'window.orderBack(nil)').replace('NSApp.activate(ignoringOtherApps: true)', '');
await writeFile(join(root, 'fixture.swift'), swift);
await promisify(execFile)('xcrun', ['swiftc', join(root, 'fixture.swift'), '-o', join(contents, 'MacOS/XopcPreviewBenchmark')]);
await Promise.all([
  build({ entryPoints: [join(repo, 'scripts/fixtures/computer-preview-live.mts')], outfile: join(root, 'main/verify.mjs'),
    bundle: true, platform: 'node', format: 'esm', external: ['electron', '@trycua/cua-driver'],
    banner: { js: 'import { createRequire as __previewRequire } from "node:module"; const require = __previewRequire(import.meta.url);' } }),
  build({ entryPoints: [join(repo, 'electron/computer/preview-worker.ts')], outfile: join(root, 'preload/computer-preview.cjs'),
    bundle: true, platform: 'node', format: 'cjs', external: ['electron'] }),
  build({ entryPoints: [join(repo, 'electron/preload.ts')], outfile: join(root, 'preload/index.cjs'),
    bundle: true, platform: 'node', format: 'cjs', external: ['electron'] }),
  copyFile(join(repo, 'electron/computer/preview-worker.html'), join(root, 'preload/computer-preview.html')),
  writeFile(join(root, 'viewer.html'), '<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; img-src blob:"></head><body><canvas id="preview"></canvas></body></html>'),
]);
const fixture = spawn(join(contents, 'MacOS/XopcPreviewBenchmark'), [join(root, 'fixture-state.json')], { stdio: 'ignore' });
try {
  for (let n = 0; ; n++) {
    if (await readFile(join(root, 'fixture-state.json'), 'utf8').then(() => true, () => false)) break;
    assert.ok(n < 80, 'Fixture did not become ready'); await new Promise(resolve => setTimeout(resolve, 50));
  }
  const env = { ...process.env, XOPC_LOG_LEVEL: process.env.XOPC_LOG_LEVEL ?? 'fatal', XOPC_LOG_FILE: 'false' }; delete env.ELECTRON_RUN_AS_NODE;
  const electron = createRequire(import.meta.url)('electron') as string;
  const child = spawn(electron, [join(root, 'main/verify.mjs'), repo, root], { env, stdio: 'inherit', timeout: 120_000 });
  const code = await new Promise<number | null>((resolve, reject) => { child.once('error', reject); child.once('exit', resolve); });
  console.log(JSON.stringify({ evidence: root, report: JSON.parse(await readFile(join(root, 'report.json'), 'utf8')) }, null, 2));
  process.exitCode = code ?? 1;
} finally { fixture.kill('SIGTERM'); }
