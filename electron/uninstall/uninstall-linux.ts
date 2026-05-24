import { app, shell } from 'electron';

import { UninstallError } from './errors.js';
import { clearUserDataWithoutRelaunch } from './clear-user-data.js';
import {
  detectLinuxPackageKind,
  resolveAppPath,
  resolveLinuxDebPackageName,
  type LinuxPackageKind,
} from './paths.js';
import { disableOpenAtLogin, prepareShutdown } from './prepare-shutdown.js';
import type { UninstallAppResult } from './types.js';

async function openLinuxInstallLocation(execPath: string, kind: LinuxPackageKind): Promise<void> {
  if (kind === 'appimage') {
    shell.showItemInFolder(execPath);
    return;
  }
  const installDir = resolveAppPath('linux', execPath);
  await shell.openPath(installDir);
}

export async function uninstallAppLinux(options: {
  removeUserData?: boolean;
}): Promise<UninstallAppResult> {
  if (!app.isPackaged) {
    return { ok: false, error: 'NOT_PACKAGED' };
  }
  if (process.platform !== 'linux') {
    return { ok: false, error: 'PLATFORM_UNSUPPORTED' };
  }

  try {
    prepareShutdown();
    disableOpenAtLogin();

    if (options.removeUserData) {
      await clearUserDataWithoutRelaunch();
    }

    const kind = detectLinuxPackageKind(process.execPath);
    await openLinuxInstallLocation(process.execPath, kind);

    app.quit();

    const debPackageName = await resolveLinuxDebPackageName(process.execPath);
    return {
      ok: true,
      mode: 'manual',
      linuxPackageKind: kind,
      debPackageName: debPackageName ?? undefined,
    };
  } catch (err) {
    if (err instanceof UninstallError) {
      return { ok: false, error: err.code };
    }
    throw err;
  }
}
