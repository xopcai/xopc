import { create } from 'zustand';
import { usePhoneWorkspaceStore } from '@/features/phone/phone-workspace-store';

import type { MessageAttachment } from '@/features/chat/messages/messages.types';
import type { FileReferencePreview } from '@/features/workspace/file-reference-preview';
import { useGatewayStore } from '@/stores/gateway-store';

const STORAGE_KEY = 'xopc:right-workspace:v1';
export const EMPTY_WORKSPACE_SCOPE = 'new';
export type FileTab = {
  id: string;
  kind: 'file';
  preview?: boolean;
  title: string;
  resourceId?: string;
  aliases?: string[];
  path?: string;
  projectId?: string;
  conversationId?: string;
  agentId?: string;
  line?: number | null;
  resultRevision?: number;
  attachment?: MessageAttachment;
  images?: MessageAttachment[];
  reference?: FileReferencePreview;
  resolvedFile?: { id: string; mtimeMs?: number };
  returnTo?: string;
  visitedAt: number;
};
export type BrowserTab = { id: string; kind: 'browser'; title: string; initialUrl?: string; visitedAt: number; returnTo?: string };
export type PhoneTab = { id: string; kind: 'phone'; phoneSessionId: string; title: string; visitedAt: number; returnTo?: string };
export const PERSONAL_TASKS_TAB_ID = 'personal-tasks';
export type WorkspaceTab = PhoneTab | BrowserTab | { id: string; kind: 'home' | 'files' | 'personal-tasks'; title: string; visitedAt: number; returnTo?: string } | FileTab | { id: string; kind: 'sidechat'; sideChatId: string; title: string; visitedAt: number; returnTo?: string };
export type WorkspacePane = { open: boolean; tabs: WorkspaceTab[]; activeId: string | null; personalDetailsOpen?: boolean };
export const EMPTY_WORKSPACE_PANE: WorkspacePane = { open: false, tabs: [], activeId: null };

type Stored = { panes: Record<string, WorkspacePane>; width: number; personalTasksWidth: number; personalPreviewChatWidth: number; treeWidth: number; fileTreeOpen: boolean; sideTreeOpen: boolean };
const defaults: Stored = { panes: {}, width: 0, personalTasksWidth: 0, personalPreviewChatWidth: 0, treeWidth: 240, fileTreeOpen: false, sideTreeOpen: false };
function read(): Stored {
  try {
    const raw = JSON.parse(sessionStorage.getItem(STORAGE_KEY) || 'null');
    if (!raw || raw.version !== 1 || typeof raw.panes !== 'object' || !raw.panes || raw.identity !== useGatewayStore.getState().conversationId || raw.gateway !== useGatewayStore.getState().baseUrl) return defaults;
    const panes: Stored['panes'] = {};
    for (const [scope, value] of Object.entries(raw.panes)) {
      const p = value as WorkspacePane;
      if (!p || !Array.isArray(p.tabs)) continue;
      const tabs = p.tabs.filter((t) => t && typeof t.id === 'string' && typeof t.title === 'string'
        && ((t.kind === 'file' && typeof t.path === 'string') || (t.kind === 'sidechat' && typeof t.sideChatId === 'string') || t.kind === 'home' || t.kind === 'files' || t.kind === 'personal-tasks'));
      panes[scope] = { open: p.open === true && tabs.length > 0, tabs, activeId: tabs.some((t) => t.id === p.activeId) ? p.activeId : tabs[0]?.id ?? null };
    }
    return { ...defaults, panes };
  } catch { return defaults; }
}
function layoutRead(key: string, fallback: number): number {
  try { const n = Number(localStorage.getItem(key)); return n > 0 && Number.isFinite(n) ? n : fallback; } catch { return fallback; }
}
function persist(state: Stored) {
  try {
    const panes = Object.fromEntries(Object.entries(state.panes).map(([key, p]) => [key, {
      ...p, tabs: p.tabs.filter((t) => t.kind !== 'browser' && (t.kind !== 'file' || (!t.attachment && !t.reference))).map((t) => ({ ...t })),
    }]));
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 1, identity: useGatewayStore.getState().conversationId, gateway: useGatewayStore.getState().baseUrl, panes }));
  } catch { /* Storage can be unavailable or full. */ }
}
const localAttachments = new WeakMap<MessageAttachment, string>();
function attachmentKey(attachment?: MessageAttachment): string {
  if (!attachment) return '';
  if (attachment.id || attachment.uri) return attachment.id || attachment.uri!;
  if (!localAttachments.has(attachment)) localAttachments.set(attachment, crypto.randomUUID());
  return localAttachments.get(attachment)!;
}
function normalizePath(path: string) {
  return path.replace(/\\/g, '/').split('/').filter((part) => part !== '.').join('/');
}
export function fileTabKey(file: Omit<FileTab, 'id' | 'kind' | 'title' | 'visitedAt'>): string {
  const root = file.projectId ? `project:${file.projectId}` : file.conversationId ? `session:${file.conversationId}` : `agent:${file.agentId ?? ''}`;
  return JSON.stringify([root, file.path ? normalizePath(file.path) : attachmentKey(file.attachment)]);
}

type State = Stored & {
  notices: Record<string, string>;
  setNotice: (scope: string, message: string) => void;
  fileStatus: Record<string, string>;
  setFileStatus: (id: string, status: string | null) => void;
  keepFileOpen: (id: string) => void;
  scope: string;
  migrateScope: (from: string, to: string) => void;
  openPhone: (phoneSessionId: string, title: string, scope: string, activate?: boolean, showWindow?: boolean) => void;
  openTools: (scope?: string) => string;
  openFiles: (scope?: string) => void;
  openPersonalTasks: (scope: string) => void;
  closePersonalTasks: (scope: string) => void;
  openBrowser: (url?: string, scope?: string, returnTo?: string) => string;
  updateBrowserTitle: (id: string, title: string) => void;
  setScope: (scope: string) => void;
  setOpen: (open: boolean, scope?: string) => void;
  activate: (id: string | null, scope?: string) => void;
  openFile: (file: Omit<FileTab, 'id' | 'kind' | 'title' | 'visitedAt'>, scope?: string) => string;
  finishFileReference: (id: string, scope: string, request: FileReferencePreview, file: Pick<FileTab, 'path' | 'line' | 'projectId' | 'conversationId' | 'agentId' | 'reference' | 'resolvedFile'>) => boolean;
  addSideChat: (sideChatId: string, title: string, scope: string, activate?: boolean) => void;
  resolveFileIdentity: (id: string, resourceId: string) => void;
  replaceSideChat: (oldId: string, id: string, scope: string) => void;
  remove: (id: string, scope?: string) => void;
  setWidth: (width: number) => void;
  setPersonalTasksWidth: (width: number) => void;
  setPersonalPreviewChatWidth: (width: number) => void;
  setTreeWidth: (width: number) => void;
  setTreeOpen: (kind: 'file' | 'sidechat', open: boolean) => void;
  reset: () => void;
};

export const useRightWorkspaceStore = create<State>((set, get) => {
  const commit = (scope: string, update: (pane: WorkspacePane) => WorkspacePane) => {
    set((state) => ({ panes: { ...state.panes, [scope]: update(state.panes[scope] ?? EMPTY_WORKSPACE_PANE) } }));
    persist(get());
  };
  return {
    ...read(), width: layoutRead('xopc:workspace-width', 0), personalTasksWidth: layoutRead('xopc:personal-tasks-width', 0),
    personalPreviewChatWidth: layoutRead('xopc:personal-preview-chat-width', 0),
    treeWidth: layoutRead('xopc:workspace-tree-width', 240),
    notices: {},
    setNotice: (scope, message) => set((s) => ({ notices: { ...s.notices, [scope]: message } })),
    fileStatus: {},
    setFileStatus: (id, status) => {
      if (status) get().keepFileOpen(id);
      set((s) => ({ fileStatus: { ...s.fileStatus, [id]: status ?? '' } }));
    },
    keepFileOpen: (id) => {
      for (const [scope, pane] of Object.entries(get().panes)) {
        if (pane.tabs.some((t) => t.id === id && t.kind === 'file' && t.preview)) {
          commit(scope, (p) => ({ ...p, tabs: p.tabs.map((t) => t.id === id ? { ...t, preview: false } : t) }));
        }
      }
    },
    scope: EMPTY_WORKSPACE_SCOPE,
    setScope: (scope) => set({ scope }),
    migrateScope: (from, to) => {
      const source = get().panes[from];
      if (!source || from === to) return;
      const target = get().panes[to] ?? EMPTY_WORKSPACE_PANE;
      const panes = { ...get().panes, [to]: { open: source.open || target.open, tabs: [...target.tabs, ...source.tabs.filter((t) => !target.tabs.some((other) => other.id === t.id))], activeId: source.activeId ?? target.activeId } };
      delete panes[from];
      set({ panes, scope: get().scope === from ? to : get().scope });
      persist(get());
    },
    openPhone: (phoneSessionId, title, scope, activate = true, showWindow = true) => {
      const id = `phone:${phoneSessionId}`;
      commit(scope, p => ({
        open: activate || p.open,
        activeId: activate ? id : p.activeId,
        tabs: p.tabs.some(t => t.id === id)
          ? p.tabs.map(t => t.id === id ? { ...t, title } : t)
          : [...p.tabs, { id, kind: 'phone', phoneSessionId, title, visitedAt: Date.now() }],
      }));
      if (showWindow) usePhoneWorkspaceStore.getState().show(phoneSessionId, activate, /^[\da-f]{8}-[\da-f-]{27}$/i.test(scope) ? scope : undefined);
    },
    openTools: (scope = get().scope) => {
      const id = crypto.randomUUID();
      commit(scope, (p) => {
        const tabs = [...p.tabs];
        tabs.splice(Math.max(0, tabs.findIndex((t) => t.id === p.activeId) + 1), 0, { id, kind: 'home', title: 'New tab', visitedAt: Date.now() });
        return { open: true, tabs, activeId: id };
      });
      return id;
    },
    openBrowser: (initialUrl, scope = get().scope, returnTo) => {
      const pane = get().panes[scope] ?? EMPTY_WORKSPACE_PANE;
      const home = pane.tabs.find(t => t.id === pane.activeId && t.kind === 'home');
      const id = home?.id ?? crypto.randomUUID();
      const tab: BrowserTab = { id, kind: 'browser', title: 'Browser', initialUrl, visitedAt: Date.now(), returnTo: returnTo ?? pane.activeId ?? undefined };
      commit(scope, p => {
        const tabs = [...p.tabs];
        const at = tabs.findIndex(t => t.id === id);
        if (at >= 0) tabs[at] = tab;
        else tabs.splice(Math.max(0, tabs.findIndex(t => t.id === p.activeId) + 1), 0, tab);
        return { ...p, open: true, activeId: id, tabs,
          ...(p.open && p.activeId === PERSONAL_TASKS_TAB_ID ? { personalDetailsOpen: true } : {}) };
      });
      return id;
    },
    updateBrowserTitle: (id, title) => {
      for (const [scope, pane] of Object.entries(get().panes)) {
        if (pane.tabs.some(t => t.id === id && t.kind === 'browser' && t.title !== title)) commit(scope, p => ({ ...p, tabs: p.tabs.map(t => t.id === id ? { ...t, title: title.slice(0, 200) } : t) }));
      }
    },
    openFiles: (scope = get().scope) => {
      const p = get().panes[scope] ?? EMPTY_WORKSPACE_PANE;
      const existing = p.tabs.find((t) => t.kind === 'files');
      if (existing) { get().activate(existing.id, scope); return; }
      const home = p.tabs.find((t) => t.id === p.activeId && t.kind === 'home');
      const id = home?.id ?? crypto.randomUUID();
      commit(scope, (pane) => ({ open: true, activeId: id,
        tabs: home ? pane.tabs.map((t) => t.id === id ? { ...t, kind: 'files', title: 'Files' } : t)
          : [...pane.tabs, { id, kind: 'files', title: 'Files', visitedAt: Date.now() }],
      }));
    },
    openPersonalTasks: (scope) => commit(scope, (pane) => {
      const active = pane.tabs.find(tab => tab.id === pane.activeId);
      const alongsidePreview = pane.open && (active?.kind === 'file' || active?.kind === 'browser');
      return {
        open: true,
        activeId: alongsidePreview ? pane.activeId : PERSONAL_TASKS_TAB_ID,
        ...(alongsidePreview ? { personalDetailsOpen: true } : {}),
        tabs: pane.tabs.some(tab => tab.id === PERSONAL_TASKS_TAB_ID)
          ? pane.tabs.map(tab => tab.id === PERSONAL_TASKS_TAB_ID ? { ...tab, visitedAt: Date.now() } : tab)
          : [...pane.tabs, { id: PERSONAL_TASKS_TAB_ID, kind: 'personal-tasks', title: 'Tasks', visitedAt: Date.now() }],
      };
    }),
    closePersonalTasks: (scope) => commit(scope, ({ personalDetailsOpen, ...pane }) =>
      pane.activeId === PERSONAL_TASKS_TAB_ID ? { ...pane, open: false } : pane),
    setOpen: (open, scope = get().scope) => {
      if (open && !get().panes[scope]?.tabs.length) { get().openTools(scope); return; }
      commit(scope, ({ personalDetailsOpen, ...p }) => ({ ...p, open, activeId: p.activeId ?? p.tabs[0]?.id ?? null,
        ...(open && personalDetailsOpen ? { personalDetailsOpen } : {}) }));
    },
    activate: (id, scope = get().scope) => {
      const tab = get().panes[scope]?.tabs.find(t => t.id === id);
      if (tab?.kind === 'phone') {
        usePhoneWorkspaceStore.getState().setDisplayMode('docked');
        usePhoneWorkspaceStore.getState().show(tab.phoneSessionId, true, /^[\da-f]{8}-[\da-f-]{27}$/i.test(scope) ? scope : undefined);
      }
      commit(scope, ({ personalDetailsOpen, ...p }) => ({
        ...p, open: Boolean(tab), activeId: tab?.id ?? p.activeId,
        tabs: p.tabs.map((t) => t.id === id ? { ...t, visitedAt: Date.now() } : t),
        ...((tab?.kind === 'file' || tab?.kind === 'browser') && p.open
          && (personalDetailsOpen || p.activeId === PERSONAL_TASKS_TAB_ID) ? { personalDetailsOpen: true } : {}),
      }));
    },
    openFile: (file, scope = get().scope) => {
      const pane = get().panes[scope] ?? EMPTY_WORKSPACE_PANE;
      const existing = pane.tabs.find((t) => t.kind === 'file' && Boolean(t.reference) === Boolean(file.reference)
        && (fileTabKey(t) === fileTabKey(file) || t.aliases?.includes(fileTabKey(file))));
      const preview = !existing && file.preview !== false ? pane.tabs.find((t) => t.kind === 'file' && t.preview && !get().fileStatus[t.id]) : undefined;
      const id = existing?.id ?? crypto.randomUUID();
      const tab: FileTab = { ...(existing?.kind === 'file' ? existing : {}), ...file, preview: existing?.kind === 'file' ? existing.preview === true : file.preview !== false, id, kind: 'file', title: file.path?.replace(/\\/g, '/').split('/').pop() || file.attachment?.name || 'File', visitedAt: Date.now(), returnTo: existing?.returnTo ?? (preview ? preview.returnTo : pane.activeId ?? undefined) };
      commit(scope, (p) => {
        const tabs = [...p.tabs];
        const index = tabs.findIndex((t) => t.id === id);
        if (index >= 0) tabs[index] = tab;
        else if (preview) tabs[tabs.findIndex((t) => t.id === preview.id)] = tab;
        else tabs.splice(Math.max(0, tabs.findIndex((t) => t.id === p.activeId) + 1), 0, tab);
        return { ...p, open: true, tabs, activeId: id,
          ...(p.open && p.activeId === PERSONAL_TASKS_TAB_ID ? { personalDetailsOpen: true } : {}) };
      });
      return id;
    },
    finishFileReference: (id, scope, request, file) => {
      const pane = get().panes[scope];
      const pending = pane?.tabs.find((tab) => tab.id === id);
      if (pending?.kind !== 'file' || pending.reference !== request) return false;
      const duplicate = file.reference ? undefined : pane.tabs.find(tab => tab.kind === 'file' && !tab.reference
        && (fileTabKey(tab) === fileTabKey(file) || tab.aliases?.includes(fileTabKey(file))));
      commit(scope, p => duplicate
        ? { ...p, tabs: p.tabs.filter(tab => tab.id !== id), activeId: p.activeId === id ? duplicate.id : p.activeId }
        : { ...p, tabs: p.tabs.map(tab => tab.id === id ? { ...pending, ...file, reference: file.reference } : tab) });
      return true;
    },
    addSideChat: (sideChatId, title, scope, activate = true) => commit(scope, (p) => {
      const id = `side:${sideChatId}`;
      if (p.tabs.some((t) => t.id === id)) return activate ? { ...p, open: true, activeId: id } : p;
      const homeIndex = activate ? p.tabs.findIndex((t) => t.id === p.activeId && t.kind === 'home') : -1;
      const tabs = [...p.tabs];
      if (homeIndex >= 0) tabs.splice(homeIndex, 1);
      tabs.splice(homeIndex >= 0 ? homeIndex : Math.max(0, tabs.findIndex((t) => t.id === p.activeId) + 1), 0, { id, kind: 'sidechat', sideChatId, title, visitedAt: Date.now() });
      return { tabs, activeId: activate ? id : p.activeId, open: activate || p.open };
    }),
    resolveFileIdentity: (id, resourceId) => {
      for (const [scope, pane] of Object.entries(get().panes)) {
        const tab = pane.tabs.find((t): t is FileTab => t.kind === 'file' && t.id === id);
        if (!tab || tab.resourceId === resourceId) continue;
        const duplicate = pane.tabs.find((t): t is FileTab => t.kind === 'file' && t.id !== id && t.resourceId === resourceId);
        commit(scope, (p) => {
          if (!duplicate || get().fileStatus[id]) return { ...p, tabs: p.tabs.map((t) => t.id === id ? { ...t, resourceId } : t) };
          return { ...p, activeId: p.activeId === id ? duplicate.id : p.activeId,
            tabs: p.tabs.filter((t) => t.id !== id).map((t) => t.id === duplicate.id ? { ...duplicate, preview: duplicate.preview === true && tab.preview === true, aliases: [...new Set([...(duplicate.aliases ?? []), fileTabKey(tab)])], line: tab.line ?? duplicate.line } : t) };
        });
      }
    },
    replaceSideChat: (oldId, id, scope) => commit(scope, (p) => ({ ...p,
      activeId: p.activeId === `side:${oldId}` ? `side:${id}` : p.activeId,
      tabs: p.tabs.map((t) => t.id === `side:${oldId}` ? { ...t, id: `side:${id}`, kind: 'sidechat', sideChatId: id } : t),
    })),
    remove: (id, scope = get().scope) => commit(scope, (p) => {
      const removed = p.tabs.find((t) => t.id === id);
      const tabs = p.tabs.filter((t) => t.id !== id);
      if (p.activeId === id && (removed?.kind === 'file' || removed?.kind === 'browser') && tabs.some(t => t.id === PERSONAL_TASKS_TAB_ID)) {
        const previewTabs = tabs.filter(t => t.id !== PERSONAL_TASKS_TAB_ID);
        const next = previewTabs.find(t => t.id === removed.returnTo) ?? [...previewTabs].sort((a, b) => b.visitedAt - a.visitedAt)[0];
        return { tabs, open: p.open && Boolean(next || p.personalDetailsOpen), activeId: next?.id ?? PERSONAL_TASKS_TAB_ID,
          ...(next && p.personalDetailsOpen ? { personalDetailsOpen: true } : {}) };
      }
      const next = tabs.find((t) => t.id === removed?.returnTo) ?? [...tabs].sort((a, b) => b.visitedAt - a.visitedAt)[0];
      return { ...p, open: p.open && tabs.length > 0, tabs, activeId: p.activeId === id ? next?.id ?? null : p.activeId };
    }),
    setWidth: (width) => { set({ width }); try { localStorage.setItem('xopc:workspace-width', String(width)); } catch { /* Optional preference. */ } },
    setPersonalTasksWidth: (personalTasksWidth) => { set({ personalTasksWidth }); try { localStorage.setItem('xopc:personal-tasks-width', String(personalTasksWidth)); } catch { /* Optional preference. */ } },
    setPersonalPreviewChatWidth: (personalPreviewChatWidth) => { set({ personalPreviewChatWidth }); try { localStorage.setItem('xopc:personal-preview-chat-width', String(personalPreviewChatWidth)); } catch { /* Optional preference. */ } },
    setTreeWidth: (treeWidth) => { set({ treeWidth: Math.max(200, Math.min(320, treeWidth)) }); try { localStorage.setItem('xopc:workspace-tree-width', String(get().treeWidth)); } catch { /* Optional preference. */ } },
    setTreeOpen: (kind, open) => set(kind === 'file' ? { fileTreeOpen: open } : { sideTreeOpen: open }),
    reset: () => { set({ panes: {}, fileStatus: {}, notices: {}, scope: EMPTY_WORKSPACE_SCOPE }); persist(get()); },
  };
});

useGatewayStore.subscribe((state, previous) => {
  if (state.baseUrl !== previous.baseUrl || (previous.conversationId !== undefined && state.conversationId !== previous.conversationId)) useRightWorkspaceStore.getState().reset();
  else if (state.conversationId && !previous.conversationId) useRightWorkspaceStore.setState({ panes: read().panes });
});
