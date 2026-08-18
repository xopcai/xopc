import { describe, expect, it } from 'vitest';

import { ScopedModelsSelector } from '../components/scoped-models-selector.js';
import { SettingsSelector } from '../components/settings-selector.js';
import { ThinkingSelector } from '../components/thinking-selector.js';
import { XopcKeybindingsManager } from '../tui-keybindings-file.js';
import { DEFAULT_TUI_SETTINGS } from '../tui-settings.js';

describe('SettingsSelector', () => {
  it('shows transcript tree filter mode', () => {
    const selector = new SettingsSelector(DEFAULT_TUI_SETTINGS, {
      onChange: () => {},
      onReloadKeybindings: () => {},
      onCancel: () => {},
    }, { supportsImages: true });

    for (let i = 0; i < 4; i++) {
      selector.handleInput('\x1b[B');
    }
    const rendered = selector.render(160).join('\n');
    expect(rendered).toContain('Tree filter');
    expect(rendered).toContain('Default filter when opening /tree');
  });

  it('shows the keybindings file path and hotkeys command for reload', () => {
    const selector = new SettingsSelector(DEFAULT_TUI_SETTINGS, {
      onChange: () => {},
      onReloadKeybindings: () => {},
      onCancel: () => {},
    }, { supportsImages: true });

    for (let i = 0; i < 13; i++) {
      selector.handleInput('\x1b[B');
    }
    const rendered = selector.render(160).join('\n');
    expect(rendered).toContain('keybindings.json');
    expect(rendered).toContain('/reload');
    expect(rendered).toContain('/hotkeys');
  });

  it('shows autocomplete menu sizing', () => {
    const selector = new SettingsSelector(DEFAULT_TUI_SETTINGS, {
      onChange: () => {},
      onReloadKeybindings: () => {},
      onCancel: () => {},
    }, { supportsImages: true });

    for (let i = 0; i < 11; i++) {
      selector.handleInput('\x1b[B');
    }
    const rendered = selector.render(160).join('\n');
    expect(rendered).toContain('Autocomplete rows');
    expect(rendered).toContain('Visible completion items');
  });

  it('shows pi-style terminal and editor rendering settings', () => {
    const selector = new SettingsSelector(DEFAULT_TUI_SETTINGS, {
      onChange: () => {},
      onReloadKeybindings: () => {},
      onCancel: () => {},
    }, { supportsImages: true });

    for (let i = 0; i < 9; i++) {
      selector.handleInput('\x1b[B');
    }
    let rendered = selector.render(160).join('\n');
    expect(rendered).toContain('Hardware cursor');
    expect(rendered).toContain('Show terminal cursor');

    selector.handleInput('\x1b[B');
    rendered = selector.render(160).join('\n');
    expect(rendered).toContain('Editor padding');
    expect(rendered).toContain('Horizontal padding');

    selector.handleInput('\x1b[B');
    selector.handleInput('\x1b[B');
    rendered = selector.render(160).join('\n');
    expect(rendered).toContain('Clear on shrink');
    expect(rendered).toContain('Clear empty rows');
  });

  it('shows image settings only when the terminal supports inline images', () => {
    const callbacks = {
      onChange: () => {},
      onReloadKeybindings: () => {},
      onCancel: () => {},
    };
    const supported = new SettingsSelector(DEFAULT_TUI_SETTINGS, callbacks, {
      supportsImages: true,
    });
    const unsupported = new SettingsSelector(DEFAULT_TUI_SETTINGS, callbacks, {
      supportsImages: false,
    });

    let supportedText = supported.render(160).join('\n');
    const unsupportedText = unsupported.render(160).join('\n');

    expect(supportedText).toContain('Show images');
    for (let i = 0; i < 8; i++) {
      supported.handleInput('\x1b[B');
    }
    supportedText = supported.render(160).join('\n');
    expect(supportedText).toContain('Image width');
    expect(unsupportedText).not.toContain('Show images');
    expect(unsupportedText).not.toContain('Image width');
  });

  it('uses configured select key hints in the theme submenu footer', () => {
    const selector = new SettingsSelector(DEFAULT_TUI_SETTINGS, {
      onChange: () => {},
      onReloadKeybindings: () => {},
      onCancel: () => {},
    }, {
      supportsImages: true,
      keybindings: new XopcKeybindingsManager({
        'tui.select.confirm': 'x',
        'tui.select.cancel': 'z',
      }),
    });

    selector.handleInput('\r');
    const rendered = selector.render(160).join('\n');

    expect(rendered).toContain('Theme');
    expect(rendered).toContain('X select');
    expect(rendered).toContain('Z back');
  });
});

describe('ThinkingSelector', () => {
  it('renders thinking levels and selects a level', () => {
    let selected: string | undefined;
    const selector = new ThinkingSelector(
      'medium',
      ['off', 'minimal', 'low', 'medium', 'high'],
      {
        onSelect: (level) => {
          selected = level;
        },
        onCancel: () => {},
      },
      new XopcKeybindingsManager({
        'tui.select.confirm': 'x',
        'tui.select.cancel': 'z',
      }),
    );

    const rendered = selector.render(100).join('\n');
    expect(rendered).toContain('Thinking level');
    expect(rendered).toContain('Moderate reasoning');
    expect(rendered).toContain('X select');
    expect(rendered).toContain('Z close');

    selector.handleInput('\r');
    expect(selected).toBe('medium');
  });
});

describe('ScopedModelsSelector', () => {
  const models = [
    { id: 'a', name: 'A', provider: 'p1' },
    { id: 'b', name: 'B', provider: 'p1' },
    { id: 'c', name: 'C', provider: 'p2' },
  ];

  it('saves an empty list after clear', () => {
    let saved: string[] | null | undefined;
    const selector = new ScopedModelsSelector(models, null, {
      onSave: (refs) => {
        saved = refs;
      },
      onCancel: () => {},
      requestRender: () => {},
    });

    selector.handleInput('c');
    selector.handleInput('\r');
    expect(saved).toEqual([]);
  });

  it('toggles the selected provider as a group', () => {
    let saved: string[] | null | undefined;
    const selector = new ScopedModelsSelector(models, null, {
      onSave: (refs) => {
        saved = refs;
      },
      onCancel: () => {},
      requestRender: () => {},
    });

    selector.handleInput('p');
    selector.handleInput('\r');
    expect(saved).toEqual(['p2/c']);
  });

  it('reorders enabled models and preserves the saved order', () => {
    let saved: string[] | null | undefined;
    const selector = new ScopedModelsSelector(models, ['p1/a', 'p2/c'], {
      onSave: (refs) => {
        saved = refs;
      },
      onCancel: () => {},
      requestRender: () => {},
    });

    selector.handleInput(']');
    selector.handleInput('\r');
    expect(saved).toEqual(['p2/c', 'p1/a']);
  });

  it('renders explicitly enabled models before disabled models in saved order', () => {
    const selector = new ScopedModelsSelector(models, ['p2/c', 'p1/a'], {
      onSave: () => {},
      onCancel: () => {},
      requestRender: () => {},
    });

    const rendered = selector.render(80).join('\n');
    expect(rendered.indexOf('C')).toBeLessThan(rendered.indexOf('A'));
    expect(rendered.indexOf('A')).toBeLessThan(rendered.indexOf('B'));
  });

  it('uses configured app model keybindings for actions and hints', () => {
    let saved: string[] | null | undefined;
    const keybindings = new XopcKeybindingsManager({
      'app.model.cycleForward': 'm',
      'app.models.clearAll': 'x',
      'app.models.save': 's',
      'tui.select.confirm': 'enter',
      'tui.select.cancel': 'q',
    });
    const selector = new ScopedModelsSelector(
      models,
      null,
      {
        onSave: (refs) => {
          saved = refs;
        },
        onCancel: () => {},
        requestRender: () => {},
      },
      keybindings,
    );

    expect(selector.render(120).join('\n')).toContain('Scoped models (M cycle)');
    expect(selector.render(120).join('\n')).toContain('X clear');
    expect(selector.render(120).join('\n')).toContain('Enter/S save');
    expect(selector.render(120).join('\n')).toContain('Q cancel');
    selector.handleInput('x');
    selector.handleInput('s');
    expect(saved).toEqual([]);
  });
});
