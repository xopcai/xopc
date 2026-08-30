import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { resolveStateDir } from '../config/paths.js';
import {
  parseNewSessionPreferences,
  type NewSessionPreferences,
} from '@xopcai/gateway-contract';

export type TuiThemeId = 'auto' | 'dark' | 'light' | (string & {});

export type DoubleEscapeAction = 'none' | 'tree' | 'fork';
export type TreeFilterMode = 'default' | 'no-tools' | 'user-only' | 'labeled-only' | 'all';

export interface TuiSettings {
  /** `auto` follows terminal background detection; `dark`/`light` or custom theme name. */
  theme: TuiThemeId;
  showThinking: boolean;
  toolsExpanded: boolean;
  doubleEscapeAction: DoubleEscapeAction;
  showTerminalProgress: boolean;
  /** Show expanded startup hints under the header title. */
  showStartupHints: boolean;
  /** Render image content blocks inline when the terminal supports images. */
  showImages: boolean;
  /** Preferred inline image width in terminal cells. */
  imageWidthCells: number;
  /** Show the terminal hardware cursor at the editor cursor for IME support. */
  showHardwareCursor: boolean;
  /** Horizontal padding for the input editor. */
  editorPaddingX: number;
  /** Maximum visible autocomplete rows before the completion menu scrolls. */
  autocompleteMaxVisible: number;
  /** Clear empty terminal rows when rendered content shrinks. */
  clearOnShrink: boolean;
  /** Default transcript filter when opening `/tree`. */
  treeFilterMode: TreeFilterMode;
  newSessionPreferencesByGateway: Record<string, NewSessionPreferences>;
}

export const DEFAULT_TUI_SETTINGS: TuiSettings = {
  theme: 'auto',
  showThinking: false,
  toolsExpanded: false,
  doubleEscapeAction: 'none',
  showTerminalProgress: false,
  showStartupHints: true,
  showImages: true,
  imageWidthCells: 60,
  showHardwareCursor: false,
  editorPaddingX: 0,
  autocompleteMaxVisible: 5,
  clearOnShrink: false,
  treeFilterMode: 'default',
  newSessionPreferencesByGateway: {},
};

const SETTINGS_PATH = join(resolveStateDir(), 'tui-settings.json');

function isDoubleEscapeAction(value: unknown): value is DoubleEscapeAction {
  return value === 'none' || value === 'tree' || value === 'fork';
}

function isTreeFilterMode(value: unknown): value is TreeFilterMode {
  return (
    value === 'default' ||
    value === 'no-tools' ||
    value === 'user-only' ||
    value === 'labeled-only' ||
    value === 'all'
  );
}

function normalizeSettings(raw: unknown): TuiSettings {
  const base = { ...DEFAULT_TUI_SETTINGS };
  if (!raw || typeof raw !== 'object') return base;
  const obj = raw as Record<string, unknown>;
  if (typeof obj.theme === 'string' && obj.theme.trim()) {
    base.theme = obj.theme.trim();
  }
  if (typeof obj.showThinking === 'boolean') base.showThinking = obj.showThinking;
  if (typeof obj.toolsExpanded === 'boolean') base.toolsExpanded = obj.toolsExpanded;
  if (isDoubleEscapeAction(obj.doubleEscapeAction)) {
    base.doubleEscapeAction = obj.doubleEscapeAction;
  }
  if (typeof obj.showTerminalProgress === 'boolean') {
    base.showTerminalProgress = obj.showTerminalProgress;
  }
  if (typeof obj.showStartupHints === 'boolean') {
    base.showStartupHints = obj.showStartupHints;
  }
  if (typeof obj.showImages === 'boolean') {
    base.showImages = obj.showImages;
  }
  if (typeof obj.imageWidthCells === 'number' && Number.isFinite(obj.imageWidthCells)) {
    base.imageWidthCells = Math.max(1, Math.floor(obj.imageWidthCells));
  }
  if (typeof obj.showHardwareCursor === 'boolean') {
    base.showHardwareCursor = obj.showHardwareCursor;
  }
  if (typeof obj.editorPaddingX === 'number' && Number.isFinite(obj.editorPaddingX)) {
    base.editorPaddingX = Math.max(0, Math.min(3, Math.floor(obj.editorPaddingX)));
  }
  if (typeof obj.autocompleteMaxVisible === 'number' && Number.isFinite(obj.autocompleteMaxVisible)) {
    base.autocompleteMaxVisible = Math.max(3, Math.min(20, Math.floor(obj.autocompleteMaxVisible)));
  }
  if (typeof obj.clearOnShrink === 'boolean') {
    base.clearOnShrink = obj.clearOnShrink;
  }
  if (isTreeFilterMode(obj.treeFilterMode)) {
    base.treeFilterMode = obj.treeFilterMode;
  }
  if (
    obj.newSessionPreferencesByGateway
    && typeof obj.newSessionPreferencesByGateway === 'object'
    && !Array.isArray(obj.newSessionPreferencesByGateway)
  ) {
    base.newSessionPreferencesByGateway = Object.fromEntries(
      Object.entries(obj.newSessionPreferencesByGateway).map(([gatewayId, preferences]) => [
        gatewayId,
        parseNewSessionPreferences(preferences),
      ]),
    );
  }
  return base;
}

/** Load persisted TUI settings from `~/.xopc/tui-settings.json`. */
export function loadTuiSettings(): TuiSettings {
  try {
    if (!existsSync(SETTINGS_PATH)) return { ...DEFAULT_TUI_SETTINGS };
    const raw = readFileSync(SETTINGS_PATH, 'utf8');
    return normalizeSettings(JSON.parse(raw));
  } catch {
    return { ...DEFAULT_TUI_SETTINGS };
  }
}

/** Persist TUI settings. */
export function saveTuiSettings(settings: TuiSettings): void {
  const dir = resolveStateDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(SETTINGS_PATH, `${JSON.stringify(settings, null, 2)}\n`, 'utf8');
}

export function getTuiSettingsPath(): string {
  return SETTINGS_PATH;
}
