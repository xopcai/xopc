/** True when running inside Electron with preload bridge (not gateway-only web). */
export function isElectron(): boolean {
  return typeof window !== 'undefined' && Boolean(window.electronAPI);
}

/** Native computer control is currently supported only by the macOS desktop shell. */
export function isComputerUseAvailable(): boolean {
  return typeof window !== 'undefined' && window.electronAPI?.platform === 'darwin';
}

/** Cron "keep screen on" can use main-process `powerSaveBlocker` (works on `file://`; Wake Lock does not). */
export function isElectronCronDisplayWakeAvailable(): boolean {
  return typeof window !== 'undefined' && typeof window.electronAPI?.cron?.setDisplaySleepPrevented === 'function';
}
