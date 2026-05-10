import { isElectron } from '@/lib/electron-env';

/**
 * macOS `hiddenInset`: first in-flow chrome control after the traffic-light cluster.
 * Tune with `MACOS_WINDOW_BUTTON_*` in `electron/main.ts` (`setWindowButtonPosition`).
 */
const DARWIN_TRAFFIC_LIGHT_LEFT_PAD = 'pl-[88px]';

const WIN32_CAPTION_RIGHT_RESERVE_MD = 'md:pr-[140px]';

export function isElectronDarwin(): boolean {
  return isElectron() && window.electronAPI?.platform === 'darwin';
}

export function isElectronWin32(): boolean {
  return isElectron() && window.electronAPI?.platform === 'win32';
}

export function electronDarwinTitlebarLeftPad(): string {
  return isElectronDarwin() ? DARWIN_TRAFFIC_LIGHT_LEFT_PAD : '';
}

/**
 * Main header: reserve space for the fixed title-bar cluster (sidebar + search + new)
 * when the left rail is fully hidden on macOS Electron (`md+`).
 */
export function electronDarwinCollapsedClusterMainPadMd(collapsed: boolean): string {
  return isElectronDarwin() && collapsed ? 'md:pl-[200px]' : '';
}

export function electronWindowsCaptionRightReserveMd(): string {
  return isElectronWin32() ? WIN32_CAPTION_RIGHT_RESERVE_MD : '';
}
