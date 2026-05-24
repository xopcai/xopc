import { app } from 'electron';

import { uninstallAppDarwin } from './uninstall-darwin.js';
import { uninstallAppLinux } from './uninstall-linux.js';
import { uninstallAppWin32 } from './uninstall-win32.js';
import type { UninstallAppResult } from './types.js';

export async function uninstallApp(options: {
  removeUserData?: boolean;
}): Promise<UninstallAppResult> {
  if (!app.isPackaged) {
    return { ok: false, error: 'NOT_PACKAGED' };
  }
  if (process.platform === 'darwin') {
    return uninstallAppDarwin(options);
  }
  if (process.platform === 'win32') {
    return uninstallAppWin32(options);
  }
  if (process.platform === 'linux') {
    return uninstallAppLinux(options);
  }
  return { ok: false, error: 'PLATFORM_UNSUPPORTED' };
}
