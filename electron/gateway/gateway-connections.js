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
function render(value) {
  const focus = document.activeElement?.dataset;
  const focusedAction = focus?.desktop && focus?.profile ? `[data-desktop="${focus.desktop}"][data-profile="${focus.profile}"]` : undefined;
  snapshot = value;
  const execution = value.execution;
  const executing = execution && !['stopped', 'error'].includes(execution.state);
  const executionLabels = { authorizing: '等待本机授权。', connecting: '本机执行连接中。', online: '已授权逐次确认剪贴板写入，最长两分钟。',
    'stop-requested': '已请求停止，正在核实。', stopped: execution?.remoteRevocationConfirmed ? '本机执行已停止，服务器撤销已确认。' : '本机执行已停止，服务器撤销尚未确认。',
    'stop-unconfirmed': '执行器停止尚未确认；禁止切换或启动新的执行。', error: '本机执行连接失败，请检查后重新授权。' };
  element('execution-status').textContent = execution ? executionLabels[execution.state] + (execution.resultUnknown ? ' 操作效果仍未知，核实后才能启动新写入。' : '') : '本机写入未授权。';
  element('execution-stop').disabled = !busy && (!execution || execution.state === 'stopped');
  const observation = value.observation;
  const observing = observation && ['connecting', 'online', 'offline'].includes(observation.state);
  const labels = { connecting: '本机只读能力正在连接。', online: observation?.capability === 'screen' ? '已选择截图来源；每次发送仍需确认。文件、命令和输入控制保持禁用。' : '已授权读取设备状态；屏幕、文件、命令保持禁用。', offline: '本机只读能力连接已断开，正在恢复。', stopped: '本机只读能力已停止。', error: '本机只读能力连接失败，请重新授权。' };
  element('observation-status').textContent = observation ? labels[observation.state] : '本机只读能力未授权。';
  element('observation-stop').disabled = !observation || observation.state === 'stopped';
  element('status').textContent = value.status === 'storage-error'
    ? '配置存储不可用，请退出后修复独立的连接配置；本地模式仍可使用。'
    : value.selectedId ? '配置已选择；点击连接打开远端聊天。本机能力需要单独授权。' : '请选择或保存连接配置。本机能力保持禁用。';
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
    actionButton('授权读取设备状态', api.startObservation, selected && state === 'registered' && !observing && !executing, 'observe-state');
    actionButton('选择截图来源并授权', api.startScreenObservation, selected && state === 'registered' && !observing && !executing, 'observe-screen');
    actionButton('授权逐次确认剪贴板写入', api.startExecution, selected && state === 'registered' && value.desktop?.[profile.id]?.reliableExecution === true && !observing && !executing, 'execute-clipboard');
    actionButton('查看待核实操作', api.listOperations, selected && state === 'registered' && value.desktop?.[profile.id]?.operationReview === true, 'operation-list');
    row.append(group);
    element('profiles').append(row);
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
  if (focusedAction) document.querySelector(focusedAction)?.focus();
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
element('observation-stop').onclick = () => { void api.stopObservation().then(result => { if (result?.snapshot) render(result.snapshot); }).catch(() => {}); };
element('local-operation-list').onclick = () => void perform(() => api.listLocalOperations(snapshot.epoch));
element('execution-stop').onclick = () => { element('execution-status').textContent = '已请求停止，正在核实。'; void api.stopExecution().then(result => { if (result?.snapshot) render(result.snapshot); }).catch(() => {}); };
element('quit').onclick = () => void api.quit();
element('login-update').onsubmit = event => {
  event.preventDefault(); if (!credentialTarget) return;
  const target = credentialTarget, credential = element('login-credential').value; element('login-credential').value = '';
  void perform(() => api.save(target.epoch, { id: target.profile.id, name: target.profile.name, origin: target.profile.origin, transport: target.profile.transport, credential }))
    .then(result => { if (result?.ok) { credentialTarget = undefined; element('login-update').hidden = true; } });
};
element('login-cancel').onclick = () => { credentialTarget = undefined; element('login-credential').value = ''; element('login-update').hidden = true; };
window.addEventListener('focus', () => { if (!busy) void api.snapshot().then(render).catch(() => {}); });
setInterval(() => {
  if (!busy && document.visibilityState === 'visible') void api.snapshot().then(next => { if (JSON.stringify(next) !== JSON.stringify(snapshot)) render(next); }).catch(() => {});
}, 3000);
document.addEventListener('dragover', event => event.preventDefault());
document.addEventListener('drop', event => event.preventDefault());
api.snapshot().then(render).catch(() => { element('error').textContent = '连接配置加载失败，可以退出后使用本地模式。'; });
