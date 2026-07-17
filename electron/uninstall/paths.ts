import { existsSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import pathPosix from 'node:path/posix';
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
    return pathPosix.join(pathPosix.dirname(execPath), '..', '..');
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
    return pathPosix.join(appPath, 'Contents', 'MacOS', pathPosix.basename(execPath));
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

export function resolveDataRemovalTargets(paths: string[]): string[] {
  const normalized = paths
    .map((target) => target.trim())
    .filter(Boolean)
    .map((target) => resolve(target));
  const unique = [...new Set(normalized)];

  return unique.filter((target) => {
    return !unique.some((candidate) => {
      if (candidate === target) {
        return false;
      }
      const rel = relative(candidate, target);
      return (
        rel !== '' &&
        !isAbsolute(rel) &&
        !rel.startsWith('..') &&
        !rel.startsWith('..\\') &&
        !rel.startsWith('../')
      );
    });
  });
}
