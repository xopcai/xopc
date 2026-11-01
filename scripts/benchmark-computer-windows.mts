/** Native regression matrix: disposable applications, scripted actions, no model requests. */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';
import { build } from 'esbuild';
import { COMPUTER_DRIVER_VERSION, computerDriverRelease } from './lib/computer-driver-release.mjs';
import { WINDOWS_COMPUTER_BENCHMARK_VERSION, WINDOWS_COMPUTER_FRAMEWORKS, WINDOWS_COMPUTER_TASKS } from './computer-benchmark/suite.mjs';

const { values } = parseArgs({ options: { list: { type: 'boolean' }, repetitions: { type: 'string', default: '3' }, output: { type: 'string' } } });
if (values.list) {
  console.log(JSON.stringify({ version: WINDOWS_COMPUTER_BENCHMARK_VERSION, frameworks: WINDOWS_COMPUTER_FRAMEWORKS, tasks: WINDOWS_COMPUTER_TASKS }, null, 2));
} else {
  assert.equal(process.platform, 'win32', 'Use an interactive Windows x64 desktop');
  assert.equal(process.arch, 'x64');
  const repetitions = Number(values.repetitions);
  assert.ok(Number.isInteger(repetitions) && repetitions >= 1 && repetitions <= 5, 'Use 1–5 repetitions');
  const repo = resolve(import.meta.dirname, '..');
  const output = resolve(values.output ?? join(repo, '.cache/computer-benchmark-windows', randomUUID()));
  await mkdir(dirname(output), { recursive: true });
  await mkdir(output); // Existing evidence must never be overwritten.
  const driver = join(repo, '.cache/computer-driver', COMPUTER_DRIVER_VERSION, 'win32-x64/cua-driver.exe');
  await access(driver);
  const sha = (data: Uint8Array) => createHash('sha256').update(data).digest('hex');
  for (const [file, checksum] of Object.entries(computerDriverRelease('win32', 'x64').files)) {
    assert.equal(sha(await readFile(join(dirname(driver), file))), checksum, `Driver checksum mismatch: ${file}`);
  }
  const files = ['electron/computer/cua-driver.ts', 'electron/computer/windows-input.ts', 'electron/computer/windows-native.ts',
    'electron/computer/windows-reader.ts', 'electron/computer/windows-accessibility.ts',
    'src/computer/broker.ts', 'src/computer/task-state.ts', 'scripts/computer-input-fixture.cs', 'scripts/computer-wpf-fixture.cs',
    'scripts/benchmark-computer-windows.mts', 'scripts/computer-benchmark/suite.mts', 'scripts/computer-benchmark/windows-worker.mts', 'pnpm-lock.yaml'];
  const sourceHashes = Object.fromEntries(await Promise.all(files.map(async file => [file, sha(await readFile(join(repo, file)))])));
  const manifest = { version: WINDOWS_COMPUTER_BENCHMARK_VERSION, repetitions, frameworks: WINDOWS_COMPUTER_FRAMEWORKS,
    tasks: WINDOWS_COMPUTER_TASKS, sourceHashes, driverVersion: COMPUTER_DRIVER_VERSION, startedAt: new Date().toISOString(),
    evidence: 'native', modelRef: 'scripted/no-model', scope: 'Broker and native driver with app-owned oracle files; no model, Gateway network, Qt application, installer or production quality certification.' };
  await writeFile(join(output, 'manifest.json'), JSON.stringify(manifest, null, 2));
  const children = new Set<ReturnType<typeof spawn>>();
  const results: Array<{ framework: string; summary: any; runs: any[]; probes: unknown[] }> = [];
  const controller = new AbortController();
  const abort = () => { controller.abort(); for (const child of children) child.kill(); };
  process.once('SIGINT', abort); process.once('SIGTERM', abort);
  const run = async (file: string, args: string[], timeout: number, env = process.env) => {
    const child = spawn(file, args, { cwd: repo, env, windowsHide: true, stdio: 'inherit', timeout, signal: controller.signal });
    children.add(child);
    try { return await new Promise<number | null>((done, reject) => { child.once('error', reject); child.once('exit', done); }); }
    finally { children.delete(child); }
  };
  try {
    const compile = join(output, 'compile.ps1');
    await writeFile(compile, `$ErrorActionPreference='Stop'; $wpf=Join-Path $env:SystemRoot 'Microsoft.NET/Framework64/v4.0.30319/WPF'; $refs=if($args[2] -eq 'wpf'){@('System.Web.Extensions',(Join-Path $wpf 'PresentationFramework.dll'),(Join-Path $wpf 'PresentationCore.dll'),(Join-Path $wpf 'WindowsBase.dll'),'System.Xaml')}else{@('System.Windows.Forms','System.Drawing','System.Web.Extensions')}; Add-Type -Path $args[0] -OutputAssembly $args[1] -OutputType WindowsApplication -ReferencedAssemblies $refs`);
    const entry = join(output, 'worker.mjs');
    await build({ entryPoints: [join(repo, 'scripts/computer-benchmark/windows-worker.mts')], outfile: entry,
      bundle: true, platform: 'node', format: 'esm', external: ['electron', '@trycua/cua-driver', '@earendil-works/*'],
      banner: { js: 'import { createRequire } from "node:module"; const require = createRequire(import.meta.url);' } });
    for (const framework of WINDOWS_COMPUTER_FRAMEWORKS) {
      const root = join(output, framework); await mkdir(root);
      const fixture = join(root, `XopcBenchmark${framework}.exe`), oracle = join(root, 'oracle.json');
      const source = framework === 'wpf' ? 'computer-wpf-fixture.cs' : 'computer-input-fixture.cs';
      assert.equal(await run(join(process.env.SystemRoot!, 'System32/WindowsPowerShell/v1.0/powershell.exe'),
        ['-NoLogo', '-NoProfile', '-NonInteractive', '-File', compile, join(repo, 'scripts', source), fixture, framework], 30000), 0);
      const gui = spawn(fixture, [oracle], { stdio: 'ignore' }); children.add(gui);
      try {
        let ready = false;
        for (let i = 0; i < 100; i++) {
          controller.signal.throwIfAborted();
          if (gui.exitCode !== null) throw new Error('COMPUTER_BENCHMARK_FIXTURE_EXITED');
          try { ready = JSON.parse(await readFile(oracle, 'utf8')).pid === gui.pid; } catch { /* Fixture writes atomically. */ }
          if (ready) break;
          await delay(100, undefined, { signal: controller.signal });
        }
        assert.ok(ready, 'Fixture did not publish its oracle');
        const env: NodeJS.ProcessEnv = { ...process.env, XOPC_LOG_LEVEL: 'fatal', XOPC_LOG_FILE: 'false' }; delete env.ELECTRON_RUN_AS_NODE;
        const code = await run(createRequire(import.meta.url)('electron') as string,
          [entry, driver, fixture, oracle, root, String(repetitions), String(gui.pid), framework], 600000, env);
        const result = JSON.parse(await readFile(join(root, 'result.json'), 'utf8'));
        results.push({ framework, ...result });
        if (code !== 0) process.exitCode = 1;
        if (result.summary.missingRuns || result.runs.some((run: any) => run.outcome === 'unknown'
          || run.duplicateInputs || run.scopeViolations || run.postStopInputs)) break;
      } finally { gui.kill(); children.delete(gui); }
    }
    for (const [file, hash] of Object.entries(sourceHashes)) assert.equal(sha(await readFile(join(repo, file))), hash, `Source drift: ${file}`);
    await writeFile(join(output, 'summary.json'), JSON.stringify({ version: manifest.version, sourceDrift: false,
      expectedRuns: WINDOWS_COMPUTER_TASKS.length * repetitions * WINDOWS_COMPUTER_FRAMEWORKS.length,
      completedRuns: results.reduce((n, r) => n + r.summary.completedRuns, 0), passed: results.reduce((n, r) => n + r.summary.passed, 0),
      failed: results.reduce((n, r) => n + r.summary.failed, 0), unknown: results.reduce((n, r) => n + r.summary.unknown, 0),
      results: results.map(r => ({ framework: r.framework, summary: r.summary, probes: r.probes })),
      evidence: manifest.evidence, modelRequests: 0, releaseCertified: false }, null, 2));
    console.log(`Windows benchmark evidence: ${output}`);
  } catch (error) {
    await writeFile(join(output, 'interruption.json'), JSON.stringify({ at: new Date().toISOString(),
      reason: error instanceof Error ? error.message : 'Benchmark interrupted', incomplete: true }, null, 2));
    process.exitCode = 1;
    console.error(`Benchmark incomplete; preserved evidence: ${output}`);
  } finally { abort(); process.off('SIGINT', abort); process.off('SIGTERM', abort); }
}
