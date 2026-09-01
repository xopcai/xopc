import { spawn } from 'node:child_process';

import { app } from 'electron';

import { bypassNextAppQuitConfirmation } from '../quit-confirmation.js';

import { UninstallError } from './errors.js';
import { clearUserDataWithoutRelaunch } from './clear-user-data.js';
import { queryWindowsUninstallerFromRegistry } from './dir-size.js';
import { disableOpenAtLogin, prepareShutdown } from './prepare-shutdown.js';
import { resolveNsisUninstallerPath } from './paths.js';
import type { UninstallAppResult } from './types.js';

async function resolveUninstallerPath(): Promise<string | null> {
  const primary = resolveNsisUninstallerPath(process.execPath);
  if (primary) {
    return primary;
  }
  return queryWindowsUninstallerFromRegistry('xopc');
}

export async function uninstallAppWin32(options: {
  removeUserData?: boolean;
}): Promise<UninstallAppResult> {
  if (!app.isPackaged) {
    return { ok: false, error: 'NOT_PACKAGED' };
  }
  if (process.platform !== 'win32') {
    return { ok: false, error: 'PLATFORM_UNSUPPORTED' };
  }

  const uninstallerPath = await resolveUninstallerPath();
  if (!uninstallerPath) {
    return { ok: false, error: 'UNINSTALLER_NOT_FOUND' };
  }

  try {
    prepareShutdown();
    disableOpenAtLogin();

    if (options.removeUserData) {
      await clearUserDataWithoutRelaunch();
    }

    spawn(uninstallerPath, [], { detached: true, stdio: 'ignore' }).unref();
    bypassNextAppQuitConfirmation();
    app.quit();
    return { ok: true, mode: 'native-uninstaller' };
  } catch (err) {
    if (err instanceof UninstallError) {
      return { ok: false, error: err.code };
    }
    throw err;
  }
}
