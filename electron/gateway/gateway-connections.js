/* The setup document never receives a Gateway credential back from main. */
const api = window.gatewayConnections;
const element = id => document.getElementById(id);
let snapshot;
let transport = 'direct';
let busy = false;
function render(value) {
  snapshot = value;
  element('status').textContent = value.status === 'storage-error'
    ? '配置存储不可用，请退出后修复独立的连接配置；本地模式仍可使用。'
    : value.selectedId ? '配置已选择；远端聊天尚未实现。本机能力保持禁用。' : '请选择或保存连接配置。本机能力保持禁用。';
  element('profiles').replaceChildren();
  for (const profile of value.profiles) {
    const row = document.createElement('li');
    row.append(document.createTextNode(`${profile.name} · ${profile.origin} · ${profile.hasCredential ? '凭据已加密保存' : '未保存凭据'} `));
    const select = document.createElement('button');
    select.textContent = '选择配置';
    select.onclick = () => perform(() => api.select(snapshot.epoch, profile.id));
    row.append(select);
    const connect = document.createElement('button');
    connect.textContent = '建立 S2 连接';
    connect.onclick = () => perform(() => api.connect(snapshot.epoch, profile.id));
    row.append(connect);
    const remove = document.createElement('button');
    remove.textContent = '移除配置';
    remove.onclick = () => perform(() => api.remove(snapshot.epoch, profile.id));
    row.append(remove);
    element('profiles').append(row);
  }
}
async function perform(work) {
  if (busy) return;
  busy = true;
  element('error').textContent = '';
  try {
    const result = await work();
    if (result.ok) render(result.snapshot);
    else element('error').textContent = `操作未完成：${result.error}`;
  } catch { element('error').textContent = '配置入口不可用，请退出预览后重试。'; }
  finally { busy = false; }
}
for (const value of ['direct', 'ssh']) element(value).onclick = () => {
  transport = value;
  for (const choice of ['direct', 'ssh']) element(choice).setAttribute('aria-pressed', String(choice === value));
};
element('profile-form').onsubmit = event => {
  event.preventDefault();
  const credential = element('credential').value;
  element('credential').value = '';
  void perform(() => api.save(snapshot.epoch, { name: element('name').value,
    origin: element('origin').value, transport, ...(credential ? { credential } : {}) }));
};
element('local').onclick = () => { if (!busy) void api.useLocal(); };
element('quit').onclick = () => void api.quit();
document.addEventListener('dragover', event => event.preventDefault());
document.addEventListener('drop', event => event.preventDefault());
api.snapshot().then(render).catch(() => { element('error').textContent = '连接配置加载失败，可以退出后使用本地模式。'; });
