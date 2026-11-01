/* The setup document never receives a Gateway credential back from main. */
const api = window.gatewayConnections;
const element = id => document.getElementById(id);
let snapshot;
let transport = 'direct';
let busy = false;
let credentialTarget;
let detailId;
let stopPending = false;
const desktopMessages = {
  registered: '电脑身份已登记，本机能力需要另行授权。',
  unregistered: '未找到本机登记，可先登记电脑身份。', pending: '登记尚未完成，可继续登记或停用。',
  'disabled-confirmed': '本机已停用，服务器撤销已确认。',
  'disabled-unconfirmed': '本机已停用，服务器撤销尚未确认。',
  cancelled: '已取消登记。', error: '登记状态需要检查。',
};
const errors = {
  INVALID_PROFILE: '请检查连接名称、服务器地址和连接方式。', INVALID_ORIGIN: '请填写完整的服务器地址。',
  ORIGIN_ONLY_REQUIRED: '服务器地址只填写协议、主机和端口，不包含路径、查询或登录信息。',
  SECURE_REMOTE_ORIGIN_REQUIRED: 'HTTPS 连接需使用有效 HTTPS 地址；SSH 转发仅允许显式的本机 HTTP 地址。',
  REMOTE_CREDENTIAL_REQUIRED: '请先为此连接保存访问令牌。', GATEWAY_AUTH_FAILED: '登录凭据无效或已过期，请更新后重试。',
  GATEWAY_TLS_FAILED: '服务器证书验证未通过，请检查证书和地址。', GATEWAY_NETWORK_FAILED: '暂时无法连接服务器，请检查网络与 Gateway 状态。',
  GATEWAY_CHAT_INCOMPATIBLE: '此服务器的聊天接口不兼容，请检查 Gateway 版本。',
  GATEWAY_IDENTITY_CHANGED: '服务器身份已变化，不能沿用原授权。请核实目标服务器。',
  GATEWAY_IDENTITY_PROOF_FAILED: '无法核验服务器身份，请检查地址和服务器配置。',
  STALE_CONNECTION_EPOCH: '连接状态已变化，请检查当前连接后重新操作。', PROFILE_LIMIT: '最多保存 20 个服务器连接。',
  DESKTOP_LOCAL_CONSENT_DENIED: '已取消本机授权或操作。', DESKTOP_OPERATION_CANCELLED: '本机操作已取消。',
  DESKTOP_CONTAINER_UNAVAILABLE: '本机Docker不可用，请先启动本机Docker服务。',
  DESKTOP_CONTAINER_IMAGE_UNAVAILABLE: '本机尚未安装node:26.12.1-bookworm-slim镜像；请手动准备镜像后重试，不会自动拉取。',
  DESKTOP_CONTAINER_NETWORK_FAILED: '本机Docker暂时未响应，请检查服务；执行停止未确认时不会接管。',
  DESKTOP_CONTAINER_ENGINE_CHANGED: 'Docker Engine身份已变化，无法核实旧资源；请恢复原Engine后核实。',
  DESKTOP_CONTAINER_UNSUPPORTED: '此客户端暂不支持本机Docker命令；聊天仍可使用。',
  DESKTOP_COMPUTER_UNSUPPORTED: '此客户端或Gateway暂不支持独立电脑控制；聊天仍可使用。',
  DESKTOP_COMPUTER_PERMISSIONS_REQUIRED: '请先在macOS系统设置的隐私与安全性中，为此应用开启辅助功能和屏幕录制，再重新授权电脑控制。',
  DESKTOP_COMPUTER_HOST_IDENTITY_UNAVAILABLE: '无法核实当前安装包的电脑控制身份，请检查安装包后重试。',
  DESKTOP_CONTAINER_WORKSPACE_UNAVAILABLE: '原隔离卷未找到；旧记录保留，请核实原Docker Engine和数据。不会自动创建同名空卷。',
  DESKTOP_CONTAINER_WORKSPACE_LIMIT: '本连接的保留工作区已达20个；请先核实并管理已有数据，不会自动删除。',
  DESKTOP_SELECT_GATEWAY_REQUIRED: '请先选择此Gateway配置。', DESKTOP_PINNED_GATEWAY_REQUIRED: '请先连接一次并核验Gateway身份。',
  DESKTOP_HOST_UNSUPPORTED: '此Gateway暂不支持电脑登记。', DESKTOP_HOST_SSH_UNSUPPORTED: '此Gateway暂不支持通过SSH登记电脑。',
  DESKTOP_LOCAL_UI_REQUIRED: '请在可见的连接窗口中登记电脑。', DESKTOP_OWNER_AUTH_REQUIRED: '管理登录已失效，请更新此连接的登录凭据。',
  DESKTOP_EXECUTION_UNSUPPORTED: '此 Gateway 不支持可靠执行；聊天和可用的只读能力仍可使用。',
  DESKTOP_EXECUTION_STOP_UNCONFIRMED: '执行器停止尚未确认，不能切换连接或启动新执行。请再次请求停止。',
  DESKTOP_OPERATION_RECONCILIATION_REQUIRED: '存在结果未知的操作，必须先核实；不会自动重做。',
  DESKTOP_OPERATION_REVIEW_UNSUPPORTED: '此 Gateway 不支持操作核实；聊天仍可使用。',
  DESKTOP_OPERATION_REVIEW_CONFLICT: '操作记录已变化或核实记录不一致，请刷新后检查。',
  DESKTOP_OPERATION_CONTEXT_UNAVAILABLE: '缺少旧操作上下文，请连接原 Gateway 或恢复本机元数据备份；不会删除记录来解除阻断。',
  DESKTOP_AUTH_UNAVAILABLE: '暂时无法连接登记服务，请检查网络后重试。', DESKTOP_AUTH_REVOKED: '登记凭据已失效，需要确认旧登记撤销后重新登记。',
  DESKTOP_REENROLLMENT_REQUIRED: '请先确认旧登记已撤销，再重新登记。', DESKTOP_OPERATION_BUSY: '另一项登记操作仍在结束，请稍后重试。',
  SECURE_STORAGE_UNAVAILABLE: '系统安全存储不可用，无法保存电脑身份。',
  DESKTOP_NOT_ENROLLED: '未找到本机登记。', DESKTOP_ENROLLMENT_PENDING: '登记尚未完成，请继续登记或停用。',
  DESKTOP_OBSERVATION_UNSUPPORTED: '此Gateway暂不支持所选的只读能力连接。',
  DESKTOP_OBSERVATION_DENIED: '设备状态读取未获授权，请检查登记和服务器权限。',
  DESKTOP_OBSERVATION_REVISION_CHANGED: '授权状态已变化，旧的确认已失效。请重新检查并授权。',
};

function textButton(label, action, className = '') {
  const button = document.createElement('button'); button.type = 'button'; button.textContent = label;
  if (className) button.className = className;
  button.onclick = action; return button;
}
function symbol(local = false) {
  const span = document.createElement('span'); span.className = 'symbol'; span.setAttribute('aria-hidden', 'true');
  const ns = 'http://www.w3.org/2000/svg', svg = document.createElementNS(ns, 'svg');
  for (const [key, value] of Object.entries({ viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': '1.5' })) svg.setAttribute(key, value);
  const path = document.createElementNS(ns, 'path');
  path.setAttribute('d', local ? 'M5 16V5h14v11M3 16h18l1 3H2l1-3Z' : 'M7 18a5 5 0 1 1 1-9.9A6 6 0 0 1 20 12a3 3 0 0 1-1 6H7Z');
  svg.append(path); span.append(svg); return span;
}
function showError(message) {
  const target = element('profile-dialog').open ? 'profile-error' : element('login-dialog').open ? 'login-error' : 'error';
  element(target).textContent = message;
}
function showDialog(id) { element(id).querySelector('.form-error').textContent = ''; element(id).showModal(); }
function login(profile) {
  credentialTarget = { epoch: snapshot.epoch, profile };
  element('login-target').textContent = `${profile.name} · ${profile.origin}`;
  element('login-credential').value = ''; showDialog('login-dialog'); element('login-credential').focus();
}
async function connect(profile) {
  detailId = profile.id;
  return perform(() => api.connect(snapshot.epoch, profile.id));
}
function renderConnections(value) {
  const profiles = element('profiles'); profiles.replaceChildren();
  const local = document.createElement('li'); local.className = 'connection';
  const copy = document.createElement('div'); copy.className = 'copy';
  const title = document.createElement('strong'); title.textContent = '本机';
  const note = document.createElement('small'); note.textContent = '使用原本地模式，重新打开应用'; copy.append(title, note);
  const localButton = textButton('使用本机', () => api.useLocal()); localButton.disabled = busy;
  local.append(symbol(true), copy, localButton); profiles.append(local);
  for (const profile of value.profiles) {
    const row = document.createElement('li'); row.className = 'connection';
    const copy = document.createElement('div'); copy.className = 'copy';
    const title = document.createElement('strong'); title.textContent = profile.name;
    const note = document.createElement('small'); note.textContent = profile.origin; copy.append(title);
    if (value.selectedId === profile.id) { const badge = document.createElement('span'); badge.className = 'badge'; badge.textContent = '已选择'; copy.append(badge); }
    copy.append(note);
    const buttons = document.createElement('div'); buttons.className = 'row-actions';
    const open = textButton('连接并打开聊天', () => connect(profile)); open.disabled = busy;
    const detail = textButton('详情 ›', () => { detailId = profile.id; render(snapshot); }, 'text-button'); detail.disabled = busy;
    const menu = document.createElement('details'); menu.className = 'profile-menu'; menu.dataset.expansion = `menu-${profile.id}`;
    const summary = document.createElement('summary'); summary.textContent = '···'; summary.setAttribute('aria-label', `更多：${profile.name}`);
    const items = document.createElement('div');
    const select = textButton('选择配置', () => perform(() => api.select(snapshot.epoch, profile.id)));
    const update = textButton('更新登录凭据', () => login(profile)); update.dataset.login = profile.id;
    const remove = textButton('移除配置', () => {
      if (window.confirm('移除配置会删除此连接的本机聊天草稿与消息核实状态；执行操作记录仍保留，不会停止服务器任务。是否继续？')) void perform(() => api.remove(snapshot.epoch, profile.id));
    }, 'danger');
    for (const button of [select, update, remove]) button.disabled = busy;
    items.append(select, update, remove); menu.append(summary, items); buttons.append(open, detail, menu);
    row.append(symbol(), copy, buttons); profiles.append(row);
  }
}
function renderDesktop(profile, value, observing, executing) {
  const group = element('desktop-actions'); group.replaceChildren();
  const registration = document.createElement('div'); registration.className = 'desktop-registration';
  const capabilities = document.createElement('div'); capabilities.className = 'capabilities';
  const categories = [ ['read', '设备状态与截图'], ['files', '文件与剪贴板'], ['execute', '命令与控制'] ];
  const targets = {};
  for (const [key, name] of categories) {
    const details = document.createElement('details'); details.className = 'cap-group'; details.dataset.expansion = `${profile.id}-${key}`;
    const summary = document.createElement('summary'); summary.textContent = name;
    const content = document.createElement('div'); content.className = 'cap-actions'; details.append(summary, content); capabilities.append(details); targets[key] = content;
  }
  const recovery = element('profile-recovery'); recovery.replaceChildren();
  const targetFor = kind => kind === 'enroll' ? registration
    : ['check', 'disable', 'stop-receipts', 'operation-list'].includes(kind) ? recovery
    : kind.startsWith('observe-') ? targets.read
    : ['execute-clipboard', 'execute-workspace'].includes(kind) ? targets.files : targets.execute;
  const state = value.desktop?.[profile.id]?.state;
  const description = document.createElement('p'); description.className = 'muted'; description.id = `desktop-state-${profile.id}`;
  description.textContent = desktopMessages[state] ?? (profile.identity ? '可登记这台电脑的身份；本机能力需要另行授权。' : '连接并核验身份后，可登记这台电脑。');
  description.setAttribute('role', 'status'); group.append(description);
  const actionButton = (label, method, enabled, kind) => {
    const button = document.createElement('button'); button.textContent = label; button.disabled = !enabled || busy;
    button.dataset.desktop = kind; button.dataset.profile = profile.id;
    button.setAttribute('aria-describedby', description.id); button.setAttribute('aria-label', `${label}：${profile.name}`);
    button.onclick = () => perform(() => method(snapshot.epoch, profile.id)); targetFor(kind).append(button);
  };
  const selected = value.selectedId === profile.id && Boolean(profile.identity);
  const disabled = state === 'disabled-confirmed' || state === 'disabled-unconfirmed';
  actionButton(disabled ? '重新登记此电脑' : '登记此电脑', disabled ? api.reenrollDesktop : api.enrollDesktop, selected && state !== 'registered', 'enroll');
  actionButton('检查登记', api.checkDesktop, selected, 'check');
  actionButton('停用登记', api.disableDesktop, Boolean(profile.identity), 'disable');
  actionButton('授权读取设备状态', api.startObservation, selected && state === 'registered' && !observing && !executing, 'observe-state');
  actionButton('选择截图来源并授权', api.startScreenObservation, selected && state === 'registered' && !observing && !executing, 'observe-screen');
  actionButton('授权逐次确认剪贴板写入', api.startExecution, selected && state === 'registered' && value.desktop?.[profile.id]?.reliableExecution === true && !observing && !executing, 'execute-clipboard');
  actionButton('选择并授权本机工作区', api.startWorkspace, selected && state === 'registered' && value.desktop?.[profile.id]?.workspaceExecution === true && !observing && !executing, 'execute-workspace');
  actionButton('授权逐次确认Docker命令', api.startContainer, selected && state === 'registered' && value.desktop?.[profile.id]?.containerCommand === true && !observing && !executing, 'execute-container');
  actionButton('授权逐次确认Docker终端', api.startTerminal, selected && state === 'registered' && value.desktop?.[profile.id]?.containerTerminal === true && !observing && !executing, 'execute-terminal');
  actionButton('授权逐次确认电脑控制', api.startComputer, selected && state === 'registered' && value.desktop?.[profile.id]?.remoteComputer === true && !observing && !executing, 'execute-computer');
  actionButton('授权逐次确认专用浏览器', api.startBrowser, selected && state === 'registered' && value.desktop?.[profile.id]?.remoteBrowser === true && !observing && !executing, 'execute-browser');
  actionButton('补交已确认的停止回执', api.flushStopReceipts, selected && Boolean(profile.identity) && !executing, 'stop-receipts');
  actionButton('查看保留的Docker工作区', api.listContainers, selected && state === 'registered' && value.desktop?.[profile.id]?.containerCommand === true, 'container-list');
  if (selected && value.savedContainers?.profileId === profile.id) {
    for (const item of value.savedContainers.items) actionButton(`重新授权：${item.label}`, (epoch, id) => api.startContainer(epoch, id, item.workspaceId), !observing && !executing, `container-${item.workspaceId}`);
    if (value.desktop?.[profile.id]?.containerTerminal === true) for (const item of value.savedContainers.items) actionButton(`以终端重新授权：${item.label}`, (epoch, id) => api.startTerminal(epoch, id, item.workspaceId), !observing && !executing, `terminal-${item.workspaceId}`);
    if (!value.savedContainers.items.length) { const empty = document.createElement('p'); empty.textContent = '尚无保留的隔离工作区。'; targets.execute.append(empty); }
  }
  actionButton('查看待核实操作', api.listOperations, selected && state === 'registered' && value.desktop?.[profile.id]?.operationReview === true, 'operation-list');

  group.append(registration, capabilities);
  capabilities.hidden = state !== 'registered';
}

function render(value) {
  if (snapshot && value.epoch < snapshot.epoch) return;
  const previous = snapshot;
  const focused = document.activeElement;
  const focus = focused?.dataset;
  const focusedAction = focus?.desktop && focus?.profile ? `[data-desktop="${focus.desktop}"][data-profile="${focus.profile}"]` : undefined;
  const expanded = new Set([...document.querySelectorAll('details[data-expansion][open]')].map(item => item.dataset.expansion));
  const selected = value.profiles.find(profile => profile.id === value.selectedId);
  if (!detailId && selected?.identity && (previous?.selectedId !== selected.id || !previous?.profiles.find(profile => profile.id === selected.id)?.identity)) detailId = selected.id;
  if (detailId && !value.profiles.some(profile => profile.id === detailId)) detailId = undefined;
  snapshot = value;
  const execution = value.execution;
  const executing = execution && !['stopped', 'error'].includes(execution.state);
  const executionLabels = { authorizing: '等待本机授权。', connecting: '本机执行连接中。', online: value.execution?.browser ? '已授权逐次确认专用浏览器，最长两分钟。停止窗口保持可见。' : value.execution?.computer ? '已授权逐次确认电脑控制，最长两分钟。停止窗口保持可见。' : value.execution?.terminal ? '已授权Docker终端，每次输入须确认，最长两分钟。' : value.execution?.container ? '已授权逐次确认Docker命令，最长两分钟。' : value.execution?.workspaceId ? '已授权逐次确认工作区访问，最长两分钟。' : '已授权逐次确认剪贴板写入，最长两分钟。',
    'stop-requested': '已请求停止，正在核实。', stopped: execution?.remoteRevocationConfirmed ? '本机执行已停止，服务器撤销已确认。' : '本机执行已停止，服务器撤销尚未确认。',
    'stop-unconfirmed': '执行器停止尚未确认；禁止切换或启动新的执行。', error: '本机执行连接失败，请检查后重新授权。' };
  element('execution-status').textContent = execution ? executionLabels[execution.state] + (execution.resultUnknown ? ' 操作效果仍未知，核实后才能启动新写入。' : '')
    + (execution.stopReceiptConfirmed === false ? ' 停止回执尚未送达，恢复连接后可补交；不会重放操作。' : '') : '本机写入未授权。';
  element('execution-stop').disabled = !busy && (!execution || execution.state === 'stopped');
  const observation = value.observation;
  const observing = observation && ['connecting', 'online', 'offline'].includes(observation.state);
  const labels = { connecting: '本机只读能力正在连接。', online: observation?.capability === 'screen' ? '已选择截图来源；每次发送仍需确认。文件、命令和输入控制保持禁用。' : '已授权读取设备状态；屏幕、文件、命令保持禁用。', offline: '本机只读能力连接已断开，正在恢复。', stopped: '本机只读能力已停止。', error: '本机只读能力连接失败，请重新授权。' };
  element('observation-status').textContent = observation ? labels[observation.state] : '本机只读能力未授权。';
  element('observation-stop').disabled = !observation || observation.state === 'stopped';

  element('observation-section').hidden = !observation;
  element('execution-section').hidden = !execution;
  element('execution-section').classList.toggle('warning', Boolean(execution?.resultUnknown || execution?.state === 'stop-unconfirmed' || execution?.stopReceiptConfirmed === false));
  if (stopPending) { element('execution-status').textContent = '已请求停止，正在核实。'; element('execution-stop').disabled = true; }
  element('status').textContent = value.status === 'storage-error' ? '配置存储不可用；可以退出后修复连接配置，或使用原本地模式。' : busy ? '正在处理，请稍候。' : '';
  element('selection-status').textContent = selected ? `当前选择：${selected.name}` : '尚未选择远端 Gateway';
  renderConnections(value);
  element('connection-list').hidden = Boolean(detailId); element('connection-detail').hidden = !detailId;
  for (const control of document.querySelectorAll('#profile-form input, #profile-form button, #login-update input, #login-update button')) control.disabled = busy;
  element('add-server').disabled = busy; element('detail-connect').disabled = busy; element('detail-login').disabled = busy;
  const profile = value.profiles.find(profile => profile.id === detailId);
  element('profile-recovery').replaceChildren();
  if (profile) {
    element('detail-name').textContent = profile.name; element('detail-origin').textContent = profile.origin;
    element('detail-symbol').replaceChildren(...symbol().childNodes);
    element('detail-state').textContent = value.selectedId === profile.id ? '已选择' : '尚未选择';
    element('detail-transport').textContent = profile.transport === 'ssh' ? '已有 SSH loopback 转发' : 'HTTPS';
    element('detail-identity').textContent = profile.identity ? '身份已核验 · 绑定此服务器' : '连接后核验';
    element('detail-login').textContent = profile.hasCredential ? '已加密保存 · 更新' : '尚未保存 · 添加';
    renderDesktop(profile, value, observing, executing);
  }
  element('local-operation-list').disabled = busy;
  element('local-operation-reviews').replaceChildren();
  if (value.localOperationReviews) {
    for (const item of value.localOperationReviews) {
      const row = document.createElement('li'), label = document.createElement('p'), action = document.createElement('button');
      label.textContent = `${item.intent?.tool ?? '上下文缺失'} · ${item.operationId}`;
      action.textContent = '离线检查后允许新意图'; action.dataset.localOperationReview = item.operationId; action.disabled = busy || !item.intent;
      action.onclick = () => perform(() => api.reviewLocalOperation(snapshot.epoch, item.operationId));
      row.append(label, action); element('local-operation-reviews').append(row);
    }
    element('local-operation-note').textContent = value.localOperationReviews.length ? '离线核实只记录本机确认，原服务器仍可能需要单独确认。不能确认停止的操作不会放行。' : '本机没有未核实的遗留记录。';
  }
  const reviews = value.operationReviews;
  element('operation-review-panel').hidden = !reviews;
  element('operation-reviews').replaceChildren();
  if (reviews) {
    for (const item of reviews.items) {
      const row = document.createElement('li'), label = document.createElement('p'), action = document.createElement('button');
      label.textContent = `${item.intent.tool} · ${item.intent.operationId}`; action.textContent = '检查后允许新意图'; action.dataset.operationReview = item.intent.operationId; action.disabled = busy;
      action.onclick = () => perform(() => api.reviewOperation(snapshot.epoch, reviews.profileId, item.intent.operationId));
      row.append(label, action); element('operation-reviews').append(row);
    }
    element('operation-review-note').textContent = reviews.items.length ? '每次最多显示8项；核实后可刷新继续。缺少回执不代表没有执行。' : '当前连接没有待核实的服务器操作。';
  }

  if (value.localOperationReviews || reviews || execution?.resultUnknown || execution?.state === 'stop-unconfirmed' || execution?.stopReceiptConfirmed === false) element('recovery').open = true;
  for (const details of document.querySelectorAll('details[data-expansion]')) details.open = expanded.has(details.dataset.expansion);
  if (focusedAction) document.querySelector(focusedAction)?.focus();
}
async function perform(work) {
  if (busy) return;
  const focused = document.activeElement?.dataset;
  const restore = focused?.desktop && focused?.profile ? `[data-desktop="${focused.desktop}"][data-profile="${focused.profile}"]` : undefined;
  busy = true;
  for (const id of ['error', 'profile-error', 'login-error']) element(id).textContent = '';
  if (snapshot) render(snapshot);
  element('status').textContent = '正在处理，请稍候。';
  element('profiles').setAttribute('aria-busy', 'true');
  try {
    const result = await work();
    if (result.ok) render(result.snapshot);
    else {
      if (result.snapshot) render(result.snapshot);
      if (!['DESKTOP_LOCAL_CONSENT_DENIED', 'DESKTOP_OPERATION_CANCELLED'].includes(result.error)) showError(errors[result.error] ?? `操作未完成：${result.error}`);
    }
    return result;
  } catch { showError('配置入口不可用，请退出应用后重试。'); }
  finally {
    busy = false; element('profiles').removeAttribute('aria-busy'); if (snapshot) render(snapshot);
    if (restore) document.querySelector(restore)?.focus();
  }
}

for (const value of ['direct', 'ssh']) element(value).onclick = () => {
  transport = value;
  for (const choice of ['direct', 'ssh']) element(choice).setAttribute('aria-pressed', String(choice === value));
  element('origin').placeholder = value === 'ssh' ? 'http://127.0.0.1:28790' : 'https://gateway.example.com';
};
element('add-server').onclick = () => {
  element('profile-form').reset(); element('profile-form').querySelector('details').open = false;
  element('direct').click(); showDialog('profile-dialog'); element('origin').focus();
};
function closeProfile() { if (busy) return; element('credential').value = ''; element('profile-dialog').close(); }
for (const id of ['profile-close', 'profile-cancel']) element(id).onclick = closeProfile;
element('profile-dialog').addEventListener('cancel', event => { if (busy) { event.preventDefault(); return; } element('credential').value = ''; });
element('profile-form').onsubmit = async event => {
  event.preventDefault(); if (busy || !snapshot) return;
  const origin = element('origin').value.trim();
  let name = element('name').value.trim();
  if (!name) { try { name = new URL(origin).hostname.slice(0, 80); } catch { name = '远端服务器'; } }
  const credential = element('credential').value; element('credential').value = '';
  const connectAfterSave = event.submitter?.value === 'connect';
  const known = new Set(snapshot.profiles.map(profile => profile.id));
  const result = await perform(() => api.save(snapshot.epoch, { name, origin, transport, ...(credential ? { credential } : {}) }));
  if (result?.ok) {
    closeProfile();
    const profile = result.snapshot.profiles.find(profile => !known.has(profile.id));
    if (connectAfterSave && profile) await connect(profile);
  }
};
element('back').onclick = () => { detailId = undefined; render(snapshot); element('add-server').focus(); };
element('detail-connect').onclick = () => { const profile = snapshot.profiles.find(profile => profile.id === detailId); if (profile) void connect(profile); };
element('detail-login').onclick = () => { const profile = snapshot.profiles.find(profile => profile.id === detailId); if (profile) login(profile); };
element('local').onclick = () => void api.useLocal();
element('observation-stop').onclick = () => { void api.stopObservation().then(result => { if (result?.snapshot) render(result.snapshot); }).catch(() => { showError('停止请求未确认，请重试。'); }); };
element('local-operation-list').onclick = () => void perform(() => api.listLocalOperations(snapshot.epoch));
element('execution-stop').onclick = async () => {
  stopPending = true; if (snapshot) render(snapshot);
  try { const result = await api.stopExecution(); if (result?.snapshot) render(result.snapshot); if (!result?.ok) showError(errors[result?.error] ?? '停止请求未确认，请重试。'); }
  catch { showError('停止请求未确认，请重试。'); }
  finally { stopPending = false; if (snapshot) render(snapshot); }
};
element('quit').onclick = () => void api.quit();
element('login-update').onsubmit = event => {
  event.preventDefault(); if (!credentialTarget) return;
  const target = credentialTarget, credential = element('login-credential').value; element('login-credential').value = '';
  void perform(() => api.save(target.epoch, { id: target.profile.id, name: target.profile.name, origin: target.profile.origin, transport: target.profile.transport, credential }))
    .then(result => { if (result?.ok) { credentialTarget = undefined; element('login-dialog').close(); } });
};
function closeLogin() { if (busy) return; credentialTarget = undefined; element('login-credential').value = ''; element('login-dialog').close(); }
for (const id of ['login-cancel', 'login-close']) element(id).onclick = closeLogin;
element('login-dialog').addEventListener('cancel', event => { if (busy) { event.preventDefault(); return; } credentialTarget = undefined; element('login-credential').value = ''; });
window.addEventListener('focus', () => { if (!busy) void api.snapshot().then(render).catch(() => {}); });
setInterval(() => {
  if (!busy && document.visibilityState === 'visible') void api.snapshot().then(next => { if (JSON.stringify(next) !== JSON.stringify(snapshot)) render(next); }).catch(() => {});
}, 3000);
document.addEventListener('dragover', event => event.preventDefault());
document.addEventListener('drop', event => event.preventDefault());
api.snapshot().then(render).catch(() => { element('error').textContent = '连接配置加载失败，可以退出后使用本地模式。'; });
