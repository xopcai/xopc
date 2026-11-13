import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { automaticDesktopUpdatesEnabled, DESKTOP_UPDATE_REGISTRY_KEY } from '../electron/update-preferences.ts';
import { launchInstalledApplication, packagedAcceptanceEnvironment } from './electron-packaged-acceptance.mjs';
import { localConnectionEnvironment } from './electron-local-connection-support.mjs';

assert.equal(process.platform, 'win32');
const root = resolve(import.meta.dirname, '..');
const version = JSON.parse(await readFile(join(root, 'package.json'))).version;
const installer = resolve(process.argv[2] ?? `dist/release/xopc-${version}-${process.arch}.exe`);
const output = process.argv[3] ?? `reports/windows-signpath-${process.arch}.json`;
const ps = join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe');
const run = (file, args, timeout = 180_000) => { const r = spawnSync(file, args, { encoding: 'utf8', windowsHide: true, timeout }); assert.equal(r.status, 0, r.error?.message ?? `${r.stderr}\n${r.stdout}`); return r.stdout; };
const psRun = code => run(ps, ['-NoProfile', '-NonInteractive', '-Command', code]);
// Production NSIS identity must never replace an existing user's installation or consent.
psRun("if ((Get-ItemProperty 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*' -ErrorAction SilentlyContinue | Where-Object DisplayName -EQ 'xopc') -or (Get-Process xopc -ErrorAction SilentlyContinue) -or (Test-Path 'HKCU:\\Software\\xopc\\Desktop')) { exit 9 }");
const state = await mkdtemp(join(tmpdir(), 'xopc-signpath-installed-'));
const installed = join(state, 'app');
const report = { passed: false, version, arch: process.arch, state, checks: {}, scope: 'Real NSIS privacy page, consent persistence, installed packaged app/Gateway; no Foundation signing or signed update claim' };
let app;
try {
  report.checks.nativePrivacy = run(ps, ['-NoProfile', '-File', join(root, 'scripts/verify-windows-installer-ui.ps1'), '-Installer', installer], 90_000).includes('PASS:');
  const install = args => run(installer, ['/S', ...args, `/D=${installed}`]);
  install([]);
  assert.equal(await automaticDesktopUpdatesEnabled(), false);
  assert((await readFile(join(installed, 'desktop-privacy.txt'), 'utf8')).includes('Automatic desktop updates'));
  report.checks.defaultOff = true;
  install(['/AUTOMATICUPDATES=1']); assert.equal(await automaticDesktopUpdatesEnabled(), true);
  install([]); assert.equal(await automaticDesktopUpdatesEnabled(), true);
  install(['/AUTOMATICUPDATES=0']); assert.equal(await automaticDesktopUpdatesEnabled(), false);
  install([]); assert.equal(await automaticDesktopUpdatesEnabled(), false);
  report.checks.upgradePreservesBothChoices = true;
  const helper = join(installed, 'resources/bin/voice-hotkey-helper.exe');
  const metadata = JSON.parse(psRun(`$v=[Diagnostics.FileVersionInfo]::GetVersionInfo('${helper.replaceAll("'", "''")}'); @{product=$v.ProductName;version=$v.ProductVersion;file=$v.FileVersion} | ConvertTo-Json -Compress`));
  assert.deepEqual(metadata, { product: 'xopc', version, file: `${version}.0` });
  report.checks.helperMetadata = metadata;
  report.checks.projectPeMetadata = [];
  for (const path of [join(installed, 'xopc.exe'), installer, join(installed, 'Uninstall xopc.exe')]) {
    const value = JSON.parse(psRun(`$v=[Diagnostics.FileVersionInfo]::GetVersionInfo('${path.replaceAll("'", "''")}'); @{product=$v.ProductName;version=$v.ProductVersion;file=$v.FileVersion} | ConvertTo-Json -Compress`));
    assert.equal(value.product, 'xopc');
    assert([version, version + '.0'].includes(value.file));
    assert([version, version + '.0'].includes(value.version));
    report.checks.projectPeMetadata.push(value);
  }
  const inventory = JSON.parse(await readFile(join(installed, 'resources/compliance/dependency-inventory.json')));
  assert.equal(inventory.target.platform, 'win32'); assert.equal(inventory.target.arch, process.arch); assert(inventory.packages.length);
  assert.equal(inventory.signPathReady, false);
  const boundary = JSON.parse(await readFile(join(installed, 'resources/compliance/signing-boundary.json')));
  assert(boundary.binaries.filter(b => /cua|rg.exe|\.node$/.test(b.file)).every(b => b.signing === 'third-party-do-not-resign'));
  report.checks.inventory = { packages: inventory.packages.length, files: Object.keys(inventory.files).length, reviewRequired: inventory.reviewRequired.length };
  const probe = createServer(); probe.listen(0, '127.0.0.1'); await once(probe, 'listening');
  const port = probe.address().port; await new Promise(r => probe.close(r));
  const config = join(state, 'xopc.json'), workspace = join(state, 'workspace'); await mkdir(workspace);
  const token = randomUUID(); await writeFile(config, JSON.stringify({ gateway: { bind: 'loopback', port, auth: { mode: 'token', token } }, browser: { enabled: false }, computer: { enabled: false } }));
  const env = packagedAcceptanceEnvironment(localConnectionEnvironment(process.env, root, state, config, workspace));
  env.XOPC_UPDATE_FEED_URL = 'https://updates.invalid.example/signpath-readiness';
  app = await launchInstalledApplication({ executablePath: join(installed, 'xopc.exe'), application: installed,
    resources: join(installed, 'resources'), fuses: 'production' }, [], env, state, 60_000);
  let ready = false;
  for (let i = 0; i < 300; i++) {
    try { const r = await fetch(`http://127.0.0.1:${port}/api/config`, { headers: { Authorization: `Bearer ${token}` } }); if (r.ok) { ready = true; break; } } catch {}
    await delay(100);
  }
  assert(ready, 'Installed local Gateway must become ready');
  await delay(35_000);
  const logs = await readFile(join(state, 'electron/electron-startup.log'), 'utf8').catch(() => '');
  const runtimeLogs = app.output() + logs;
  // Unit tests prove no timer/download/check invocation; this verifies the actual stored consent and normal startup.
  report.checks.localGatewayReadyWithUpdatesOff = true;
  const page = await app.firstWindow();
  const updater = await page.evaluate(() => window.electronAPI.updater.getStatus());
  assert.equal(updater.state, 'idle', 'Opted-out installed app must not start background update traffic');
  report.checks.updateStatusAfterStartupDelay = updater.state;
  const manual = await page.evaluate(() => window.electronAPI.updater.check());
  assert.equal(manual.ok, true);
  await delay(1000);
  const manualState = await page.evaluate(() => window.electronAPI.updater.getStatus());
  assert.notEqual(manualState.state, 'idle');
  report.checks.explicitManualUpdateCheck = manualState.state;
  report.checks.updaterObserved = runtimeLogs.includes('Automatic desktop updates disabled');
  await app.close(); app = undefined;
  const upgradeUi = run(ps, ['-NoProfile', '-File', join(root, 'scripts/verify-windows-installer-ui.ps1'),
    '-Installer', installer, '-UpgradeInstallDirectory', installed], 180_000);
  assert(upgradeUi.includes('PASS: assisted upgrade opened xopc from the finish page'));
  assert.equal(await automaticDesktopUpdatesEnabled(), false);
  report.checks.assistedUpgradeLaunch = true;
  const uninstaller = join(installed, 'Uninstall xopc.exe'); assert(existsSync(uninstaller)); run(uninstaller, ['/S']);
  report.checks.uninstall = true;
  report.installerSha256 = createHash('sha256').update(await readFile(installer)).digest('hex');
  report.passed = true;
} catch (error) { report.error = String(error.stack ?? error); throw error; }
finally {
  await app?.close().catch(() => {});
  // Disposable runner: remove only the dedicated consent key created after the preflight.
  spawnSync('reg.exe', ['delete', DESKTOP_UPDATE_REGISTRY_KEY, '/f', '/reg:64'], { stdio: 'ignore' });
  await mkdir(resolve(output, '..'), { recursive: true }); await writeFile(output, JSON.stringify(report, null, 2) + '\n');
}
