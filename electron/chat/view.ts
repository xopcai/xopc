import { RemoteChatModel, ChatApiError, type ChatView, type ChatApi } from './model.js';
import type { ChatState } from './state.js';

declare global {
  interface Window { desktopShell: { bootstrap(): Promise<{ ok: boolean }>; recover(): Promise<unknown>; readState(): Promise<ChatState>; writeState(value: ChatState): Promise<unknown> } }
}
const element = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
let model: RemoteChatModel | undefined;
let closed = false;
const phases = { connecting: '连接中', syncing: '正在同步服务器状态', ready: '就绪', retrying: '离线，正在重连', recovery: '需恢复连接', unknown: '输入待核实' };
function button(text: string, action: () => void, selected = false) {
  const node = document.createElement('button'); node.type = 'button'; node.textContent = text; node.onclick = action;
  node.setAttribute('aria-pressed', String(selected)); return node;
}
function render(view: ChatView) {
  element<HTMLButtonElement>('new').disabled = ['connecting', 'syncing', 'recovery'].includes(view.phase);
  element('status').textContent = phases[view.phase]; element('notice').textContent = view.notice;
  element('skeleton').hidden = !['connecting', 'syncing'].includes(view.phase) || view.messages.length > 0;
  element('sessions').replaceChildren(...view.sessions.map(session => button(session.name || session.label || session.key,
    () => { void model?.select(session.key).catch(showError); }, session.key === view.selected)));
  element('draft-title').hidden = !view.drafts.length;
  element('drafts').replaceChildren(...view.drafts.map(draft => button(`草稿 · ${draft.preview}`, () => { void model?.select(draft.conversationId).catch(showError); }, draft.conversationId === view.selected)));
  element('thinking').replaceChildren(...(view.models.find(item => item.id === view.model)?.thinking?.options ?? []).map(level => button(level, () => model?.choose(view.model, view.agent, level), level === view.thinking)));
  element('models').replaceChildren(...view.models.map(item => button(item.name ?? item.id, () => model?.choose(item.id, view.agent), item.id === view.model)));
  element('agents').replaceChildren(...view.agents.map(item => button(item.name ?? item.id, () => model?.choose(view.model, item.id), item.id === view.agent)));
  const history = element('messages'); const bottom = history.scrollHeight - history.scrollTop - history.clientHeight < 80;
  history.replaceChildren(...view.messages.map(message => {
    const article = document.createElement('article'); article.dataset.role = message.role; if (message.id) article.dataset.messageId = message.id;
    const label = document.createElement('strong'); label.textContent = message.role === 'user' ? '你' : message.role === 'assistant' ? 'Assistant' : '服务器记录（本机能力不可用）';
    const text = document.createElement('p'); text.textContent = message.content; article.append(label, text);
    for (const media of message.media ?? []) {
      if (!media.uri || !view.selected) continue;
      const url = `/api/media/read?uri=${encodeURIComponent(media.uri)}&conversationId=${encodeURIComponent(view.selected)}`;
      if (/^image\/(png|jpeg|gif|webp)$/.test(media.mimeType ?? '')) {
        const image = document.createElement('img'); image.src = url; image.alt = media.name ?? '服务器附件'; image.loading = 'lazy'; image.referrerPolicy = 'no-referrer'; article.append(image);
      } else { const note = document.createElement('small'); note.textContent = `${media.name ?? '附件'}：本预览不打开本机文件或下载到磁盘。`; article.append(note); }
    }
    return article;
  }));
  if (bottom) history.scrollTop = history.scrollHeight;
  const input = element<HTMLTextAreaElement>('input'); if (input.value !== view.draft) input.value = view.draft;
  input.disabled = Boolean(view.historical) || view.pending || view.phase === 'recovery';
  element<HTMLButtonElement>('send').disabled = view.phase !== 'ready' || Boolean(view.historical) || !view.draft.trim() || view.pending;
  element<HTMLButtonElement>('stop').disabled = !view.activeRun || view.stop === 'requested';
  element('stop-state').textContent = ({ requested: '已请求停止，等待服务器确认。', acknowledged: '服务器已响应；仍在核实运行状态。', confirmed: '已确认服务器运行停止。', unknown: '停止结果未知，请核实服务器状态。', '': '' })[view.stop];
  element<HTMLButtonElement>('older').disabled = !view.older; element<HTMLButtonElement>('latest').hidden = !view.historical;
  element<HTMLButtonElement>('verify').hidden = !view.pending;
}
function showError(error: unknown) { element('notice').textContent = error instanceof Error ? error.message : '操作未完成，请恢复连接。'; }
const api: ChatApi = async <T>(path: string, body?: unknown, signal?: AbortSignal): Promise<T> => {
  const response = await fetch(path, { method: body === undefined ? 'GET' : 'POST', headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(15_000)]) : AbortSignal.timeout(15_000) });
  const data = await response.json();
  if (!response.ok) throw new ChatApiError(response.status, typeof data.error?.code === 'string' ? data.error.code : 'GATEWAY_REQUEST_FAILED', typeof data.error?.message === 'string' ? data.error.message.slice(0, 500) : undefined);
  return (data.pagination && data.payload && typeof data.payload === 'object' ? { ...data.payload, pagination: data.pagination } : data.payload ?? data) as T;
};
async function start() {
  try {
    if (!(await window.desktopShell.bootstrap()).ok) throw new Error('会话未建立。');
    const state = await api<{ gatewayId: string; epoch: number; authenticated: boolean; chatEnabled: boolean }>('/api/browser-session');
    if (!state.authenticated || closed) throw new Error('连接需恢复。');
    element('verified').textContent = '身份已核验；本机能力保持禁用。';
    element('details').textContent = `Gateway ${state.gatewayId}`;
    model = new RemoteChatModel(api, { read: () => window.desktopShell.readState(), write: value => window.desktopShell.writeState(value) }, render,
      url => new WebSocket(url), location.origin.replace(/^http/, 'ws') + '/api/realtime/v1/ws', state.chatEnabled);
    await model.initialize();
  } catch (error) { showError(error); element('status').textContent = '需恢复连接'; }
}
element('composer').onsubmit = event => { event.preventDefault(); void model?.send().catch(showError); };
element('input').oninput = () => { void model?.draft(element<HTMLTextAreaElement>('input').value).catch(showError); };
element('new').onclick = () => { void model?.select().catch(showError); };
element('verify').onclick = () => { void model?.verifyPending().then(() => model?.refresh()).catch(showError); };
element('older').onclick = () => { void model?.loadOlder().catch(showError); };
element('latest').onclick = () => { void model?.latest().catch(showError); };
element('stop').onclick = () => { void model?.stop().catch(showError); };
element('recover').onclick = async () => {
  try { await model?.flush(); model?.dispose(); await window.desktopShell.recover(); } catch (error) { showError(error); }
};
element('logout').onclick = async () => { model?.dispose(); await fetch('/api/browser-session', { method: 'DELETE' }).catch(() => {}); element('status').textContent = '会话已退出，请返回配置恢复。'; };
window.addEventListener('beforeunload', () => { closed = true; model?.dispose(); });
document.addEventListener('dragover', event => event.preventDefault()); document.addEventListener('drop', event => event.preventDefault());
void start();
