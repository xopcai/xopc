import { existsSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import pathWin32 from 'node:path/win32';

/** Matches electron-builder `productName: xopc`. */
export const NSIS_UNINSTALL_EXE = 'Uninstall xopc.exe';

export type LinuxPackageKind = 'appimage' | 'deb' | 'unknown';

export function detectLinuxPackageKind(execPath: string): LinuxPackageKind {
  if (/\.appimage$/i.test(execPath)) {
    return 'appimage';
  }
  if (execPath.startsWith('/opt/') || execPath.startsWith('/usr/')) {
    return 'deb';
  }
  return 'unknown';
}

const DEFAULT_DEB_PACKAGE = 'xopc';

/** Best-effort package name for `dpkg -r` hints when installed from a .deb. */
export async function resolveLinuxDebPackageName(execPath: string): Promise<string | undefined> {
  if (detectLinuxPackageKind(execPath) !== 'deb') {
    return undefined;
  }
  try {
    const { execFile } = await import('node:child_process');
    const { promisify } = await import('node:util');
    const execFileAsync = promisify(execFile);
    const { stdout } = await execFileAsync('dpkg', ['-S', execPath], { timeout: 5_000 });
    const pkg = stdout.split(':')[0]?.trim();
    return pkg || DEFAULT_DEB_PACKAGE;
  } catch {
    return DEFAULT_DEB_PACKAGE;
  }
}

export function resolveAppPath(platform: NodeJS.Platform, execPath: string): string {
  if (platform === 'darwin') {
    return join(dirname(execPath), '..', '..');
  }
  if (platform === 'win32') {
    return pathWin32.dirname(execPath);
  }
  return dirname(execPath);
}

/** Target path for `shell.showItemInFolder` (highlights the app bundle on macOS). */
export function resolveShowInFolderTarget(
  platform: NodeJS.Platform,
  execPath: string,
  appPath: string,
): string {
  if (platform === 'darwin') {
    return join(appPath, 'Contents', 'MacOS', basename(execPath));
  }
  return execPath;
}

export function resolveNsisUninstallerPath(
  execPath: string,
  exists: (path: string) => boolean = existsSync,
  platform: NodeJS.Platform = process.platform,
): string | null {
  const installDir = platform === 'win32' ? pathWin32.dirname(execPath) : dirname(execPath);
  const primary =
    platform === 'win32'
      ? pathWin32.join(installDir, NSIS_UNINSTALL_EXE)
      : join(installDir, NSIS_UNINSTALL_EXE);
  if (exists(primary)) {
    return primary;
  }
  return null;
}

export function resolveCliDataPath(homeDir: string = homedir()): string {
  return join(homeDir, '.xopc');
}

export function detectSeparateCliData(
  userDataPath: string,
  cliDataPath: string,
  exists: (path: string) => boolean = existsSync,
  realpath: (path: string) => string = realpathSync,
): boolean {
  if (!exists(cliDataPath)) {
    return false;
  }
  try {
    return realpath(cliDataPath) !== realpath(userDataPath);
  } catch {
    return cliDataPath !== userDataPath;
  }
}
