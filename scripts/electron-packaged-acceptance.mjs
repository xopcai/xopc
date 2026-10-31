import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstat, readFile, readdir } from 'node:fs/promises';
import { join, resolve, relative } from 'node:path';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { createRequire } from 'node:module';
import { setTimeout as delay } from 'node:timers/promises';

import { chromium } from 'playwright-core';

/** Only state locations are injected; production code locates its own runtime assets. */
export function packagedAcceptanceEnvironment(env) {
  return Object.fromEntries(Object.entries(env).filter(([key]) => ![
    'XOPC_UI_STATIC_ROOT', 'XOPC_SQLITE_ASSET_ROOT', 'XOPC_TEMPLATE_PATH',
    'XOPC_BUNDLED_EXTENSIONS_ROOT', 'XOPC_BUNDLED_SKILLS_ROOT', 'XOPC_PLAYWRIGHT_CORE_ROOT',
    'XOPC_BROWSER_EXT_BUNDLED_ROOT', 'ELECTRON_RENDERER_URL', 'ELECTRON_RUN_AS_NODE',
    'NODE_PATH', 'NODE_OPTIONS',
  ].includes(key)));
}

/** Match only application roots, including paths containing spaces, never their Gateway subprocesses. */
export function installedApplicationPids(rows, executablePaths) {
  return rows.split('\n').flatMap(row => {
    const match = row.trim().match(/^(\d+)\s+(.+)$/);
    if (!match) return [];
    const command = match[2];
    return executablePaths.some(path => command === path || command.startsWith(`${path} `))
      && !command.includes('out/server/index.js') ? [Number(match[1])] : [];
  });
}

/** Include orphaned helpers and bundled CLI processes when checking a test bundle is idle. */
export function installedBundleProcesses(rows, applicationPaths) {
  return rows.split('\n').flatMap(row => {
    const match = row.trim().match(/^(\d+)\s+(.+)$/);
    return match && applicationPaths.some(path => match[2].startsWith(`${path}/Contents/`))
      ? [{ pid: Number(match[1]), executable: match[2] }] : [];
  });
}

/** Fingerprint the entire installed application, including unpacked and native resources. */
export async function installedAppFingerprint(directory) {
  const files = {};
  async function walk(path) {
    const stat = await lstat(path);
    if (stat.isSymbolicLink()) {
      const { readlink } = await import('node:fs/promises');
      files[relative(directory, path)] = `symlink:${await readlink(path)}`;
    } else if (stat.isDirectory()) {
      for (const entry of (await readdir(path)).sort()) await walk(join(path, entry));
    } else if (stat.isFile()) files[relative(directory, path)] = createHash('sha256').update(await readFile(path)).digest('hex');
  }
  await walk(directory);
  return { files: Object.keys(files).length, sha256: createHash('sha256').update(JSON.stringify(files)).digest('hex') };
}

export async function macPackagedTarget(path) {
  assert.equal(process.platform, 'darwin', 'This installed-app runner currently supports macOS only');
  const application = resolve(path);
  assert(application.endsWith('.app'), 'Expected a macOS .app directory');
  const resources = join(application, 'Contents/Resources');
  await lstat(join(resources, 'app.asar'));
  const require = createRequire(import.meta.url);
  const builderRequire = createRequire(require.resolve('electron-builder/package.json'));
  const { getCurrentFuseWire, FuseV1Options } = builderRequire('@electron/fuses');
  const wire = await getCurrentFuseWire(application);
  assert.equal(wire[FuseV1Options.EnableNodeCliInspectArguments], 48, 'Installed acceptance must preserve disabled Node inspection');
  assert.equal(wire[FuseV1Options.OnlyLoadAppFromAsar], 49, 'Installed acceptance must load app.asar');
  return { application, resources, executablePath: join(application, 'Contents/MacOS/xopc'),
    server: join(resources, 'app.asar.unpacked/out/server/index.js'), fuses: wire };
}

/** Match the production supervisor's asset locations for an external bundled CLI fixture. */
export function packagedGatewayEnvironment(env, target) {
  const unpacked = join(target.resources, 'app.asar.unpacked');
  return { ...env, ELECTRON_RUN_AS_NODE: '1', XOPC_SQLITE_ASSET_ROOT: join(unpacked, 'out/server'),
    XOPC_UI_STATIC_ROOT: join(unpacked, 'dist/gateway/static/root'),
    XOPC_TEMPLATE_PATH: join(unpacked, 'out/server/workspace-templates'),
    XOPC_BUNDLED_EXTENSIONS_ROOT: join(unpacked, 'dist/electron/extensions'),
    XOPC_BUNDLED_SKILLS_ROOT: join(unpacked, 'skills') };
}

/** Reap only this test application's descendants when a failure leaves a quit dialog. */
export function killAcceptanceApplication(application) {
  const pid = application.process().pid;
  const rows = execFileSync('ps', ['-axo', 'pid=,ppid='], { encoding: 'utf8' }).trim().split('\n').map(row => row.trim().split(/\s+/).map(Number));
  const ids = new Set([pid]);
  let changed = true;
  while (changed) { changed = false; for (const [child, parent] of rows) if (ids.has(parent) && !ids.has(child)) { ids.add(child); changed = true; } }
  for (const child of [...ids].reverse()) { try { process.kill(child, 'SIGKILL'); } catch { /* Already stopped. */ } }
}

/** Production fuses disable Node inspection; drive only the Chromium Renderer endpoint. */
export async function launchInstalledApplication(target, args, env, cwd, timeout = 30_000, { preserveBrowserDefaults = false } = {}) {
  const probe = createServer(); probe.listen(0, '127.0.0.1'); await once(probe, 'listening');
  const port = probe.address().port; await new Promise(resolve => probe.close(resolve));
  const child = spawn(target.executablePath, [...args, `--remote-debugging-port=${port}`, '--remote-debugging-address=127.0.0.1'], { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = ''; for (const stream of [child.stdout, child.stderr]) stream.on('data', chunk => { output = (output + chunk).slice(-8000); });
  const exit = new Promise(resolve => child.once('exit', resolve));
  const adapter = { process: () => child };
  let browser;
  try {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      if (child.exitCode !== null || child.signalCode !== null) throw new Error('Installed application exited before Renderer CDP was ready');
      try { const response = await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(1000) }); if (response.ok) break; } catch { /* Wait within the existing startup budget. */ }
      await delay(100);
    }
    assert(Date.now() < deadline, 'Installed application startup deadline exceeded');
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`, { timeout: Math.max(1, deadline - Date.now()), noDefaults: preserveBrowserDefaults });
    const context = browser.contexts()[0]; assert(context);
    return { ...adapter, windows: () => context.pages(),
      firstWindow: async () => context.pages()[0] ?? await context.waitForEvent('page', { timeout: 30_000 }),
      metadata: { executable: target.executablePath, appAsar: join(target.resources, 'app.asar'), cwd, rendererCdpOnly: true, preserveBrowserDefaults, fuses: target.fuses, pid: child.pid },
      output: () => output,
      close: async () => {
        if (child.exitCode !== null || child.signalCode !== null) { await browser.close().catch(() => {}); return; }
        const cdp = await browser.newBrowserCDPSession();
        void cdp.send('Browser.close').catch(() => {});
        let timer;
        try { await Promise.race([exit, new Promise((_, reject) => { timer = setTimeout(() => { killAcceptanceApplication(adapter); reject(new Error('Installed application shutdown exceeded 15 seconds')); }, 15_000); })]); }
        finally { clearTimeout(timer); await browser.close().catch(() => {}); }
      },
    };
  } catch (error) { killAcceptanceApplication(adapter); await browser?.close().catch(() => {}); throw error; }
}

export function killInstalledShellWorker(application) {
  const rows = execFileSync('ps', ['-axo', 'pid=,ppid=,args='], { encoding: 'utf8' }).trim().split('\n');
  const children = rows.map(row => row.trim().match(/^(\d+)\s+(\d+)\s+(.*)$/)).filter(row => row && Number(row[2]) === application.process().pid && row[3].includes('--utility-sub-type=node.mojom.NodeService'));
  assert.equal(children.length, 1, 'Expected exactly one owned Shell utility process');
  process.kill(Number(children[0][1]), 'SIGKILL');
}
