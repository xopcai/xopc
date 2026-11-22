import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@kit.ArkUI', () => ({ RectShape: class {} }));

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
    expect(normalizeXopcColorScheme('dawn')).toBe('default');
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

  it('uses the approved light palette for the canvas, panels, inputs, and emphasis', () => {
    const palette = new Map(colors.color.map((item) => [item.name, item.value]));
    for (const [token, value] of Object.entries({
      surface: '#E9EDF3', panel: '#FFFFFF', input: '#D8E0EB', foreground: '#142033',
      secondary: '#46566C', tertiary: '#52627A', accent: '#0054C6', active: '#E5F0FF', border: '#CBD4E1',
    })) expect(palette.get(`theme_default_${token}_light`)).toBe(value);
    expect(palette.get('chat_default_bubble_light')).toBe('#C7D5E7');
    expect(palette.get('theme_attention_fill_light')).toBe('#FFF2D2');
  });

  it('applies distinct Chat surfaces and readable foregrounds for all eight appearances', () => {
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
          const { canvas, card, bubble, action, onAction, secondary } = appThemeColors.chat;
          expect(canvas).toBe(appThemeColors.surface);
          expect(bubble).toBe(`app.color.chat_${scheme}_bubble_${mode}`);
          if (scheme === 'default' && !dark) {
            expect(card).toBe(appThemeColors.panel);
            expect(action).toBe(appThemeColors.accent);
          }
          expect(new Set([canvas, card, bubble].map(color)).size).toBe(3);
          for (const surface of [canvas, card, bubble, appThemeColors.assistantBubble]) {
            for (const foreground of [appThemeColors.foreground, secondary, action]) {
              expect(contrast(color(surface), color(foreground)), `${scheme} ${mode} ${surface} ${foreground}`)
                .toBeGreaterThanOrEqual(4.5);
            }
          }
          expect(contrast(color(action), color(onAction))).toBeGreaterThanOrEqual(4.5);
          expect(contrast(color(appThemeColors.accent), color(appThemeColors.onAccent)), `${scheme} ${mode} primary action`)
            .toBeGreaterThanOrEqual(4.5);
          expect(contrast(color(appThemeColors.accent), color(appThemeColors.accentSoft)), `${scheme} ${mode} secondary action`)
            .toBeGreaterThanOrEqual(4.5);
          // These surfaces signal conversational roles and reactions without a stroke.
          expect(contrast(color(appThemeColors.assistantBubble), color(bubble)), `${scheme} ${mode} message roles`)
            .toBeGreaterThanOrEqual(1.15);
          expect(contrast(color(appThemeColors.reactionFill), color(bubble)), `${scheme} ${mode} reaction on user bubble`)
            .toBeGreaterThanOrEqual(1.15);
          expect(contrast(color(appThemeColors.attentionForeground), color(appThemeColors.attentionFill)))
            .toBeGreaterThanOrEqual(4.5);
          for (const surface of [canvas, card, bubble, appThemeColors.panel, appThemeColors.input, appThemeColors.accentSoft, appThemeColors.attentionFill]) {
            expect(contrast(color(appThemeColors.danger), color(surface)), `${scheme} ${mode} error on ${surface}`)
              .toBeGreaterThanOrEqual(4.5);
          }
          const input = color(appThemeColors.input);
          const panel = color(appThemeColors.panel);
          expect(contrast(input, color(canvas)), `${scheme} ${mode} input/canvas`).toBeGreaterThanOrEqual(1.12);
          expect(contrast(input, panel), `${scheme} ${mode} input/panel`).toBeGreaterThanOrEqual(1.12);
          expect(contrast(panel, color(canvas)), `${scheme} ${mode} panel/canvas`).toBeGreaterThanOrEqual(1.08);
          expect(contrast(color(appThemeColors.tertiary), input), `${scheme} ${mode} placeholder`).toBeGreaterThanOrEqual(4.5);
          if (!dark) {
            expect(contrast(color(appThemeColors.success), color(card))).toBeGreaterThanOrEqual(4.5);
          }
        }
      }
    } finally {
      appThemeColors.apply('default', false);
    }
  });

  it('wraps the complete app tree and exposes four live preview selectors', () => {
    expect(indexView).toContain('WithTheme({ theme: this.preferences.customTheme()');
    expect(indexView).toContain('@Local colors: XopcThemeColors = appThemeColors');
    for (const scheme of XOPC_COLOR_SCHEMES) expect(settingsView).toContain(`'scheme-${scheme}'`);
    expect(settingsView).not.toContain("'scheme-dawn'");
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
