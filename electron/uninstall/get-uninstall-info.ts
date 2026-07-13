import { app } from 'electron';

import { resolveStateDir } from '../../src/config/paths.js';
import { hasPendingInstall } from '../auto-updater.js';

import { estimateDirSizeBytes, queryWindowsUninstallerFromRegistry } from './dir-size.js';
import {
  detectLinuxPackageKind,
  resolveAppPath,
  resolveLinuxDebPackageName,
  resolveNsisUninstallerPath,
} from './paths.js';
import type { LinuxPackageKind, UninstallInfo, UninstallMode } from './types.js';

function resolveUninstallMode(platform: NodeJS.Platform, packaged: boolean): UninstallMode {
  if (!packaged) {
    return 'unsupported';
  }
  if (platform === 'darwin' || platform === 'linux') {
    return 'manual';
  }
  if (platform === 'win32') {
    return 'native-uninstaller';
  }
  return 'unsupported';
}

async function resolveUninstallerPath(): Promise<string | null> {
  if (process.platform !== 'win32') {
    return null;
  }
  const primary = resolveNsisUninstallerPath(process.execPath);
  if (primary) {
    return primary;
  }
  return queryWindowsUninstallerFromRegistry('xopc');
}

export async function getUninstallInfo(): Promise<UninstallInfo> {
  const platform = process.platform as 'darwin' | 'win32' | 'linux';
  const packaged = app.isPackaged;
  const dataPath = resolveStateDir();
  const linuxPackageKind: LinuxPackageKind | undefined =
    platform === 'linux' ? detectLinuxPackageKind(process.execPath) : undefined;
  const linuxDebPackageName =
    platform === 'linux' ? await resolveLinuxDebPackageName(process.execPath) : undefined;

  return {
    packaged,
    platform,
    uninstallMode: resolveUninstallMode(platform, packaged),
    appPath: resolveAppPath(platform, process.execPath),
    dataPath,
    dataSizeBytes: await estimateDirSizeBytes(dataPath),
    uninstallerPath: await resolveUninstallerPath(),
    pendingUpdate: hasPendingInstall(),
    linuxPackageKind,
    linuxDebPackageName,
  };
}
