import { app } from 'electron';

import { UninstallError } from './errors.js';
import { prepareShutdown } from './prepare-shutdown.js';
import { removeUserDataDirs } from './remove-user-data-dirs.js';
import type { ClearUserDataResult } from './types.js';

export async function clearUserData(): Promise<ClearUserDataResult> {
  if (!app.isPackaged) {
    return { ok: false, error: 'NOT_PACKAGED' };
  }
  try {
    prepareShutdown();
    await removeUserDataDirs();
    app.relaunch();
    app.quit();
    return { ok: true };
  } catch (err) {
    if (err instanceof UninstallError) {
      return { ok: false, error: err.code };
    }
    throw err;
  }
}

export async function clearUserDataWithoutRelaunch(): Promise<void> {
  await removeUserDataDirs();
}
