import {
  Container,
  SelectList,
  type Component,
  type SelectItem,
  type SettingItem,
  SettingsList,
  type SettingsListTheme,
  Spacer,
  Text,
} from '@earendil-works/pi-tui';

import type { DoubleEscapeAction, TuiSettings } from '../tui-settings.js';
import { getCustomThemesDir, listAvailableThemeIds } from '../theme-manager.js';
import { getThemeExports, theme } from '../theme.js';

export type SettingsSelectorCallbacks = {
  onChange: (settings: TuiSettings) => void;
  onThemePreview?: (themeId: string) => void;
  onReloadKeybindings: () => void;
  onCancel: () => void;
};

function getSettingsListTheme(): SettingsListTheme {
  const exports = getThemeExports();
  return {
    label: (text, selected) =>
      selected ? exports.theme.bold(exports.theme.accent(text)) : exports.theme.fgText(text),
    value: (text, selected) =>
      selected ? exports.theme.accentSoft(text) : exports.theme.dim(text),
    description: (text) => exports.theme.dim(text),
    cursor: exports.theme.accent('›'),
    hint: (text) => exports.theme.dim(text),
  };
}

class ThemeSubmenu extends Container {
  private readonly selectList: SelectList;

  constructor(
    themes: string[],
    currentValue: string,
    onSelect: (value: string) => void,
    onPreview: ((value: string) => void) | undefined,
    onCancel: () => void,
  ) {
    super();
    this.addChild(new Text(theme.bold(theme.accent('Theme')), 0, 0));
    this.addChild(new Spacer(1));
    this.addChild(
      new Text(theme.dim(`Custom themes: ${getCustomThemesDir()}/*.json`), 0, 0),
    );
    this.addChild(new Spacer(1));

    const items: SelectItem[] = themes.map((name) => ({ value: name, label: name }));
    this.selectList = new SelectList(
      items,
      Math.min(items.length, 12),
      getThemeExports().selectListTheme,
    );
    const idx = items.findIndex((i) => i.value === currentValue);
    if (idx >= 0) this.selectList.setSelectedIndex(idx);
    this.selectList.onSelect = (item) => onSelect(item.value);
    this.selectList.onCancel = onCancel;
    if (onPreview) {
      this.selectList.onSelectionChange = (item) => onPreview(item.value);
    }
    this.addChild(this.selectList);
    this.addChild(new Spacer(1));
    this.addChild(new Text(theme.dim('  Enter select · Esc back'), 0, 0));
  }

  handleInput(data: string): void {
    this.selectList.handleInput(data);
  }
}

/** TUI settings overlay (pi `/settings` subset for Phase 2). */
export class SettingsSelector implements Component {
  private readonly settingsList: SettingsList;
  private readonly state: TuiSettings;

  constructor(initial: TuiSettings, private readonly callbacks: SettingsSelectorCallbacks) {
    this.state = { ...initial };
    const themes = listAvailableThemeIds();

    const items: SettingItem[] = [
      {
        id: 'theme',
        label: 'Theme',
        description: 'Color theme (`auto` follows terminal background)',
        currentValue: this.state.theme,
        submenu: (currentValue, done) =>
          new ThemeSubmenu(
            themes,
            currentValue,
            (value) => {
              this.state.theme = value;
              this.callbacks.onChange({ ...this.state });
              done(value);
            },
            callbacks.onThemePreview,
            () => {
              callbacks.onThemePreview?.(this.state.theme);
              done();
            },
          ),
      },
      {
        id: 'show-thinking',
        label: 'Show thinking',
        description: 'Display thinking blocks in assistant output',
        currentValue: this.state.showThinking ? 'true' : 'false',
        values: ['true', 'false'],
      },
      {
        id: 'tools-expanded',
        label: 'Expand tools',
        description: 'Default tool output expanded in chat log',
        currentValue: this.state.toolsExpanded ? 'true' : 'false',
        values: ['true', 'false'],
      },
      {
        id: 'double-escape',
        label: 'Double-escape',
        description: 'Action on Escape twice with empty editor (tree/fork coming later)',
        currentValue: this.state.doubleEscapeAction,
        values: ['none', 'tree', 'fork'],
      },
      {
        id: 'terminal-progress',
        label: 'Terminal progress',
        description: 'OSC 9;4 progress indicator while streaming',
        currentValue: this.state.showTerminalProgress ? 'true' : 'false',
        values: ['true', 'false'],
      },
      {
        id: 'startup-hints',
        label: 'Startup hints',
        description: 'Show expanded keyboard hints under the header',
        currentValue: this.state.showStartupHints ? 'true' : 'false',
        values: ['true', 'false'],
      },
      {
        id: 'reload-keybindings',
        label: 'Reload keybindings',
        description: 'Reload ~/.xopc/keybindings.json without restart',
        currentValue: 'reload',
        values: ['reload'],
      },
    ];

    this.settingsList = new SettingsList(
      items,
      Math.min(items.length, 10),
      getSettingsListTheme(),
      (id, newValue) => {
        switch (id) {
          case 'show-thinking':
            this.state.showThinking = newValue === 'true';
            break;
          case 'tools-expanded':
            this.state.toolsExpanded = newValue === 'true';
            break;
          case 'double-escape':
            this.state.doubleEscapeAction = newValue as DoubleEscapeAction;
            break;
          case 'terminal-progress':
            this.state.showTerminalProgress = newValue === 'true';
            break;
          case 'startup-hints':
            this.state.showStartupHints = newValue === 'true';
            break;
          case 'reload-keybindings':
            callbacks.onReloadKeybindings();
            return;
          default:
            break;
        }
        callbacks.onChange({ ...this.state });
      },
      () => callbacks.onCancel(),
    );
  }

  handleInput(data: string): void {
    this.settingsList.handleInput(data);
  }

  invalidate(): void {
    this.settingsList.invalidate();
  }

  render(width: number): string[] {
    return this.settingsList.render(width);
  }
}
