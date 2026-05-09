import type { Component, SelectItem, TUI } from '@earendil-works/pi-tui';

import type { TuiBackend } from './tui-backend.js';
import { SearchableSelectList } from './components/searchable-select-list.js';
import { searchableSelectListTheme, theme } from './theme.js';

export type PickerServices = {
  tui: TUI;
  editor: Component;
  openOverlay: (c: Component) => void;
  closeOverlay: () => void;
  chatLog: { addSystem: (t: string) => void };
  client: TuiBackend;
  sendMessage: (text: string) => void;
  refreshSessionInfo: () => Promise<void>;
  updateHeader: () => void;
  state: { currentSessionKey: string };
  setSessionKey: (key: string) => void;
  clearChatForSessionSwitch: () => void;
  /** Load transcript after switching session or on connect. */
  loadSessionHistory: () => Promise<void>;
};

function openSearchableOverlay(svc: PickerServices, list: SearchableSelectList, title: string) {
  list.onCancel = () => {
    svc.closeOverlay();
    svc.tui.setFocus(svc.editor);
    svc.tui.requestRender();
  };
  svc.openOverlay(list);
  svc.chatLog.addSystem(theme.dim(`${title} (↑/↓ ctrl+n ctrl+p · type to filter · Esc)`));
  svc.tui.requestRender();
}

/** Ctrl+L — pick model, sends `/switch provider/id`. */
export async function openModelPickerOverlay(svc: PickerServices): Promise<void> {
  const models = await svc.client.listModels();
  if (models.length === 0) {
    svc.chatLog.addSystem('No models available from gateway.');
    svc.tui.requestRender();
    return;
  }
  const items: SelectItem[] = models.map((m) => ({
    value: `${m.provider}/${m.id}`,
    label: m.name || m.id,
    description: m.provider,
    searchText: `${m.provider} ${m.id} ${m.name ?? ''}`,
  }));
  const list = new SearchableSelectList(items, Math.min(10, items.length), searchableSelectListTheme);
  list.onSelect = (item) => {
    svc.closeOverlay();
    svc.tui.setFocus(svc.editor);
    svc.sendMessage(`/switch ${item.value}`);
    svc.tui.requestRender();
  };
  openSearchableOverlay(svc, list, 'Select model');
}

/** Ctrl+P — switch session key and reload transcript when available. */
export async function openSessionPickerOverlay(svc: PickerServices): Promise<void> {
  const sessions = await svc.client.listSessions();
  if (sessions.length === 0) {
    svc.chatLog.addSystem('No sessions listed.');
    svc.tui.requestRender();
    return;
  }
  const sorted = [...sessions].sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
  const items: SelectItem[] = sorted.slice(0, 80).map((s) => ({
    value: s.key,
    label: s.displayName || s.key,
    description: s.model ? String(s.model) : undefined,
    searchText: `${s.key} ${s.displayName ?? ''} ${s.model ?? ''}`,
  }));
  const list = new SearchableSelectList(items, Math.min(10, items.length), searchableSelectListTheme);
  list.onSelect = (item) => {
    svc.closeOverlay();
    svc.tui.setFocus(svc.editor);
    svc.setSessionKey(item.value);
    svc.clearChatForSessionSwitch();
    svc.chatLog.addSystem(`Session: ${item.value}`);
    void svc
      .refreshSessionInfo()
      .then(() => svc.loadSessionHistory())
      .then(() => {
        svc.updateHeader();
        svc.tui.requestRender();
      });
    svc.tui.requestRender();
  };
  openSearchableOverlay(svc, list, 'Select session');
}
