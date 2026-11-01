type Snapshot = { id: string; text: string; state: string; resource: { name: string; revision: string } };
type FileAction = (action: string, input?: unknown) => Promise<{ ok: boolean; value?: unknown; error?: string }>;
const statuses: Record<string, string> = { clean: '缓存副本已同步', dirty: '本机草稿已保存，尚未回传', conflict: '服务器版本已变化。草稿已保留，请重新下载服务器副本核对。', unknown: '上次回传结果未知，禁止重发。请重新下载服务器副本核实。' };

/** This editor handles encrypted remote snapshots only; it never accepts a local path or executes downloaded content. */
export function installRemoteFiles(action: FileAction, conversation: () => string | undefined) {
  const get = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
  const dialog = get<HTMLDialogElement>('remote-files'), editor = get<HTMLTextAreaElement>('remote-file-text');
  let snapshot: Snapshot | undefined, unsaved = false, busy = false;
  let listedConversation: string | undefined;
  const directories: Array<{ id: string; name: string }> = [];
  const notice = (text: string) => { get('remote-file-status').textContent = text; };
  const request = async <T>(name: string, value?: unknown): Promise<T> => {
    const response = await action(name, value);
    if (!response.ok) throw new Error(response.error ?? 'REMOTE_FILE_REQUEST_FAILED');
    return response.value as T;
  };
  const controls = () => {
    get<HTMLButtonElement>('remote-file-upload').disabled = busy || unsaved || snapshot?.state !== 'dirty';
    get<HTMLButtonElement>('remote-file-save').disabled = busy || !unsaved;
    get<HTMLButtonElement>('remote-file-archive').disabled = busy || unsaved || snapshot?.state !== 'clean';
    editor.disabled = busy || !snapshot || ['unknown', 'uploading'].includes(snapshot.state);
  };
  const save = async () => {
    if (!snapshot || !unsaved) return;
    snapshot = await request<Snapshot>('edit', { id: snapshot.id, text: editor.value }); unsaved = false;
    notice(statuses[snapshot.state] ?? snapshot.state);
  };
  const run = async (work: () => Promise<void>) => {
    if (busy) return;
    busy = true; controls(); get('remote-file-loading').hidden = false;
    try { await work(); }
    catch (error) {
      const code = error instanceof Error ? error.message : '';
      notice(code.includes('OUTCOME_UNKNOWN') ? statuses.unknown : code === 'REMOTE_FILE_USER_DENIED' ? '已取消回传；本机草稿保留。' : `文件操作未完成：${code}。草稿不会自动回传。`);
      if (code.includes('OUTCOME_UNKNOWN') && snapshot) snapshot.state = 'unknown';
    } finally { busy = false; controls(); get('remote-file-loading').hidden = true; }
  };
  const open = async (name: 'get' | 'download', id: string) => run(async () => {
    await save(); snapshot = await request<Snapshot>(name, id); unsaved = false;
    editor.value = snapshot.text; get('remote-file-name').textContent = snapshot.resource.name;
    get('remote-file-version').textContent = `服务器版本：${snapshot.resource.revision.slice(0, 160)}`;
    notice(statuses[snapshot.state] ?? snapshot.state); editor.focus();
  });
  const list = async () => {
    const cached = await request<Array<{ id: string; name: string; state: string }>>('list');
    get('remote-file-drafts').replaceChildren(...cached.map(item => {
      const button = document.createElement('button'); button.type = 'button'; button.textContent = `${item.name} · ${statuses[item.state] ?? item.state}`;
      button.onclick = () => { void open('get', item.id); }; return button;
    }));
    const archived = await request<Array<{ id: string; name: string }>>('archived');
    get('remote-file-archives').replaceChildren(...archived.map(item => {
      const button = document.createElement('button'); button.type = 'button'; button.textContent = `恢复：${item.name}`;
      button.onclick = () => { void run(async () => { await request('restore', item.id); await list(); notice('已恢复本机缓存副本。'); }); }; return button;
    }));
    const id = conversation();
    if (id !== listedConversation) { listedConversation = id; directories.splice(0); }
    if (!id) { get('remote-file-server').textContent = '先选择服务器会话，再查看该会话工作区的文本文件。'; return; }
    get('remote-file-path').textContent = ['工作区', ...directories.map(item => item.name)].join(' / ');
    get<HTMLButtonElement>('remote-file-up').disabled = !directories.length;
    const files = await request<Array<{ id: string; name: string; size: number; kind: 'file' | 'directory' }>>('browse', { conversationId: id, directoryId: directories.at(-1)?.id });
    get('remote-file-server').replaceChildren(...files.map(item => {
      const button = document.createElement('button'); button.type = 'button'; button.textContent = item.kind === 'directory' ? `${item.name} /` : `${item.name} · ${item.size}字节`;
      button.onclick = item.kind === 'directory' ? () => { void run(async () => { await save(); directories.push({ id: item.id, name: item.name }); await list(); }); }
        : () => { void open('download', item.id); }; return button;
    }));
    if (!files.length) get('remote-file-server').textContent = '当前目录没有可编辑的32 KiB以内文本文件。';
  };
  get('remote-files-open').onclick = () => { dialog.showModal(); void run(list); };
  get('remote-file-refresh').onclick = () => { void run(list); };
  get('remote-file-up').onclick = () => { void run(async () => { await save(); directories.pop(); await list(); }); };
  get('remote-file-save').onclick = () => { void run(save); };
  get('remote-file-archive').onclick = () => { void run(async () => {
    if (!snapshot || unsaved) return;
    await request('archive', snapshot.id); snapshot = undefined; editor.value = ''; unsaved = false;
    get('remote-file-name').textContent = '选择一份文本副本'; get('remote-file-version').textContent = '';
    await list(); notice('已移至可恢复的本机归档，服务器文件不变。');
  }); };
  get('remote-file-upload').onclick = () => { void run(async () => {
    if (!snapshot || unsaved) return;
    snapshot = await request<Snapshot>('upload', snapshot.id); notice(statuses[snapshot.state] ?? snapshot.state);
  }); };
  editor.oninput = () => { unsaved = true; notice('编辑尚未保存到本机缓存。先保存草稿，再显式回传。'); controls(); };
  const close = () => { void run(async () => { await save(); dialog.close(); }); };
  get('remote-files-close').onclick = close;
  dialog.addEventListener('cancel', event => { event.preventDefault(); if (!busy) close(); });
  controls();
}
