import { Menu, shell, type BrowserWindow, type MenuItemConstructorOptions } from 'electron';

export function buildAppMenu(mainWindow: BrowserWindow): Menu {
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
                label: 'Settings…',
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
      label: 'File',
      submenu: [
        {
          label: 'New Chat',
          accelerator: 'CmdOrCtrl+N',
          click: () => {
            mainWindow.webContents.send('menu:navigate', '/chat/new');
          },
        },
        { type: 'separator' },
        {
          label: 'Search',
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
                label: 'Settings…',
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
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        ...(isMac
          ? [
              { role: 'pasteAndMatchStyle' as const },
              { role: 'delete' as const },
              { role: 'selectAll' as const },
            ]
          : [
              { role: 'delete' as const },
              { type: 'separator' as const },
              { role: 'selectAll' as const },
            ]),
      ],
    },

    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },

    {
      label: 'Agent',
      submenu: [
        {
          label: 'Agents…',
          click: () => {
            mainWindow.webContents.send('menu:navigate', '/agents');
          },
        },
        { type: 'separator' },
        {
          label: 'Skills…',
          click: () => {
            mainWindow.webContents.send('menu:navigate', '/settings/skills');
          },
        },
        {
          label: 'Scheduled Tasks…',
          click: () => {
            mainWindow.webContents.send('menu:navigate', '/settings/cron');
          },
        },
        { type: 'separator' },
        {
          label: 'Providers…',
          click: () => {
            mainWindow.webContents.send('menu:navigate', '/settings/providers');
          },
        },
        {
          label: 'Models…',
          click: () => {
            mainWindow.webContents.send('menu:navigate', '/settings/models');
          },
        },
      ],
    },

    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        { role: 'zoom' },
        ...(isMac
          ? [
              { type: 'separator' as const },
              { role: 'front' as const },
              { type: 'separator' as const },
              { role: 'window' as const },
            ]
          : [{ role: 'close' as const }]),
      ],
    },

    {
      label: 'Help',
      submenu: [
        {
          label: 'Documentation',
          click: () => {
            void shell.openExternal('https://xopcai.github.io/xopc/');
          },
        },
        {
          label: 'Release Notes',
          click: () => {
            void shell.openExternal('https://github.com/xopcai/xopc/releases');
          },
        },
      ],
    },
  ];

  return Menu.buildFromTemplate(template);
}
