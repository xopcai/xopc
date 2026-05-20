import { join } from 'node:path';

import { Menu, Tray, nativeImage } from 'electron';

let tray: Tray | null = null;
let currentActions: TrayActions | null = null;
let currentTunnelLabel = 'Remote Access: Off';

export type TrayActions = {
  /** Focus existing window or create one — must not close over a BrowserWindow (stale after close). */
  showWindow: () => void;
  /** Open app and navigate once content can receive IPC. */
  navigate: (hashPath: string) => void;
  quit: () => void;
};

function buildContextMenu(actions: TrayActions): Menu {
  return Menu.buildFromTemplate([
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
      label: currentTunnelLabel,
      enabled: false,
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
}

/** Update tray menu tunnel status line (Electron has no per-item label API). */
export function updateTrayTunnelStatus(status: 'connected' | 'disconnected' | 'connecting'): void {
  if (!tray || !currentActions) return;
  const labelMap: Record<string, string> = {
    connected: 'Remote Access: Connected ✓',
    disconnected: 'Remote Access: Off',
    connecting: 'Remote Access: Connecting…',
  };
  const newLabel = labelMap[status] ?? labelMap.disconnected;
  if (newLabel === currentTunnelLabel) return;
  currentTunnelLabel = newLabel;
  tray.setContextMenu(buildContextMenu(currentActions));
}

export function createTray(iconDir: string, actions: TrayActions): Tray {
  currentActions = actions;
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

  tray.setContextMenu(buildContextMenu(actions));

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
  currentTunnelLabel = 'Remote Access: Off';
}
