import { join } from 'node:path';

import { Menu, Tray, app, nativeImage } from 'electron';

import type { ElectronMenuMessages } from './i18n.js';

const showDeveloperTrayItems =
  !app.isPackaged || process.env['XOPC_ELECTRON_SHOW_DEV_MENU'] === '1';

let tray: Tray | null = null;
let currentActions: TrayActions | null = null;
let currentMessages: ElectronMenuMessages | null = null;
let currentTunnelStatus: 'connected' | 'disconnected' | 'connecting' | 'error' = 'disconnected';

export type TrayActions = {
  /** Focus existing window or create one — must not close over a BrowserWindow (stale after close). */
  showWindow: () => void;
  /** Open app and navigate once content can receive IPC. */
  navigate: (hashPath: string) => void;
  /** Main-process DevTools (works when the page is blank). */
  openDevTools: () => void;
  quit: () => void;
};

function tunnelStatusLabel(
  t: ElectronMenuMessages,
  status: 'connected' | 'disconnected' | 'connecting' | 'error',
): string {
  const labelMap = {
    connected: t.tray.remoteAccessConnected,
    disconnected: t.tray.remoteAccessOff,
    connecting: t.tray.remoteAccessReconnecting,
    error: t.tray.remoteAccessError,
  };
  return labelMap[status] ?? t.tray.remoteAccessOff;
}

function buildContextMenu(actions: TrayActions, t: ElectronMenuMessages): Menu {
  return Menu.buildFromTemplate([
    {
      label: t.tray.newChat,
      click: () => {
        actions.navigate('/chat/new');
      },
    },
    { type: 'separator' },
    {
      label: t.tray.showWindow,
      click: () => {
        actions.showWindow();
      },
    },
    { type: 'separator' },
    {
      label: tunnelStatusLabel(t, currentTunnelStatus),
      enabled: false,
    },
    {
      label: t.tray.remoteAccess,
      click: () => {
        actions.navigate('/settings/remote-access');
      },
    },
    { type: 'separator' },
    {
      label: t.tray.settings,
      click: () => {
        actions.navigate('/settings/appearance');
      },
    },
    ...(showDeveloperTrayItems
      ? [
          { type: 'separator' as const },
          {
            label: t.tray.developerTools,
            click: () => {
              actions.openDevTools();
            },
          },
        ]
      : []),
    { type: 'separator' },
    {
      label: t.tray.quit,
      click: () => {
        actions.quit();
      },
    },
  ]);
}

/** Update tray menu tunnel status line (Electron has no per-item label API). */
export function updateTrayTunnelStatus(
  status: 'connected' | 'disconnected' | 'connecting' | 'error',
): void {
  if (status === currentTunnelStatus) return;
  currentTunnelStatus = status;
  refreshTrayMenu();
}

export function updateTrayLanguage(messages: ElectronMenuMessages): void {
  currentMessages = messages;
  refreshTrayMenu();
}

function refreshTrayMenu(): void {
  if (!tray || !currentActions || !currentMessages) return;
  tray.setContextMenu(buildContextMenu(currentActions, currentMessages));
}

export function createTray(iconDir: string, actions: TrayActions, messages: ElectronMenuMessages): Tray {
  currentActions = actions;
  currentMessages = messages;
  if (tray) {
    tray.destroy();
    tray = null;
  }

  const iconFile = process.platform === 'win32' ? 'tray-icon-win.png' : 'tray-icon.png';
  const iconPath = join(iconDir, iconFile);
  let icon = nativeImage.createFromPath(iconPath);
  if (icon.isEmpty()) {
    icon = nativeImage.createFromPath(join(iconDir, 'icon.png'));
  }
  if (process.platform === 'darwin') {
    // Keep status bar icon aligned with macOS menubar glyph size.
    icon = icon.resize({ height: 18 });
  } else if (process.platform === 'win32') {
    // Windows notification area icons render best from a real small bitmap.
    icon = icon.resize({ width: 16, height: 16 });
  }

  tray = new Tray(icon);
  tray.setToolTip('xopc');

  tray.setContextMenu(buildContextMenu(actions, messages));

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
  currentActions = null;
  currentMessages = null;
  currentTunnelStatus = 'disconnected';
}
