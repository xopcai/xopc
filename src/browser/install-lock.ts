/** Per-backend install mutex — Playwright and CloakBrowser may install in parallel. */
export type BrowserInstallKind = 'playwright' | 'cloakbrowser';

const locked: Record<BrowserInstallKind, boolean> = {
  playwright: false,
  cloakbrowser: false,
};

const activeController: Record<BrowserInstallKind, AbortController | null> = {
  playwright: null,
  cloakbrowser: null,
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
  for (const kind of ['playwright', 'cloakbrowser'] as const) {
    activeController[kind]?.abort();
    activeController[kind] = null;
    locked[kind] = false;
  }
}
