import { rm } from 'node:fs/promises';

import { app } from 'electron';

/** Delete Electron userData, cache, and logs directories. Does not quit or relaunch. */
export async function removeUserDataDirs(): Promise<void> {
  const targets = [app.getPath('userData'), app.getPath('cache'), app.getPath('logs')];
  await Promise.all(
    targets.map((dir) =>
      rm(dir, { recursive: true, force: true }).catch(() => {
        /* best effort */
      }),
    ),
  );
}
