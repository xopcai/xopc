import type { Component, SelectItem, TUI } from '@earendil-works/pi-tui';

import { ScopedModelsSelector } from './components/scoped-models-selector.js';
import { SettingsSelector } from './components/settings-selector.js';
import { SearchableSelectList } from './components/searchable-select-list.js';
import { SessionSelector } from './components/session-selector.js';
import type { TuiBackend, TuiModelChoice } from './tui-backend.js';
import { searchableSelectListTheme, theme } from './theme.js';
import type { TuiSettings } from './tui-settings.js';

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
  loadSessionHistory: () => Promise<void>;
  setModelChoices: (models: TuiModelChoice[]) => void;
  getScopedModelRefs: () => string[] | null;
  setScopedModelRefs: (refs: string[] | null) => void;
  refreshCycleModels: () => void;
  getTuiSettings: () => TuiSettings;
  applyTuiSettings: (settings: TuiSettings) => void;
  previewTheme: (themeId: string) => void;
  reloadKeybindings: () => void;
};

function resumeSession(svc: PickerServices, sessionKey: string): void {
  svc.setSessionKey(sessionKey);
  svc.clearChatForSessionSwitch();
  svc.chatLog.addSystem(`Session: ${sessionKey}`);
  void svc
    .refreshSessionInfo()
    .then(() => svc.loadSessionHistory())
    .then(() => {
      svc.updateHeader();
      svc.tui.requestRender();
    });
  svc.tui.requestRender();
}

/** Ctrl+L — pick model, sends `/switch provider/id`. */
export async function openModelPickerOverlay(svc: PickerServices): Promise<void> {
  const models = await svc.client.listModels();
  svc.setModelChoices(models);
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
  list.onCancel = () => {
    svc.closeOverlay();
    svc.tui.setFocus(svc.editor);
    svc.tui.requestRender();
  };
  svc.openOverlay(list);
  svc.chatLog.addSystem(theme.dim('Select model (↑/↓ · type to filter · Esc)'));
  svc.tui.requestRender();
}

/** Ctrl+Shift+P — session picker with rename/delete. */
export async function openSessionPickerOverlay(svc: PickerServices): Promise<void> {
  const sessions = await svc.client.listSessions();
  if (sessions.length === 0) {
    svc.chatLog.addSystem('No sessions listed.');
    svc.tui.requestRender();
    return;
  }

  const selector = new SessionSelector(sessions, {
    onResume: (sessionKey) => {
      svc.closeOverlay();
      svc.tui.setFocus(svc.editor);
      resumeSession(svc, sessionKey);
    },
    onRename: async (sessionKey, name) => {
      const result = await svc.client.renameSession(sessionKey, name);
      return result.ok ? { ok: true } : { ok: false, error: 'Rename failed' };
    },
    onDelete: async (sessionKey) => {
      if (sessionKey === svc.state.currentSessionKey) {
        return { ok: false, error: 'Switch away before deleting the active session' };
      }
      const result = await svc.client.deleteSession(sessionKey);
      return result.ok ? { ok: true } : { ok: false, error: 'Delete failed' };
    },
    onCancel: () => {
      svc.closeOverlay();
      svc.tui.setFocus(svc.editor);
      svc.tui.requestRender();
    },
    requestRender: () => svc.tui.requestRender(),
  });

  svc.openOverlay(selector);
  svc.chatLog.addSystem(theme.dim('Session picker'));
  svc.tui.requestRender();
}

/** `/scoped-models` — limit Ctrl+P model cycle set. */
export async function openScopedModelsOverlay(svc: PickerServices): Promise<void> {
  const catalog = await svc.client.listModels();
  svc.setModelChoices(catalog);
  if (catalog.length === 0) {
    svc.chatLog.addSystem('No models available.');
    svc.tui.requestRender();
    return;
  }

  const selector = new ScopedModelsSelector(catalog, svc.getScopedModelRefs(), {
    onSave: (refs) => {
      svc.setScopedModelRefs(refs);
      svc.refreshCycleModels();
      svc.closeOverlay();
      svc.tui.setFocus(svc.editor);
      const count =
        refs === null ? catalog.length : refs.length;
      svc.chatLog.addSystem(
        theme.dim(
          refs === null
            ? `Ctrl+P cycles all ${catalog.length} models`
            : `Ctrl+P cycles ${count} scoped model${count === 1 ? '' : 's'}`,
        ),
      );
      svc.tui.requestRender();
    },
    onCancel: () => {
      svc.closeOverlay();
      svc.tui.setFocus(svc.editor);
      svc.tui.requestRender();
    },
    requestRender: () => svc.tui.requestRender(),
  });

  svc.openOverlay(selector);
  svc.chatLog.addSystem(theme.dim('Scoped models for Ctrl+P'));
  svc.tui.requestRender();
}

/** `/settings` — TUI preferences overlay. */
export function openSettingsOverlay(svc: PickerServices): void {
  const selector = new SettingsSelector(svc.getTuiSettings(), {
    onChange: (settings) => svc.applyTuiSettings(settings),
    onThemePreview: (themeId) => svc.previewTheme(themeId),
    onReloadKeybindings: () => svc.reloadKeybindings(),
    onCancel: () => {
      svc.previewTheme(svc.getTuiSettings().theme);
      svc.closeOverlay();
      svc.tui.setFocus(svc.editor);
      svc.tui.requestRender();
    },
  });

  svc.openOverlay(selector);
  svc.chatLog.addSystem(theme.dim('Settings (↑/↓ · Enter toggle · Esc close)'));
  svc.tui.requestRender();
}
