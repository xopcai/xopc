import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  Object.assign(globalThis, { $r: (name: string) => name, ObservedV2: (value: unknown) => value, Trace: () => undefined });
});

import { appThemeColors, normalizeXopcColorScheme, XOPC_COLOR_SCHEMES, xopcCustomTheme } from '../entry/src/main/ets/common/themePalette.ets';

const settingsView = readFileSync(new URL('../entry/src/main/ets/view/SettingsView.ets', import.meta.url), 'utf8');
const indexView = readFileSync(new URL('../entry/src/main/ets/pages/Index.ets', import.meta.url), 'utf8');
const settingsService = readFileSync(new URL('../entry/src/main/ets/service/settings.ets', import.meta.url), 'utf8');
const entryAbility = readFileSync(new URL('../entry/src/main/ets/entryability/EntryAbility.ets', import.meta.url), 'utf8');
const colors = JSON.parse(readFileSync(new URL('../entry/src/main/resources/base/element/color.json', import.meta.url), 'utf8')) as {
  color: Array<{ name: string; value: string }>;
};

function luminance(hex: string): number {
  const channels = [1, 3, 5].map((offset) => {
    const value = Number.parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}

function contrast(left: string, right: string): number {
  const a = luminance(left);
  const b = luminance(right);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

describe('Harmony color schemes', () => {
  it('normalizes legacy and invalid preferences to the default scheme', () => {
    expect(normalizeXopcColorScheme(undefined)).toBe('default');
    expect(normalizeXopcColorScheme('invalid')).toBe('default');
    expect(XOPC_COLOR_SCHEMES.map(normalizeXopcColorScheme)).toEqual(XOPC_COLOR_SCHEMES);
  });

  it('provides complete light and dark semantic palettes for every scheme', () => {
    const names = new Set(colors.color.map((item) => item.name));
    const tokens = ['surface', 'panel', 'foreground', 'secondary', 'tertiary', 'accent', 'danger',
      'grouped', 'input', 'border', 'accent_soft', 'active'];
    for (const scheme of XOPC_COLOR_SCHEMES) {
      for (const mode of ['light', 'dark']) {
        for (const token of tokens) expect(names.has(`theme_${scheme}_${token}_${mode}`)).toBe(true);
      }
      const theme = xopcCustomTheme(scheme);
      expect(theme.colors?.fontPrimary).toContain(`theme_${scheme}_foreground_light`);
      expect(theme.darkColors?.backgroundPrimary).toContain(`theme_${scheme}_surface_dark`);
      expect(theme.colors?.interactiveSelect).toContain(`theme_${scheme}_active_light`);
      expect(theme.darkColors?.interactiveActive).toContain(`theme_${scheme}_active_dark`);
    }
  });

  it('keeps default panels and active controls visibly separated from the canvas', () => {
    const palette = new Map(colors.color.map((item) => [item.name, item.value]));
    expect(palette.get('theme_default_surface_light')).toBe('#EEF1F5');
    expect(palette.get('theme_default_panel_light')).toBe('#FFFFFF');
    expect(palette.get('theme_default_active_light')).toBe('#DFE5EC');
  });

  it('applies distinct Chat surfaces and readable foregrounds for all ten appearances', () => {
    const palette = new Map(colors.color.map(({ name, value }) => ['app.color.' + name, value]));
    const color = (resource: unknown): string => {
      const value = palette.get(String(resource));
      if (!value) throw new Error('Unknown color resource ' + resource);
      return value;
    };

    try {
      for (const scheme of XOPC_COLOR_SCHEMES) {
        for (const dark of [false, true]) {
          appThemeColors.apply(scheme, dark);
          const mode = dark ? 'dark' : 'light';
          const { canvas, assistant, card, bubble, composer, action, onAction, secondary } = appThemeColors.chat;
          for (const [role, resource] of Object.entries({ canvas, assistant, card, bubble, composer, action })) {
            expect(resource).toBe(`app.color.chat_${scheme}_${role}_${mode}`);
          }
          expect(new Set([canvas, assistant, card, bubble, composer].map(color)).size).toBe(5);
          if (!dark) {
            expect(color(assistant)).toBe('#FFFFFF');
            expect(contrast(color(assistant), color(bubble))).toBeGreaterThan(1.2);
          }
          for (const surface of [assistant, card, bubble, composer]) {
            expect(contrast(color(canvas), color(surface))).toBeGreaterThan(1.1);
          }
          for (const surface of [canvas, assistant, card, bubble, composer]) {
            for (const foreground of [appThemeColors.foreground, secondary, action]) {
              expect(contrast(color(surface), color(foreground)), `${scheme} ${mode} ${surface} ${foreground}`)
                .toBeGreaterThanOrEqual(4.5);
            }
          }
          expect(contrast(color(action), color(onAction))).toBeGreaterThanOrEqual(4.5);
        }
      }
    } finally {
      appThemeColors.apply('default', false);
    }
  });

  it('wraps the complete app tree and exposes five live preview selectors', () => {
    expect(indexView).toContain('WithTheme({ theme: this.preferences.customTheme()');
    expect(indexView).toContain('@Local colors: XopcThemeColors = appThemeColors');
    for (const scheme of XOPC_COLOR_SCHEMES) expect(settingsView).toContain(`'scheme-${scheme}'`);
    expect(settingsView).toContain('xopcThemePreview(scheme, false)');
    expect(settingsView).toContain('xopcThemePreview(scheme, true)');
  });

  it('keeps preference option labels and selection marks inset from rounded card edges', () => {
    expect(settingsView).toContain("}.width('100%').height(56).padding({ left: 16, right: 16 })");
  });

  it('persists the scheme and restores appearance before the first page is loaded', () => {
    expect(settingsService).toContain('const saved: XopcPreferences = { language, theme, colorScheme: normalizedScheme }');
    expect(settingsService).toContain('this.colorScheme = normalizeXopcColorScheme(saved.colorScheme)');
    expect(entryAbility.indexOf('await appSettings.restore(this.context)'))
      .toBeLessThan(entryAbility.indexOf("stage.loadContent('pages/Index'"));
  });
});
