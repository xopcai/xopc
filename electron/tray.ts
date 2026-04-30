import { join } from 'node:path';

import { Menu, Tray, nativeImage } from 'electron';

let tray: Tray | null = null;

export type TrayActions = {
  /** Focus existing window or create one — must not close over a BrowserWindow (stale after close). */
  showWindow: () => void;
  /** Open app and navigate once content can receive IPC. */
  navigate: (hashPath: string) => void;
  quit: () => void;
};

export function createTray(iconDir: string, actions: TrayActions): Tray {
  if (tray) {
    tray.destroy();
    tray = null;
  }

  /** Colored PNG from logo.svg — do not use *Template.png naming (macOS would treat full-color art as a monochrome template). */
  const iconPath = join(iconDir, 'tray-icon.png');
  let icon = nativeImage.createFromPath(iconPath);
  if (process.platform === 'darwin') {
    // Keep status bar icon aligned with macOS menubar glyph size.
    icon = icon.resize({ height: 18 });
  }

  tray = new Tray(icon);
  tray.setToolTip('xopc');

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'New Chat',
      click: () => {
        actions.navigate('/chat/new');
      },
    },
    { type: 'separator' },
    {
      label: 'Show Window',
      click: () => {
        actions.showWindow();
      },
    },
    { type: 'separator' },
    {
      label: 'Settings',
      click: () => {
        actions.navigate('/settings/appearance');
      },
    },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => {
        actions.quit();
      },
    },
  ]);

  tray.setContextMenu(contextMenu);

  tray.on('double-click', () => {
    actions.showWindow();
  });

  return tray;
}

export function destroyTray(): void {
  if (tray) {
    tray.destroy();
    tray = null;
  }
}
