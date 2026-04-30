import { join } from 'node:path';

import { Menu, Tray, nativeImage, type BrowserWindow } from 'electron';

let tray: Tray | null = null;

export function createTray(mainWindow: BrowserWindow, iconDir: string): Tray {
  /** Colored PNG from logo.svg — do not use *Template.png naming (macOS would treat full-color art as a monochrome template). */
  const iconPath = join(iconDir, 'tray-icon.png');
  const icon = nativeImage.createFromPath(iconPath);

  tray = new Tray(icon);
  tray.setToolTip('xopc');

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'New Chat',
      click: () => {
        mainWindow.show();
        mainWindow.webContents.send('menu:navigate', '/chat/new');
      },
    },
    { type: 'separator' },
    {
      label: 'Show Window',
      click: () => {
        mainWindow.show();
        mainWindow.focus();
      },
    },
    { type: 'separator' },
    {
      label: 'Settings',
      click: () => {
        mainWindow.show();
        mainWindow.webContents.send('menu:navigate', '/settings/appearance');
      },
    },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => {
        mainWindow.destroy();
      },
    },
  ]);

  tray.setContextMenu(contextMenu);

  tray.on('double-click', () => {
    mainWindow.show();
    mainWindow.focus();
  });

  return tray;
}

export function destroyTray(): void {
  if (tray) {
    tray.destroy();
    tray = null;
  }
}
