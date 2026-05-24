import { app, shell } from 'electron';

import { UninstallError } from './errors.js';
import { clearUserDataWithoutRelaunch } from './clear-user-data.js';
import { disableOpenAtLogin, prepareShutdown } from './prepare-shutdown.js';
import { resolveAppPath, resolveShowInFolderTarget } from './paths.js';
import type { UninstallAppResult } from './types.js';

export async function uninstallAppDarwin(options: {
  removeUserData?: boolean;
}): Promise<UninstallAppResult> {
  if (!app.isPackaged) {
    return { ok: false, error: 'NOT_PACKAGED' };
  }
  if (process.platform !== 'darwin') {
    return { ok: false, error: 'PLATFORM_UNSUPPORTED' };
  }

  try {
    prepareShutdown();
    disableOpenAtLogin();

    if (options.removeUserData) {
      await clearUserDataWithoutRelaunch();
    }

    const appPath = resolveAppPath('darwin', process.execPath);
    const target = resolveShowInFolderTarget('darwin', process.execPath, appPath);
    shell.showItemInFolder(target);
    app.quit();

    return { ok: true, mode: 'manual' };
  } catch (err) {
    if (err instanceof UninstallError) {
      return { ok: false, error: err.code };
    }
    throw err;
  }
}
