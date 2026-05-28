/** In-process mutex so only one browser binary install runs at a time in the gateway. */
let installLocked = false;

export function acquireBrowserInstallLock(): { release: () => void } | null {
  if (installLocked) return null;
  installLocked = true;
  return {
    release: () => {
      installLocked = false;
    },
  };
}
