import { rm } from 'node:fs/promises';

import { app } from 'electron';

import { resolveConfigPath, resolveStateDir } from '../../src/config/paths.js';

import { resolveDataRemovalTargets } from './paths.js';

/** Delete Electron userData, cache, logs, and shared xopc state. Does not quit or relaunch. */
export async function removeUserDataDirs(): Promise<void> {
  const targets = resolveDataRemovalTargets([
    app.getPath('userData'),
    app.getPath('cache'),
    app.getPath('logs'),
    resolveStateDir(),
    resolveConfigPath(),
  ]);
  await Promise.all(
    targets.map((dir) =>
      rm(dir, { recursive: true, force: true }).catch(() => {
        /* best effort */
      }),
    ),
  );
}
