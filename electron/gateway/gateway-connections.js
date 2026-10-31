/* The setup document never receives a Gateway credential back from main. */
const api = window.gatewayConnections;
const element = id => document.getElementById(id);
let snapshot;
let transport = 'direct';
let busy = false;
let credentialTarget;
const desktopMessages = {
  registered: '电脑身份已登记，本机能力需要另行授权。',
  unregistered: '未找到本机登记，可先登记电脑身份。', pending: '登记尚未完成，可继续登记或停用。',
  'disabled-confirmed': '本机已停用，服务器撤销已确认。',
  'disabled-unconfirmed': '本机已停用，服务器撤销尚未确认。',
  cancelled: '已取消登记。', error: '登记状态需要检查。',
};
const errors = {
  DESKTOP_LOCAL_CONSENT_DENIED: '已取消登记。', DESKTOP_OPERATION_CANCELLED: '登记操作已取消。',
  DESKTOP_SELECT_GATEWAY_REQUIRED: '请先选择此Gateway配置。', DESKTOP_PINNED_GATEWAY_REQUIRED: '请先连接一次并核验Gateway身份。',
  DESKTOP_HOST_UNSUPPORTED: '此Gateway暂不支持电脑登记。', DESKTOP_HOST_SSH_UNSUPPORTED: '此Gateway暂不支持通过SSH登记电脑。',
  DESKTOP_LOCAL_UI_REQUIRED: '请在可见的连接窗口中登记电脑。', DESKTOP_OWNER_AUTH_REQUIRED: '管理登录已失效，请更新此连接的登录凭据。',
  DESKTOP_AUTH_UNAVAILABLE: '暂时无法连接登记服务，请检查网络后重试。', DESKTOP_AUTH_REVOKED: '登记凭据已失效，需要确认旧登记撤销后重新登记。',
  DESKTOP_REENROLLMENT_REQUIRED: '请先确认旧登记已撤销，再重新登记。', DESKTOP_OPERATION_BUSY: '另一项登记操作仍在结束，请稍后重试。',
  SECURE_STORAGE_UNAVAILABLE: '系统安全存储不可用，无法保存电脑身份。',
  DESKTOP_NOT_ENROLLED: '未找到本机登记。', DESKTOP_ENROLLMENT_PENDING: '登记尚未完成，请继续登记或停用。',
};
function render(value) {
  snapshot = value;
  element('status').textContent = value.status === 'storage-error'
    ? '配置存储不可用，请退出后修复独立的连接配置；本地模式仍可使用。'
    : value.selectedId ? '配置已选择；点击连接打开远端聊天。本机能力保持禁用。' : '请选择或保存连接配置。本机能力保持禁用。';
  element('profiles').replaceChildren();
  for (const profile of value.profiles) {
    const row = document.createElement('li');
    row.append(document.createTextNode(`${profile.name} · ${profile.origin} · ${profile.hasCredential ? '凭据已加密保存' : '未保存凭据'} `));
    const select = document.createElement('button');
    select.textContent = '选择配置';
    select.disabled = busy;
    select.onclick = () => perform(() => api.select(snapshot.epoch, profile.id));
    row.append(select);
    const connect = document.createElement('button');
    connect.textContent = '连接并打开聊天';
    connect.disabled = busy;
    connect.onclick = () => perform(() => api.connect(snapshot.epoch, profile.id));
    row.append(connect);
    const update = document.createElement('button'); update.textContent = '更新登录凭据';
    update.disabled = busy; update.dataset.login = profile.id;
    update.onclick = () => {
      credentialTarget = { epoch: snapshot.epoch, profile }; element('login-target').textContent = `${profile.name} · ${profile.origin}`;
      element('login-update').hidden = false; element('login-credential').value = ''; element('login-credential').focus();
    };
    row.append(update);
    const remove = document.createElement('button');
    remove.textContent = '移除配置';
    remove.disabled = busy;
    remove.onclick = () => { if (window.confirm('移除配置会删除此连接的本机草稿和待核实记录，不会停止服务器任务。是否继续？')) void perform(() => api.remove(snapshot.epoch, profile.id)); };
    row.append(remove);
    const group = document.createElement('div'); group.className = 'desktop-actions';
    const state = value.desktop?.[profile.id]?.state;
    const description = document.createElement('p'); description.id = `desktop-state-${profile.id}`;
    description.textContent = desktopMessages[state] ?? (profile.identity ? '可登记这台电脑的身份；本机能力需要另行授权。' : '连接并核验身份后，可登记这台电脑。');
    description.setAttribute('role', 'status'); group.append(description);
    const actionButton = (label, method, enabled, kind) => {
      const button = document.createElement('button'); button.textContent = label; button.disabled = !enabled || busy;
      button.dataset.desktop = kind; button.dataset.profile = profile.id;
      button.setAttribute('aria-describedby', description.id); button.setAttribute('aria-label', `${label}：${profile.name}`);
      button.onclick = () => perform(() => method(snapshot.epoch, profile.id)); group.append(button);
    };
    const selected = value.selectedId === profile.id && Boolean(profile.identity);
    const disabled = state === 'disabled-confirmed' || state === 'disabled-unconfirmed';
    actionButton(disabled ? '重新登记此电脑' : '登记此电脑', disabled ? api.reenrollDesktop : api.enrollDesktop, selected && state !== 'registered', 'enroll');
    actionButton('检查登记', api.checkDesktop, selected, 'check');
    actionButton('停用登记', api.disableDesktop, Boolean(profile.identity), 'disable');
    row.append(group);
    element('profiles').append(row);
  }
}
async function perform(work) {
  if (busy) return;
  const focused = document.activeElement?.dataset;
  const restore = focused?.desktop && focused?.profile ? `[data-desktop="${focused.desktop}"][data-profile="${focused.profile}"]` : undefined;
  busy = true;
  element('error').textContent = '';
  if (snapshot) render(snapshot);
  element('status').textContent = '正在处理，请稍候。';
  element('profiles').setAttribute('aria-busy', 'true');
  try {
    const result = await work();
    if (result.ok) render(result.snapshot);
    else {
      if (result.snapshot) render(result.snapshot);
      if (!['DESKTOP_LOCAL_CONSENT_DENIED', 'DESKTOP_OPERATION_CANCELLED'].includes(result.error)) element('error').textContent = errors[result.error] ?? `操作未完成：${result.error}`;
    }
    return result;
  } catch { element('error').textContent = '配置入口不可用，请退出预览后重试。'; }
  finally {
    busy = false; element('profiles').removeAttribute('aria-busy'); if (snapshot) render(snapshot);
    if (restore) document.querySelector(restore)?.focus();
  }
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
element('local').onclick = () => void api.useLocal();
element('quit').onclick = () => void api.quit();
element('login-update').onsubmit = event => {
  event.preventDefault(); if (!credentialTarget) return;
  const target = credentialTarget, credential = element('login-credential').value; element('login-credential').value = '';
  void perform(() => api.save(target.epoch, { id: target.profile.id, name: target.profile.name, origin: target.profile.origin, transport: target.profile.transport, credential }))
    .then(result => { if (result?.ok) { credentialTarget = undefined; element('login-update').hidden = true; } });
};
element('login-cancel').onclick = () => { credentialTarget = undefined; element('login-credential').value = ''; element('login-update').hidden = true; };
window.addEventListener('focus', () => { if (!busy) void api.snapshot().then(render).catch(() => {}); });
document.addEventListener('dragover', event => event.preventDefault());
document.addEventListener('drop', event => event.preventDefault());
api.snapshot().then(render).catch(() => { element('error').textContent = '连接配置加载失败，可以退出后使用本地模式。'; });
