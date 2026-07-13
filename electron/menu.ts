import { Menu, app, shell, type BrowserWindow, type MenuItemConstructorOptions } from 'electron';

import { checkForUpdates } from './auto-updater.js';
import { toggleMainWindowDevTools } from './devtools.js';
import type { ElectronMenuMessages } from './i18n.js';

export type ElectronAppMenuItemModel =
  | { type: 'separator' }
  | {
      type: 'item';
      id: string;
      label: string;
      accelerator?: string;
      role?: MenuItemConstructorOptions['role'];
    };

export type ElectronAppMenuGroupModel = {
  id: string;
  label: string;
  items: ElectronAppMenuItemModel[];
};

const showDeveloperMenuItems =
  !app.isPackaged || process.env['XOPC_ELECTRON_SHOW_DEV_MENU'] === '1';

function separator(): ElectronAppMenuItemModel {
  return { type: 'separator' };
}

function item(
  id: string,
  label: string,
  options?: Pick<Extract<ElectronAppMenuItemModel, { type: 'item' }>, 'accelerator' | 'role'>,
): ElectronAppMenuItemModel {
  return { type: 'item', id, label, ...options };
}

export function buildAppMenuModel(
  t: ElectronMenuMessages,
  platform: NodeJS.Platform = process.platform,
): ElectronAppMenuGroupModel[] {
  const isMac = platform === 'darwin';

  return [
    ...(isMac
      ? [
          {
            id: 'app',
            label: 'xopc',
            items: [
              item('role.about', 'About xopc', { role: 'about' }),
              separator(),
              item('app.settings', t.app.settings, { accelerator: 'CmdOrCtrl+,' }),
              separator(),
              item('role.services', 'Services', { role: 'services' }),
              separator(),
              item('role.hide', 'Hide xopc', { role: 'hide' }),
              item('role.hideOthers', 'Hide Others', { role: 'hideOthers' }),
              item('role.unhide', 'Show All', { role: 'unhide' }),
              separator(),
              item('app.quit', 'Quit xopc', { role: 'quit' }),
            ],
          },
        ]
      : []),

    {
      id: 'file',
      label: t.file.label,
      items: [
        item('file.newChat', t.file.newChat, { accelerator: 'CmdOrCtrl+N' }),
        item('file.quickCapture', t.file.quickCapture),
        separator(),
        item('file.search', t.file.search, { accelerator: 'CmdOrCtrl+K' }),
        separator(),
        ...(isMac
          ? []
          : [
              item('app.settings', t.file.settings, { accelerator: 'CmdOrCtrl+,' }),
              separator(),
            ]),
        isMac
          ? item('window.close', t.window.close, { role: 'close' })
          : item('app.quit', t.tray.quit, { role: 'quit' }),
      ],
    },

    {
      id: 'edit',
      label: t.edit.label,
      items: [
        item('edit.undo', t.edit.undo, { role: 'undo' }),
        item('edit.redo', t.edit.redo, { role: 'redo' }),
        separator(),
        item('edit.cut', t.edit.cut, { role: 'cut' }),
        item('edit.copy', t.edit.copy, { role: 'copy' }),
        item('edit.paste', t.edit.paste, { role: 'paste' }),
        ...(isMac
          ? [
              item('edit.pasteAndMatchStyle', t.edit.pasteAndMatchStyle, {
                role: 'pasteAndMatchStyle',
              }),
              item('edit.delete', t.edit.delete, { role: 'delete' }),
              item('edit.selectAll', t.edit.selectAll, { role: 'selectAll' }),
            ]
          : [
              item('edit.delete', t.edit.delete, { role: 'delete' }),
              separator(),
              item('edit.selectAll', t.edit.selectAll, { role: 'selectAll' }),
            ]),
      ],
    },

    {
      id: 'view',
      label: t.view.label,
      items: [
        item('view.toggleSidebar', t.view.toggleSidebar),
        separator(),
        item('view.reload', t.view.reload, { role: 'reload' }),
        ...(showDeveloperMenuItems
          ? [
              item('view.forceReload', t.view.forceReload, { role: 'forceReload' }),
              item('view.toggleDevTools', t.view.toggleDevTools, { role: 'toggleDevTools' }),
              separator(),
            ]
          : []),
        item('view.resetZoom', t.view.resetZoom, { role: 'resetZoom' }),
        item('view.zoomIn', t.view.zoomIn, { role: 'zoomIn' }),
        item('view.zoomOut', t.view.zoomOut, { role: 'zoomOut' }),
        separator(),
        item('view.toggleFullscreen', t.view.toggleFullscreen, { role: 'togglefullscreen' }),
      ],
    },

    {
      id: 'agent',
      label: t.agent.label,
      items: [
        item('agent.agents', t.agent.agents),
        separator(),
        item('agent.skills', t.agent.skills),
        item('agent.automations', t.agent.automations),
        separator(),
        item('agent.providers', t.agent.providers),
        item('agent.models', t.agent.models),
      ],
    },

    {
      id: 'help',
      label: t.help.label,
      items: [
        item('help.documentation', t.help.documentation),
        item('help.releaseNotes', t.help.releaseNotes),
        separator(),
        item('help.reportIssue', t.help.reportIssue),
        item('help.checkForUpdates', t.help.checkForUpdates),
        item('help.openLogs', t.help.openLogs),
        ...(showDeveloperMenuItems
          ? [
              separator(),
              item('help.developerTools', t.help.developerTools, {
                accelerator: platform === 'darwin' ? 'Cmd+Shift+Alt+I' : 'Ctrl+Shift+Alt+I',
              }),
            ]
          : []),
      ],
    },
  ];
}

export function invokeAppMenuAction(
  mainWindow: BrowserWindow,
  id: string,
): { ok: true } | { ok: false; error: 'UNKNOWN_MENU_ACTION' } {
  const wc = mainWindow.webContents;

  switch (id) {
    case 'app.settings':
      wc.send('menu:navigate', '/settings/appearance');
      break;
    case 'app.quit':
      app.quit();
      break;
    case 'file.newChat':
      wc.send('menu:navigate', '/chat/new');
      break;
    case 'file.quickCapture':
      wc.send('menu:quick-capture');
      break;
    case 'file.search':
      wc.send('menu:toggle-palette');
      break;
    case 'edit.undo':
      wc.undo();
      break;
    case 'edit.redo':
      wc.redo();
      break;
    case 'edit.cut':
      wc.cut();
      break;
    case 'edit.copy':
      wc.copy();
      break;
    case 'edit.paste':
      wc.paste();
      break;
    case 'edit.pasteAndMatchStyle':
      wc.pasteAndMatchStyle();
      break;
    case 'edit.delete':
      wc.delete();
      break;
    case 'edit.selectAll':
      wc.selectAll();
      break;
    case 'view.reload':
      wc.reload();
      break;
    case 'view.forceReload':
      wc.reloadIgnoringCache();
      break;
    case 'view.toggleDevTools':
    case 'help.developerTools':
      toggleMainWindowDevTools(mainWindow);
      break;
    case 'view.resetZoom':
      wc.setZoomLevel(0);
      break;
    case 'view.zoomIn':
      wc.setZoomLevel(wc.getZoomLevel() + 0.5);
      break;
    case 'view.zoomOut':
      wc.setZoomLevel(wc.getZoomLevel() - 0.5);
      break;
    case 'view.toggleFullscreen':
      mainWindow.setFullScreen(!mainWindow.isFullScreen());
      break;
    case 'view.toggleSidebar':
      wc.send('menu:toggle-sidebar');
      break;
    case 'navigate.back':
      wc.send('menu:history-navigate', -1);
      break;
    case 'navigate.forward':
      wc.send('menu:history-navigate', 1);
      break;
    case 'agent.agents':
      wc.send('menu:navigate', '/agents');
      break;
    case 'agent.skills':
      wc.send('menu:navigate', '/skills');
      break;
    case 'agent.automations':
      wc.send('menu:navigate', '/automations');
      break;
    case 'agent.providers':
      wc.send('menu:navigate', '/settings/credentials?tab=providers');
      break;
    case 'agent.models':
      wc.send('menu:navigate', '/settings/credentials?tab=catalog');
      break;
    case 'window.minimize':
      mainWindow.minimize();
      break;
    case 'window.zoom':
      if (mainWindow.isMaximized()) {
        mainWindow.unmaximize();
      } else {
        mainWindow.maximize();
      }
      break;
    case 'window.close':
      mainWindow.close();
      break;
    case 'help.documentation':
      void shell.openExternal('https://xopcai.github.io/xopc/');
      break;
    case 'help.releaseNotes':
      void shell.openExternal('https://github.com/xopcai/xopc/releases');
      break;
    case 'help.reportIssue':
      void shell.openExternal('https://github.com/xopcai/xopc/issues/new/choose');
      break;
    case 'help.checkForUpdates':
      checkForUpdates(true);
      wc.send('menu:navigate', '/settings/app-management');
      break;
    case 'help.openLogs':
      wc.send('menu:navigate', '/settings/logs');
      break;
    default:
      return { ok: false, error: 'UNKNOWN_MENU_ACTION' };
  }

  return { ok: true };
}

export function buildAppMenu(mainWindow: BrowserWindow, t: ElectronMenuMessages): Menu {
  const template: MenuItemConstructorOptions[] = buildAppMenuModel(t).map((group) => ({
    label: group.label,
    submenu: group.items.map((menuItem): MenuItemConstructorOptions => {
      if (menuItem.type === 'separator') return { type: 'separator' };
      if (menuItem.role) {
        const useNativeRoleLabel =
          menuItem.id.startsWith('role.') || (menuItem.id === 'app.quit' && menuItem.role === 'quit');
        return {
          role: menuItem.role,
          ...(useNativeRoleLabel ? {} : { label: menuItem.label }),
          accelerator: menuItem.accelerator,
        };
      }
      return {
        label: menuItem.label,
        accelerator: menuItem.accelerator,
        click: () => {
          invokeAppMenuAction(mainWindow, menuItem.id);
        },
      };
    }),
  }));

  return Menu.buildFromTemplate(template);
}
