/** Compile the actual legacy NSIS process check and patched upgrade flow; run them on Windows. */
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const builder = createRequire(require.resolve('electron-builder/package.json'));
const { getMakeNsisPath, getNsisPluginsPath } = builder('app-builder-lib/out/toolsets/windows.js');
const templates = join(dirname(builder.resolve('app-builder-lib/package.json')), 'templates/nsis');
const fixture = mkdtempSync(join(tmpdir(), "xopc upgrade user's 测试-"));
const oldDirectory = join(fixture, 'old');
const newDirectory = join(fixture, 'new');
const registryKey = `Software\\xopc\\InstallerRegression\\${randomUUID()}`;
const uninstallKey = registryKey + '\\Uninstall';
const report = { compiled: false, native: false, checks: [] };
const processes = [];
const quote = value => value.replaceAll('$', '$$').replaceAll('"', '$\\"');
const tool = await getMakeNsisPath();
const plugins = await getNsisPluginsPath();
function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: 'utf8', timeout: 60_000, ...options });
  if (result.error) throw result.error;
  return result;
}
function compile(name, body) {
  const source = join(fixture, name + '.nsi');
  writeFileSync(source, `\uFEFFUnicode true
!addincludedir "${quote(join(templates, 'include'))}"
!addincludedir "${quote(templates)}"
!addplugindir /x86-unicode "${quote(join(plugins, 'x86-unicode'))}"
!include LogicLib.nsh
!include MUI2.nsh
!define APP_EXECUTABLE_FILENAME "xopc.exe"
!define INSTALL_REGISTRY_KEY "${registryKey}"
!define UNINSTALL_REGISTRY_KEY "${uninstallKey}"
!define BUILD_RESOURCES_DIR "${quote(join(root, 'electron/resources'))}"
!define isUpdated '1 == 1'
!define isDeleteAppData '0 == 1'
Name "xopc installer regression"
OutFile "${quote(join(fixture, name + '.exe'))}"
RequestExecutionLevel user
SilentInstall silent
LangString appRunning 1033 "xopc running"
LangString appClosing 1033 "Closing xopc"
LangString appCannotBeClosed 1033 "Cannot close xopc"
LangString uninstallFailed 1033 "Uninstall failed"
${body}`);
  const result = run(tool.path, ['-V2', source], { env: { ...process.env, ...tool.env } });
  assert.equal(result.status, 0, result.stdout + result.stderr);
}
function powershell(code, extraEnv = {}) {
  const result = run('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', code], {
    env: { ...process.env, ...extraEnv },
  });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  return result.stdout.trim();
}
function processScript(mode, additionalArgs = []) {
  return run('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File',
    join(root, 'electron/resources/installer-processes.ps1'), '-Mode', mode, '-InstallDirectory', newDirectory,
    '-InstallRegistryKey', registryKey, '-InstallerProcessId', String(process.pid), '-WaitSeconds', '0', ...additionalArgs]);
}
async function keeper(path) {
  mkdirSync(dirname(path), { recursive: true });
  cpSync(join(fixture, 'keeper.exe'), path);
  const child = spawn(path, ['/S'], { stdio: 'ignore' });
  processes.push(child);
  await new Promise((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject); });
  await new Promise(resolve => setTimeout(resolve, 500));
  return child;
}
try {
  compile('legacy', `
!define BUILD_UNINSTALLER
!include allowOnlyOneInstallerInstance.nsh
InstallDir "${quote(oldDirectory)}"
Section
  CreateDirectory "$INSTDIR"
  WriteUninstaller "$INSTDIR\\Uninstall xopc.exe"
SectionEnd
Section "Uninstall"
  !insertmacro CHECK_APP_RUNNING
  IfFileExists "$INSTDIR\\fail-uninstall" 0 +3
    SetErrorLevel 42
    Quit
  Delete "$INSTDIR\\legacy-marker"
SectionEnd
`);
  compile('upgrade', `
!include StdUtils.nsh
!include "${quote(join(root, 'electron/resources/external-intake.nsh'))}"
Var installMode
Var appExe
!include installUtil.nsh
InstallDir "${quote(newDirectory)}"
Section
  StrCpy $installMode CurrentUser
  SetShellVarContext current
  SetRegView 64
  StrCpy $appExe "$INSTDIR\\xopc.exe"
  !insertmacro customCheckAppRunning
  !insertmacro uninstallOldVersion SHELL_CONTEXT
  !insertmacro handleUninstallResult SHELL_CONTEXT
  CreateDirectory "$INSTDIR"
  FileOpen $0 "$INSTDIR\\new-marker" w
  FileClose $0
SectionEnd
`);
  compile('uninstall', `
!define BUILD_UNINSTALLER
!include "${quote(join(root, 'electron/resources/external-intake.nsh'))}"
Section
  WriteUninstaller "$TEMP\\xopc-regression-uninstall.exe"
SectionEnd
Section "Uninstall"
  !insertmacro customCheckAppRunning
SectionEnd
`);
  compile('keeper', 'Section\n Sleep 300000\nSectionEnd\n');
  report.compiled = true;
  report.checks.push('legacy NSIS, patched upgrade and new uninstall branches compile');
  if (process.argv.includes('--compile-only')) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    assert.equal(process.platform, 'win32', 'Native acceptance requires Windows; use --compile-only elsewhere.');
    assert.equal(run(join(fixture, 'legacy.exe'), ['/S']).status, 0);
    powershell(`$key = $env:XOPC_REGRESSION_KEY; New-Item -Path ('HKCU:\\' + $key) -Force | Out-Null;
      Set-ItemProperty -LiteralPath ('HKCU:\\' + $key) -Name InstallLocation -Value $env:XOPC_REGRESSION_OLD;
      New-Item -Path ('HKCU:\\' + $key + '\\Uninstall') -Force | Out-Null;
      Set-ItemProperty -LiteralPath ('HKCU:\\' + $key + '\\Uninstall') -Name UninstallString -Value ('"' + $env:XOPC_REGRESSION_OLD + '\\Uninstall xopc.exe"')`,
    { XOPC_REGRESSION_KEY: registryKey, XOPC_REGRESSION_OLD: oldDirectory });
    const sibling = await keeper(join(oldDirectory + '-backup', 'xopc.exe'));
    const app = await keeper(join(oldDirectory, 'xopc.exe'));
    writeFileSync(join(oldDirectory, 'legacy-marker'), 'keep until successful uninstall');
    assert.equal(processScript('check').status, 10, 'must find the registered previous directory');
    assert.equal(run(join(fixture, 'upgrade.exe'), ['/S']).status, 2, 'silent cancellation must report failure');
    assert.ok(existsSync(join(oldDirectory, 'legacy-marker')));
    assert.ok(!existsSync(join(newDirectory, 'new-marker')));
    assert.equal(processScript('force').status, 0, 'must stop only the registered old app');
    report.checks.push('changed directory, registry discovery, silent cancellation and scoped force');
    const helper = await keeper(join(oldDirectory, 'resources/bin/cua-driver.exe'));
    assert.equal(processScript('check').status, 10, 'orphaned helper must block replacement');
    assert.equal(processScript('force').status, 0, 'must reap helper without its parent');
    report.checks.push('orphaned native helper detected and stopped');
    writeFileSync(join(oldDirectory, 'fail-uninstall'), 'fail');
    assert.equal(run(join(fixture, 'upgrade.exe'), ['/S']).status, 2, 'legacy uninstall failure must abort upgrade');
    assert.ok(existsSync(join(oldDirectory, 'legacy-marker')));
    assert.ok(!existsSync(join(newDirectory, 'new-marker')));
    rmSync(join(oldDirectory, 'fail-uninstall'));
    assert.equal(run(join(fixture, 'upgrade.exe'), ['/S']).status, 0);
    assert.ok(!existsSync(join(oldDirectory, 'legacy-marker')), 'actual legacy uninstaller must execute');
    assert.ok(existsSync(join(newDirectory, 'new-marker')));
    assert.equal(sibling.exitCode, null, 'legacy prefix matching must not terminate a sibling installation');
    assert.ok(app.pid && helper.pid);
    report.checks.push('legacy failure preserves files; retry succeeds; sibling process survives legacy uninstall');
    // Exercise the native Restart Manager binding against an actual running executable.
    const locker = await keeper(join(fixture, 'locked.exe'));
    const owners = powershell(`. $env:XOPC_LOCK_SCRIPT; @(Get-XopcLockingProcessIds @($env:XOPC_LOCK_FILE)) | ConvertTo-Json -Compress`, {
      XOPC_LOCK_SCRIPT: join(root, 'electron/resources/installer-file-locks.ps1'), XOPC_LOCK_FILE: join(fixture, 'locked.exe'),
    });
    assert.ok([JSON.parse(owners)].flat().includes(locker.pid));
    report.checks.push('native Restart Manager identifies actual executable lock owner');
    report.native = true;
    console.log(JSON.stringify(report, null, 2));
  }
} finally {
  if (process.platform === 'win32') {
    for (const child of processes) {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill();
        await new Promise(resolve => {
          const timer = setTimeout(resolve, 2000);
          child.once('exit', () => { clearTimeout(timer); resolve(); });
        });
      }
    }
    powershell(`Remove-Item -LiteralPath ('HKCU:\\' + $env:XOPC_REGRESSION_KEY) -Recurse -Force -ErrorAction SilentlyContinue`, { XOPC_REGRESSION_KEY: registryKey });
  }
  mkdirSync(join(root, 'reports'), { recursive: true });
  writeFileSync(join(root, 'reports/windows-installer-upgrade.json'), JSON.stringify(report, null, 2));
  rmSync(fixture, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}
