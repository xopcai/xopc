/** True when running inside Electron with preload bridge (not gateway-only web). */
export function isElectron(): boolean {
  return typeof window !== 'undefined' && Boolean(window.electronAPI);
}

/** Cron "keep screen on" can use main-process `powerSaveBlocker` (works on `file://`; Wake Lock does not). */
export function isElectronCronDisplayWakeAvailable(): boolean {
  return typeof window !== 'undefined' && typeof window.electronAPI?.cron?.setDisplaySleepPrevented === 'function';
}
