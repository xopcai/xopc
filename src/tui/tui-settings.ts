import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { resolveStateDir } from '../config/paths.js';

export type TuiThemeId = 'auto' | 'dark' | 'light' | (string & {});

export type DoubleEscapeAction = 'none' | 'tree' | 'fork';

export interface TuiSettings {
  /** `auto` follows terminal background detection; `dark`/`light` or custom theme name. */
  theme: TuiThemeId;
  showThinking: boolean;
  toolsExpanded: boolean;
  doubleEscapeAction: DoubleEscapeAction;
  showTerminalProgress: boolean;
  /** Show expanded startup hints under the header title. */
  showStartupHints: boolean;
}

export const DEFAULT_TUI_SETTINGS: TuiSettings = {
  theme: 'auto',
  showThinking: false,
  toolsExpanded: false,
  doubleEscapeAction: 'none',
  showTerminalProgress: false,
  showStartupHints: true,
};

const SETTINGS_PATH = join(resolveStateDir(), 'tui-settings.json');

function isDoubleEscapeAction(value: unknown): value is DoubleEscapeAction {
  return value === 'none' || value === 'tree' || value === 'fork';
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
