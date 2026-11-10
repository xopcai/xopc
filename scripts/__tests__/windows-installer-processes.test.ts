import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const powershell = process.env.XOPC_TEST_POWERSHELL ?? (process.platform === 'win32' ? 'powershell.exe' : 'pwsh');
const available = spawnSync(powershell, ['-NoProfile', '-Command', 'exit 0']).status === 0;
const script = fileURLToPath(new URL('../../electron/resources/installer-processes.ps1', import.meta.url));
const directory = join(tmpdir(), "xopc install user's 测试");
const executable = join(directory, 'xopc.exe');
const processRow = (id: number, path: string | null, parent = 0) => ({
  ProcessId: id, ParentProcessId: parent, ExecutablePath: path, Name: 'xopc.exe', CreationDate: 'original',
});

function run(mode: string, rows: ReturnType<typeof processRow>[], reusePid = 0, keepAlive = false, additional: string[] = [], locks: number[] = [], dropMainOnly = false) {
  const temporary = mkdtempSync(join(tmpdir(), 'xopc-installer-test-'));
  const report = join(temporary, 'report.json');
  const state = join(temporary, 'state.json');
  const harness = join(temporary, 'harness.ps1');
  writeFileSync(harness, `
$global:rows = @(ConvertFrom-Json $env:XOPC_INSTALLER_ROWS)
$global:stopped = @()
function Get-XopcLockingProcessIds { param($Files); return @(ConvertFrom-Json $env:XOPC_INSTALLER_LOCKS) }
function Get-CimInstance {
  param($ClassName, $Filter, $ErrorAction)
  if ($Filter) {
    $id = [int]($Filter -replace 'ProcessId = ', '')
    $result = $global:rows | Where-Object { $_.ProcessId -eq $id }
    if ($id -eq [int]$env:XOPC_INSTALLER_REUSE_PID -and $result) { $result.CreationDate = 'reused' }
    return $result
  }
  # Return snapshots, as the real CIM API does.
  return @(ConvertFrom-Json (ConvertTo-Json -InputObject @($global:rows) -Compress))
}
function Stop-Process {
  param($Id, [switch]$Force, $ErrorAction)
  $global:stopped += $Id
  ConvertTo-Json -InputObject @($global:stopped) | Set-Content $env:XOPC_INSTALLER_REPORT -Encoding UTF8
  $global:rows = @($global:rows | Where-Object { $_.ProcessId -ne $Id })
}
function Start-Process {
  param($FilePath, $ArgumentList, $WorkingDirectory)
  @{ executable=$FilePath; argument=$ArgumentList; directory=$WorkingDirectory } | ConvertTo-Json | Set-Content $env:XOPC_INSTALLER_REPORT -Encoding UTF8
  if ($env:XOPC_INSTALLER_KEEP_ALIVE -ne 'true') {
    if ($env:XOPC_INSTALLER_DROP_MAIN_ONLY -eq 'true') { $global:rows = @($global:rows | Where-Object Name -ne 'xopc.exe') }
    else { $global:rows = @() }
  }
}
$additional = @(ConvertFrom-Json $env:XOPC_INSTALLER_ADDITIONAL)
if ($env:XOPC_INSTALLER_MODE -eq 'sequence') {
  & $env:XOPC_INSTALLER_SCRIPT -AdditionalInstallDirectories $additional -StateFile $env:XOPC_INSTALLER_STATE -Mode check -InstallDirectory $env:XOPC_INSTALLER_DIRECTORY -InstallerProcessId 99999 -WaitSeconds 0
  $global:rows = @($global:rows | Where-Object Name -ne 'xopc.exe')
  $env:XOPC_INSTALLER_MODE = 'force'
}
& $env:XOPC_INSTALLER_SCRIPT -AdditionalInstallDirectories $additional -StateFile $env:XOPC_INSTALLER_STATE -Mode $env:XOPC_INSTALLER_MODE -InstallDirectory $env:XOPC_INSTALLER_DIRECTORY -InstallerProcessId 99999 -WaitSeconds 0
exit $LASTEXITCODE
`, 'utf8');
  try {
    const result = spawnSync(powershell, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', harness], {
      encoding: 'utf8', timeout: 15_000,
      env: {
        ...process.env, XOPC_INSTALLER_ROWS: JSON.stringify(rows), XOPC_INSTALLER_REPORT: report,
        XOPC_INSTALLER_SCRIPT: script, XOPC_INSTALLER_MODE: mode, XOPC_INSTALLER_DIRECTORY: directory,
        XOPC_INSTALLER_REUSE_PID: String(reusePid),
        XOPC_INSTALLER_KEEP_ALIVE: String(keepAlive),
        XOPC_INSTALLER_ADDITIONAL: JSON.stringify(additional), XOPC_INSTALLER_LOCKS: JSON.stringify(locks),
        XOPC_INSTALLER_STATE: state, XOPC_INSTALLER_DROP_MAIN_ONLY: String(dropMainOnly),
      },
    });
    let recorded: unknown;
    try { recorded = JSON.parse(readFileSync(report, 'utf8').replace(/^\uFEFF/, '')); } catch { /* No action was taken. */ }
    expect(result.error).toBeUndefined();
    expect(result.stderr.trim(), result.stdout).toBe('');
    if (process.platform === 'win32') console.log(result.stdout);
    return { ...result, recorded };
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}

describe.skipIf(!available)('Windows installer PowerShell process handling', () => {
  it('does not match sibling directories, other installations, or setup in the installation directory', () => {
    expect(run('check', [processRow(1, join(directory + '-backup', 'xopc.exe')),
      processRow(2, join(tmpdir(), 'other', 'xopc.exe')), processRow(3, join(directory, 'xopc-setup.exe'))]).status).toBe(0);
  });

  it('matches the exact installed executable without case sensitivity', () => {
    expect(run('check', [processRow(1, executable.toUpperCase())]).status).toBe(10);
  });

  it('excludes the installer PID even if it was renamed to xopc.exe', () => {
    expect(run('check', [processRow(99999, executable)]).status).toBe(0);
  });

  it('does not exclude an app that launched its updater', () => {
    expect(run('check', [processRow(99999, join(directory, 'setup.exe'), 1), processRow(1, executable)]).status).toBe(10);
  });

  it('does not block an unrelated inaccessible same-name process', () => {
    expect(run('check', [processRow(1, null)]).status).toBe(0);
  });

  it('detects inaccessible processes only when they lock this installation', () => {
    expect(run('check', [processRow(1, null)], 0, false, [], [1]).status).toBe(10);
  });

  it('requests the explicit app exit without killing any process', () => {
    const result = run('request', [processRow(1, executable)]);
    expect(result.status).toBe(0);
    expect(result.recorded).toEqual({ executable, argument: '--quit-for-install', directory });
  });

  it('only force-stops the installed app and its owned descendants within the directory boundary', () => {
    const result = run('force', [processRow(1, executable),
      processRow(2, join(directory, 'resources', 'helper.exe'), 1),
      processRow(3, join(directory + '-backup', 'helper.exe'), 1),
      processRow(4, join(directory, 'setup.exe'))]);
    expect(result.status).toBe(0);
    expect(result.recorded).toEqual([1, 2]);
  });

  it('leaves an old or cancelled app running until the user explicitly chooses force', () => {
    const result = run('request', [processRow(1, executable)], 0, true);
    expect(result.status).toBe(10);
    expect(result.recorded).toMatchObject({ argument: '--quit-for-install' });
  });

  it('checks the previous installation when the target directory changes', () => {
    const previous = join(tmpdir(), 'old-xopc');
    expect(run('check', [processRow(1, join(previous, 'xopc.exe'))], 0, false, [previous]).status).toBe(10);
    const forced = run('force', [processRow(1, join(previous, 'xopc.exe'))], 0, false, [previous]);
    expect(forced.status).toBe(0);
    expect(forced.recorded).toEqual([1]);
  });

  it('detects and reaps an orphaned packaged helper without a main process', () => {
    const helper = { ...processRow(2, join(directory, 'resources', 'bin', 'cua-driver.exe'), 1), Name: 'cua-driver.exe' };
    expect(run('check', [helper]).status).toBe(10);
    const forced = run('force', [helper]);
    expect(forced.status).toBe(0);
    expect(forced.recorded).toEqual([2]);
  });

  it('keeps tracking owned descendants after graceful main-process exit', () => {
    const helper = { ...processRow(2, join(directory, 'resources', 'custom-helper.exe'), 1), Name: 'custom-helper.exe' };
    const result = run('request', [processRow(1, executable), helper], 0, false, [], [], true);
    expect(result.status).toBe(10);
  });

  it('persists descendant identities across separate check and force invocations', () => {
    const helper = { ...processRow(2, join(directory, 'resources', 'custom-helper.exe'), 1), Name: 'custom-helper.exe' };
    const result = run('sequence', [processRow(1, executable), helper]);
    expect(result.status).toBe(0);
    expect(result.recorded).toEqual([2]);
  });

  it('preserves real CIM date identities through JSON snapshots', () => {
    const helper = { ...processRow(2, join(directory, 'resources', 'custom-helper.exe'), 1),
      Name: 'custom-helper.exe', CreationDate: '2026-11-10T01:00:00.123Z' };
    const result = run('sequence', [processRow(1, executable), helper]);
    expect(result.status).toBe(0);
    expect(result.recorded).toEqual([2]);
  });

  it('does not kill a PID whose creation time changed after inspection', () => {
    const result = run('force', [processRow(1, executable)], 1);
    expect(result.status).toBe(10);
    expect(result.recorded).toBeUndefined();
  });
});
