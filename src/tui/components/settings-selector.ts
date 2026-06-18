import {
  Container,
  getCapabilities,
  SelectList,
  type Component,
  type KeybindingsManager,
  type SelectItem,
  type SettingItem,
  SettingsList,
  type SettingsListTheme,
  Spacer,
  Text,
} from '@earendil-works/pi-tui';

import type { DoubleEscapeAction, TuiSettings } from '../tui-settings.js';
import { getTuiKeybindingsPath } from '../tui-keybindings-file.js';
import { getCustomThemesDir, listAvailableThemeIds } from '../theme-manager.js';
import { getThemeExports, theme } from '../theme.js';
import { formatKeyIds } from '../format-tui-hotkeys.js';

export type SettingsSelectorCallbacks = {
  onChange: (settings: TuiSettings) => void;
  onThemePreview?: (themeId: string) => void;
  onReloadKeybindings: () => void;
  onCancel: () => void;
};

export type SettingsSelectorOptions = {
  supportsImages?: boolean;
  keybindings?: KeybindingsManager;
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
    keybindings?: KeybindingsManager,
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
    const confirm = keybindings
      ? formatKeyIds(keybindings, 'tui.select.confirm', { capitalize: true })
      : 'Enter';
    const cancel = keybindings
      ? formatKeyIds(keybindings, 'tui.select.cancel', { capitalize: true })
      : 'Esc';
    this.addChild(new Text(theme.dim(`  ${confirm} select · ${cancel} back`), 0, 0));
  }

  handleInput(data: string): void {
    this.selectList.handleInput(data);
  }
}

/** TUI settings overlay (pi `/settings` subset for Phase 2). */
export class SettingsSelector implements Component {
  private readonly settingsList: SettingsList;
  private readonly state: TuiSettings;

  constructor(
    initial: TuiSettings,
    private readonly callbacks: SettingsSelectorCallbacks,
    options: SettingsSelectorOptions = {},
  ) {
    this.state = { ...initial };
    const themes = listAvailableThemeIds();
    const keybindingsPath = getTuiKeybindingsPath();
    const supportsImages = options.supportsImages ?? getCapabilities().images;

    const imageItems: SettingItem[] = supportsImages
      ? [
          {
            id: 'show-images',
            label: 'Show images',
            description: 'Render image tool results inline when supported',
            currentValue: this.state.showImages ? 'true' : 'false',
            values: ['true', 'false'],
          },
          {
            id: 'image-width',
            label: 'Image width',
            description: 'Inline image width in terminal cells',
            currentValue: String(this.state.imageWidthCells),
            values: ['40', '60', '80', '100', '120'],
          },
        ]
      : [];

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
            options.keybindings,
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
        description: 'Action on Escape twice with empty editor',
        currentValue: this.state.doubleEscapeAction,
        values: ['none', 'tree', 'fork'],
      },
      {
        id: 'follow-up-mode',
        label: 'Follow-up mode',
        description: 'Delivery for queued follow-ups after a response ends',
        currentValue: this.state.followUpMode,
        values: ['one-at-a-time', 'all'],
      },
      {
        id: 'steering-mode',
        label: 'Steering mode',
        description: 'Delivery for queued Enter-while-busy steering messages',
        currentValue: this.state.steeringMode,
        values: ['one-at-a-time', 'all'],
      },
      {
        id: 'tree-filter-mode',
        label: 'Tree filter',
        description: 'Default filter when opening /tree',
        currentValue: this.state.treeFilterMode,
        values: ['default', 'no-tools', 'user-only', 'labeled-only', 'all'],
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
      ...imageItems,
      {
        id: 'hardware-cursor',
        label: 'Hardware cursor',
        description: 'Show terminal cursor for IME candidate positioning',
        currentValue: this.state.showHardwareCursor ? 'true' : 'false',
        values: ['true', 'false'],
      },
      {
        id: 'editor-padding',
        label: 'Editor padding',
        description: 'Horizontal padding for input editor',
        currentValue: String(this.state.editorPaddingX),
        values: ['0', '1', '2', '3'],
      },
      {
        id: 'autocomplete-visible',
        label: 'Autocomplete rows',
        description: 'Visible completion items before the menu scrolls',
        currentValue: String(this.state.autocompleteMaxVisible),
        values: ['3', '5', '7', '10', '15', '20'],
      },
      {
        id: 'clear-on-shrink',
        label: 'Clear on shrink',
        description: 'Clear empty rows when content shrinks',
        currentValue: this.state.clearOnShrink ? 'true' : 'false',
        values: ['true', 'false'],
      },
      {
        id: 'reload-keybindings',
        label: 'Reload keybindings',
        description: `Reload ${keybindingsPath} without restart; /reload and /hotkeys use resolved bindings`,
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
          case 'follow-up-mode':
            this.state.followUpMode = newValue as TuiSettings['followUpMode'];
            break;
          case 'steering-mode':
            this.state.steeringMode = newValue as TuiSettings['steeringMode'];
            break;
          case 'tree-filter-mode':
            this.state.treeFilterMode = newValue as TuiSettings['treeFilterMode'];
            break;
          case 'terminal-progress':
            this.state.showTerminalProgress = newValue === 'true';
            break;
          case 'startup-hints':
            this.state.showStartupHints = newValue === 'true';
            break;
          case 'show-images':
            this.state.showImages = newValue === 'true';
            break;
          case 'image-width':
            this.state.imageWidthCells = Math.max(1, Number.parseInt(newValue, 10) || 60);
            break;
          case 'hardware-cursor':
            this.state.showHardwareCursor = newValue === 'true';
            break;
          case 'editor-padding':
            this.state.editorPaddingX = Math.max(
              0,
              Math.min(3, Number.parseInt(newValue, 10) || 0),
            );
            break;
          case 'autocomplete-visible':
            this.state.autocompleteMaxVisible = Math.max(
              3,
              Math.min(20, Number.parseInt(newValue, 10) || 5),
            );
            break;
          case 'clear-on-shrink':
            this.state.clearOnShrink = newValue === 'true';
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
