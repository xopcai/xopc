import { isElectron } from '@/lib/electron-env';

/**
 * macOS `hiddenInset`: first in-flow chrome control after the traffic-light cluster.
 * Tune with `MACOS_WINDOW_BUTTON_*` in `electron/main.ts` (`setWindowButtonPosition`).
 */
const DARWIN_TRAFFIC_LIGHT_LEFT_PAD = 'pl-[88px]';

export function isElectronDarwin(): boolean {
  return isElectron() && window.electronAPI?.platform === 'darwin';
}

export function isElectronWin32(): boolean {
  return isElectron() && window.electronAPI?.platform === 'win32';
}

export function electronDarwinTitlebarLeftPad(): string {
  return isElectronDarwin() ? DARWIN_TRAFFIC_LIGHT_LEFT_PAD : '';
}
