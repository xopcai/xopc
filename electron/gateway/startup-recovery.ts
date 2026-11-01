import { app, BaseWindow, dialog } from 'electron';

/** Recovery must not depend on the remote page, its preload, or Gateway credentials. */
export async function recoverGatewayConnectionStartup(): Promise<void> {
  let parent: BaseWindow | undefined;
  try {
    await app.whenReady();
    // Unparented macOS alerts run synchronously and can block activation/input dispatch.
    // BaseWindow has no webContents, preload or dependency on the failed remote UI.
    parent = new BaseWindow({ title: 'xopc · Gateway', width: 520, height: 240,
      show: false, resizable: false, minimizable: false, maximizable: false });
    parent.show();
    parent.focus();
    const { response } = await dialog.showMessageBox(parent, { type: 'error', title: 'xopc · Gateway',
      message: '远端连接界面未能启动', detail: '可以重新启动到本地模式。现有本地配置和会话不会被修改。',
      buttons: ['使用本地模式', '退出'], defaultId: 0, cancelId: 1, noLink: true });
    console.info(`[GatewayConnections] Startup recovery choice: ${response === 0 ? 'local' : 'exit'}`);
    if (response === 0) app.relaunch({ args: process.defaultApp ? [process.argv[1]!] : [] });
  } catch { /* A failed native dialog must still allow a clean exit. */ }
  finally {
    try { if (parent && !parent.isDestroyed()) parent.destroy(); }
    finally { app.quit(); }
  }
}
