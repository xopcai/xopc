import { app, dialog } from 'electron';

/** Recovery must not depend on the remote page, its preload, or Gateway credentials. */
export async function recoverGatewayConnectionStartup(): Promise<void> {
  try {
    await app.whenReady();
    const { response } = await dialog.showMessageBox({ type: 'error', title: 'xopc · Gateway',
      message: '远端连接界面未能启动', detail: '可以重新启动到本地模式。现有本地配置和会话不会被修改。',
      buttons: ['使用本地模式', '退出'], defaultId: 0, cancelId: 1, noLink: true });
    if (response === 0) app.relaunch({ args: process.defaultApp ? [process.argv[1]!] : [] });
  } catch { /* A failed native dialog must still allow a clean exit. */ }
  finally { app.quit(); }
}
