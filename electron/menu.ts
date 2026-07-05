import { Menu, app, shell, type BrowserWindow, type MenuItemConstructorOptions } from 'electron';

import { checkForUpdates } from './auto-updater.js';
import { toggleMainWindowDevTools } from './devtools.js';
import type { ElectronMenuMessages } from './i18n.js';

const showDeveloperMenuItems =
  !app.isPackaged || process.env['XOPC_ELECTRON_SHOW_DEV_MENU'] === '1';

export function buildAppMenu(mainWindow: BrowserWindow, t: ElectronMenuMessages): Menu {
  const isMac = process.platform === 'darwin';

  const template: MenuItemConstructorOptions[] = [
    ...(isMac
      ? [
          {
            label: 'xopc',
            submenu: [
              { role: 'about' as const },
              { type: 'separator' as const },
              {
                label: t.app.settings,
                accelerator: 'CmdOrCtrl+,',
                click: () => {
                  mainWindow.webContents.send('menu:navigate', '/settings/appearance');
                },
              },
              { type: 'separator' as const },
              { role: 'services' as const },
              { type: 'separator' as const },
              { role: 'hide' as const },
              { role: 'hideOthers' as const },
              { role: 'unhide' as const },
              { type: 'separator' as const },
              { role: 'quit' as const },
            ],
          },
        ]
      : []),

    {
      label: t.file.label,
      submenu: [
        {
          label: t.file.newChat,
          accelerator: 'CmdOrCtrl+N',
          click: () => {
            mainWindow.webContents.send('menu:navigate', '/chat/new');
          },
        },
        { type: 'separator' },
        {
          label: t.file.search,
          accelerator: 'CmdOrCtrl+K',
          click: () => {
            mainWindow.webContents.send('menu:toggle-palette');
          },
        },
        { type: 'separator' },
        ...(isMac
          ? []
          : [
              {
                label: t.file.settings,
                accelerator: 'CmdOrCtrl+,',
                click: () => {
                  mainWindow.webContents.send('menu:navigate', '/settings/appearance');
                },
              },
              { type: 'separator' as const },
            ]),
        isMac ? { role: 'close' as const } : { role: 'quit' as const },
      ],
    },

    {
      label: t.edit.label,
      submenu: [
        { role: 'undo', label: t.edit.undo },
        { role: 'redo', label: t.edit.redo },
        { type: 'separator' },
        { role: 'cut', label: t.edit.cut },
        { role: 'copy', label: t.edit.copy },
        { role: 'paste', label: t.edit.paste },
        ...(isMac
          ? [
              { role: 'pasteAndMatchStyle' as const, label: t.edit.pasteAndMatchStyle },
              { role: 'delete' as const, label: t.edit.delete },
              { role: 'selectAll' as const, label: t.edit.selectAll },
            ]
          : [
              { role: 'delete' as const, label: t.edit.delete },
              { type: 'separator' as const },
              { role: 'selectAll' as const, label: t.edit.selectAll },
            ]),
      ],
    },

    {
      label: t.view.label,
      submenu: [
        { role: 'reload', label: t.view.reload },
        ...(showDeveloperMenuItems
          ? [
              { role: 'forceReload' as const, label: t.view.forceReload },
              { role: 'toggleDevTools' as const, label: t.view.toggleDevTools },
              { type: 'separator' as const },
            ]
          : []),
        { role: 'resetZoom', label: t.view.resetZoom },
        { role: 'zoomIn', label: t.view.zoomIn },
        { role: 'zoomOut', label: t.view.zoomOut },
        { type: 'separator' },
        { role: 'togglefullscreen', label: t.view.toggleFullscreen },
      ],
    },

    {
      label: t.agent.label,
      submenu: [
        {
          label: t.agent.agents,
          click: () => {
            mainWindow.webContents.send('menu:navigate', '/agents');
          },
        },
        { type: 'separator' },
        {
          label: t.agent.skills,
          click: () => {
            mainWindow.webContents.send('menu:navigate', '/skills');
          },
        },
        {
          label: t.agent.automations,
          click: () => {
            mainWindow.webContents.send('menu:navigate', '/automations');
          },
        },
        { type: 'separator' },
        {
          label: t.agent.providers,
          click: () => {
            mainWindow.webContents.send('menu:navigate', '/settings/credentials?tab=providers');
          },
        },
        {
          label: t.agent.models,
          click: () => {
            mainWindow.webContents.send('menu:navigate', '/settings/credentials?tab=catalog');
          },
        },
      ],
    },

    {
      label: t.window.label,
      submenu: [
        { role: 'minimize', label: t.window.minimize },
        { role: 'zoom', label: t.window.zoom },
        ...(isMac
          ? [
              { type: 'separator' as const },
              { role: 'front' as const, label: t.window.front },
              { type: 'separator' as const },
              { role: 'window' as const, label: t.window.window },
            ]
          : [{ role: 'close' as const, label: t.window.close }]),
      ],
    },

    {
      label: t.help.label,
      submenu: [
        {
          label: t.help.documentation,
          click: () => {
            void shell.openExternal('https://xopcai.github.io/xopc/');
          },
        },
        {
          label: t.help.releaseNotes,
          click: () => {
            void shell.openExternal('https://github.com/xopcai/xopc/releases');
          },
        },
        { type: 'separator' },
        {
          label: t.help.reportIssue,
          click: () => {
            void shell.openExternal('https://github.com/xopcai/xopc/issues/new/choose');
          },
        },
        {
          label: t.help.checkForUpdates,
          click: () => {
            checkForUpdates(true);
            mainWindow.webContents.send('menu:navigate', '/settings/app-management');
          },
        },
        {
          label: t.help.openLogs,
          click: () => {
            mainWindow.webContents.send('menu:navigate', '/settings/logs');
          },
        },
        ...(showDeveloperMenuItems
          ? [
              { type: 'separator' as const },
              {
                label: t.help.developerTools,
                accelerator: process.platform === 'darwin' ? 'Cmd+Shift+Alt+I' : 'Ctrl+Shift+Alt+I',
                click: () => {
                  toggleMainWindowDevTools(mainWindow);
                },
              },
            ]
          : []),
      ],
    },
  ];

  return Menu.buildFromTemplate(template);
}
