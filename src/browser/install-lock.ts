export type BrowserInstallKind = 'playwright';

const locked: Record<BrowserInstallKind, boolean> = {
  playwright: false,
};

const activeController: Record<BrowserInstallKind, AbortController | null> = {
  playwright: null,
};

export type BrowserInstallLock = {
  readonly signal: AbortSignal;
  release: () => void;
};

export function acquireBrowserInstallLock(kind: BrowserInstallKind): BrowserInstallLock | null {
  if (locked[kind]) return null;
  locked[kind] = true;
  const controller = new AbortController();
  activeController[kind] = controller;
  let released = false;

  return {
    signal: controller.signal,
    release: () => {
      if (released) return;
      released = true;
      locked[kind] = false;
      if (activeController[kind] === controller) {
        activeController[kind] = null;
      }
    },
  };
}

/** User-initiated cancel — aborts the in-flight install for this kind. */
export function cancelBrowserInstall(kind: BrowserInstallKind): boolean {
  const controller = activeController[kind];
  if (!controller) return false;
  controller.abort();
  return true;
}

export function isBrowserInstallRunning(kind: BrowserInstallKind): boolean {
  return locked[kind];
}

/** Test helper — reset lock state between unit tests. */
export function resetBrowserInstallLockForTests(): void {
  for (const kind of ['playwright'] as const) {
    activeController[kind]?.abort();
    activeController[kind] = null;
    locked[kind] = false;
  }
}
