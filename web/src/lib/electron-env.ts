/** True when running inside Electron with preload bridge (not gateway-only web). */
export function isElectron(): boolean {
  return typeof window !== 'undefined' && Boolean(window.electronAPI);
}

/** Native control requires a supported desktop shell; readiness is checked locally. */
export function isComputerUseAvailable(): boolean {
  return typeof window !== 'undefined' && ['darwin', 'win32'].includes(window.electronAPI?.platform ?? '');
}

/** Cron "keep screen on" can use main-process `powerSaveBlocker` (works on `file://`; Wake Lock does not). */
export function isElectronCronDisplayWakeAvailable(): boolean {
  return typeof window !== 'undefined' && typeof window.electronAPI?.cron?.setDisplaySleepPrevented === 'function';
}
