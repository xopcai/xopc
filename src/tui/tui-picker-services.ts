import type { Component, KeybindingsManager, TUI } from '@earendil-works/pi-tui';

import type {
  TuiBackend,
  TuiBranchSummary,
  TuiModelChoice,
} from './tui-backend.js';
import type { TuiSettings } from './tui-settings.js';
import type { TuiState } from './tui-types.js';
import type { ThinkLevel } from '../agent/transcript/thinking-types.js';
import type { ProjectTrustStore } from '../project-trust/trust-store.js';

export type PickerServices = {
  tui: TUI;
  editor: Component;
  openOverlay: (c: Component) => void;
  closeOverlay: () => void;
  chatLog: {
    addSystem: (t: string) => void;
    addBranchSummary: (summary: TuiBranchSummary) => void;
  };
  client: TuiBackend;
  sendMessage: (text: string) => void;
  switchModel: (modelRef: string) => void | Promise<void>;
  openEditorSelector: (component: Component, focus?: Component) => () => void;
  refreshSessionInfo: () => Promise<void>;
  updateHeader: () => void;
  state: Pick<TuiState, 'currentSessionKey' | 'sessionInfo'>;
  setSessionKey: (key: string) => void;
  clearChatForSessionSwitch: () => void;
  loadSessionHistory: () => Promise<void>;
  setEditorText: (text: string) => void;
  setModelChoices: (models: TuiModelChoice[]) => void;
  getScopedModelRefs: () => string[] | null;
  setScopedModelRefs: (refs: string[] | null) => void;
  refreshCycleModels: () => void;
  getTuiSettings: () => TuiSettings;
  applyTuiSettings: (settings: TuiSettings) => void;
  previewTheme: (themeId: string) => void;
  reloadKeybindings: () => void;
  setThinkingLevel: (level: ThinkLevel) => Promise<void>;
  getProjectTrustStore: () => ProjectTrustStore;
  getProjectTrustSessionDecision: () => boolean | null;
  setProjectTrustSessionDecision: (decision: boolean | null) => void;
  keybindings: KeybindingsManager;
};
