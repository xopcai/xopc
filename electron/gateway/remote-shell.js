const element = id => document.getElementById(id);
async function start() {
  try {
    const bootstrap = await window.desktopShell.bootstrap();
    if (!bootstrap.ok) throw new Error();
    const response = await fetch('/api/browser-session');
    if (!response.ok) throw new Error();
    const state = await response.json();
    element('status').textContent = state.authenticated ? '身份与聊天传输契约已核验；S2 会话已建立。' : '连接已锁定，请返回配置重新连接。';
    element('details').textContent = `Gateway: ${state.gatewayId}\nEpoch: ${state.epoch}\n本机能力：禁用`;
  } catch { element('status').textContent = '连接不可用，请返回配置恢复；不会自动启动本地 Gateway。'; }
}
element('recover').onclick = () => window.desktopShell.recover();
element('logout').onclick = async () => {
  await fetch('/api/browser-session', { method: 'DELETE' }).catch(() => {});
  element('status').textContent = '本地会话已退出，请返回配置重新连接。';
};
document.addEventListener('dragover', event => event.preventDefault());
document.addEventListener('drop', event => event.preventDefault());
void start();
