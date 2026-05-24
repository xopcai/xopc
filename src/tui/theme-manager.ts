import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { EditorTheme, MarkdownTheme, SelectListTheme } from '@earendil-works/pi-tui';
import chalk from 'chalk';

import { resolveStateDir } from '../config/paths.js';
import type { SearchableSelectListTheme } from './components/searchable-select-list.js';
import darkThemeJson from './theme/dark.json' with { type: 'json' };
import lightThemeJson from './theme/light.json' with { type: 'json' };

const XTERM_LEVELS = [0, 95, 135, 175, 215, 255] as const;

export type ThemePalette = Record<keyof typeof darkThemeJson.palette, string>;

type ThemeFile = { name: string; palette: ThemePalette };

const BUILTIN_THEMES: Record<string, ThemePalette> = {
  dark: darkThemeJson.palette as ThemePalette,
  light: lightThemeJson.palette as ThemePalette,
};

function channelToSrgb(value: number): number {
  const normalized = value / 255;
  return normalized <= 0.03928
    ? normalized / 12.92
    : ((normalized + 0.055) / 1.055) ** 2.4;
}

function relativeLuminanceRgb(red: number, green: number, blue: number): number {
  return (
    0.2126 * channelToSrgb(red) +
    0.7152 * channelToSrgb(green) +
    0.0722 * channelToSrgb(blue)
  );
}

function relativeLuminanceHex(hex: string): number {
  return relativeLuminanceRgb(
    Number.parseInt(hex.slice(1, 3), 16),
    Number.parseInt(hex.slice(3, 5), 16),
    Number.parseInt(hex.slice(5, 7), 16),
  );
}

function contrastRatio(bgLuminance: number, fgHex: string): number {
  const fgLuminance = relativeLuminanceHex(fgHex);
  const lighter = Math.max(bgLuminance, fgLuminance);
  const darker = Math.min(bgLuminance, fgLuminance);
  return (lighter + 0.05) / (darker + 0.05);
}

function detectLightBackground(env: NodeJS.ProcessEnv = process.env): boolean {
  const explicit = (env.XOPC_THEME ?? '').toLowerCase().trim();
  if (explicit === 'light') return true;
  if (explicit === 'dark') return false;

  const colorfgbg = env.COLORFGBG;
  if (colorfgbg && colorfgbg.length <= 64) {
    const sep = colorfgbg.lastIndexOf(';');
    const bg = Number.parseInt(sep >= 0 ? colorfgbg.slice(sep + 1) : colorfgbg, 10);
    if (bg >= 0 && bg <= 255) {
      if (bg <= 15) return bg === 7 || bg === 15;
      if (bg >= 232) return bg >= 244;
      const cubeIndex = bg - 16;
      const bVal = XTERM_LEVELS[cubeIndex % 6]!;
      const gVal = XTERM_LEVELS[Math.floor(cubeIndex / 6) % 6]!;
      const rVal = XTERM_LEVELS[Math.floor(cubeIndex / 36)]!;
      const bgLum = relativeLuminanceRgb(rVal, gVal, bVal);
      return (
        contrastRatio(bgLum, '#1d1d1f') >= contrastRatio(bgLum, '#f5f5f7')
      );
    }
  }
  return false;
}

function resolveCustomThemesDir(): string {
  return join(resolveStateDir(), 'themes');
}

function loadCustomThemePalette(name: string): ThemePalette | null {
  const path = join(resolveCustomThemesDir(), `${name}.json`);
  if (!existsSync(path)) return null;
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as ThemeFile;
    if (!parsed?.palette || typeof parsed.palette !== 'object') return null;
    return parsed.palette as ThemePalette;
  } catch {
    return null;
  }
}

function fg(hex: string) {
  return (text: string) => chalk.hex(hex)(text);
}

function bg(hex: string) {
  return (text: string) => chalk.bgHex(hex)(text);
}

function highlightCode(code: string, codeHex: string): string[] {
  return code.split('\n').map((line) => fg(codeHex)(line));
}

export type ThemeExports = {
  palette: ThemePalette;
  lightMode: boolean;
  theme: {
    fg: (key: keyof ThemePalette, text: string) => string;
    fgText: (text: string) => string;
    assistantText: (text: string) => string;
    dim: (text: string) => string;
    accent: (text: string) => string;
    accentSoft: (text: string) => string;
    success: (text: string) => string;
    error: (text: string) => string;
    header: (text: string) => string;
    system: (text: string) => string;
    userBg: (text: string) => string;
    userText: (text: string) => string;
    toolTitle: (text: string) => string;
    toolOutput: (text: string) => string;
    toolPendingBg: (text: string) => string;
    toolSuccessBg: (text: string) => string;
    toolErrorBg: (text: string) => string;
    border: (text: string) => string;
    bold: (text: string) => string;
    italic: (text: string) => string;
  };
  markdownTheme: MarkdownTheme;
  selectListTheme: SelectListTheme;
  searchableSelectListTheme: SearchableSelectListTheme;
  editorTheme: EditorTheme;
};

function buildThemeExports(palette: ThemePalette, lightMode: boolean): ThemeExports {
  const theme = {
    fg: (key: keyof ThemePalette, text: string) => fg(palette[key])(text),
    fgText: fg(palette.text),
    assistantText: (text: string) => text,
    dim: fg(palette.dim),
    accent: fg(palette.accent),
    accentSoft: fg(palette.accentSoft),
    success: fg(palette.success),
    error: fg(palette.error),
    header: (text: string) => chalk.bold(fg(palette.accent)(text)),
    system: fg(palette.systemText),
    userBg: bg(palette.userBg),
    userText: fg(palette.userText),
    toolTitle: fg(palette.toolTitle),
    toolOutput: fg(palette.toolOutput),
    toolPendingBg: bg(palette.toolPendingBg),
    toolSuccessBg: bg(palette.toolSuccessBg),
    toolErrorBg: bg(palette.toolErrorBg),
    border: fg(palette.border),
    bold: (text: string) => chalk.bold(text),
    italic: (text: string) => chalk.italic(text),
  };

  const markdownTheme: MarkdownTheme = {
    heading: (text) => chalk.bold(fg(palette.accent)(text)),
    link: (text) => fg(palette.link)(text),
    linkUrl: (text) => chalk.dim(text),
    code: (text) => fg(palette.code)(text),
    codeBlock: (text) => fg(palette.code)(text),
    codeBlockBorder: (text) => fg(palette.codeBorder)(text),
    quote: (text) => fg(palette.quote)(text),
    quoteBorder: (text) => fg(palette.quoteBorder)(text),
    hr: (text) => fg(palette.border)(text),
    listBullet: (text) => fg(palette.accentSoft)(text),
    bold: (text) => chalk.bold(text),
    italic: (text) => chalk.italic(text),
    strikethrough: (text) => chalk.strikethrough(text),
    underline: (text) => chalk.underline(text),
    highlightCode: (code) => highlightCode(code, palette.code),
  };

  const selectListTheme: SelectListTheme = {
    selectedPrefix: (text) => fg(palette.accent)(text),
    selectedText: (text) => chalk.bold(fg(palette.accent)(text)),
    description: (text) => fg(palette.dim)(text),
    scrollInfo: (text) => fg(palette.dim)(text),
    noMatch: (text) => fg(palette.dim)(text),
  };

  const searchableSelectListTheme: SearchableSelectListTheme = {
    ...selectListTheme,
    searchPrompt: (text) => fg(palette.dim)(text),
    searchInput: (text) => fg(palette.text)(text),
    matchHighlight: (text) => fg(palette.accentSoft)(text),
  };

  const editorTheme: EditorTheme = {
    borderColor: (text) => fg(palette.border)(text),
    selectList: selectListTheme,
  };

  return {
    palette,
    lightMode,
    theme,
    markdownTheme,
    selectListTheme,
    searchableSelectListTheme,
    editorTheme,
  };
}

let activeThemeId = 'auto';
let activeExports = buildThemeExports(
  detectLightBackground() ? BUILTIN_THEMES.light! : BUILTIN_THEMES.dark!,
  detectLightBackground(),
);

export function getActiveThemeId(): string {
  return activeThemeId;
}

export function listAvailableThemeIds(): string[] {
  const ids = new Set<string>(['auto', 'dark', 'light']);
  const dir = resolveCustomThemesDir();
  if (existsSync(dir)) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isFile() && entry.name.endsWith('.json')) {
        ids.add(entry.name.replace(/\.json$/, ''));
      }
    }
  }
  return [...ids];
}

export function resolveThemePalette(
  themeId: string,
  env: NodeJS.ProcessEnv = process.env,
): { palette: ThemePalette; lightMode: boolean; resolvedId: string } {
  const normalized = themeId.trim().toLowerCase() || 'auto';
  if (normalized === 'auto') {
    const light = detectLightBackground(env);
    return {
      palette: light ? BUILTIN_THEMES.light! : BUILTIN_THEMES.dark!,
      lightMode: light,
      resolvedId: light ? 'light' : 'dark',
    };
  }
  if (normalized === 'dark' || normalized === 'light') {
    return {
      palette: BUILTIN_THEMES[normalized]!,
      lightMode: normalized === 'light',
      resolvedId: normalized,
    };
  }
  const custom = loadCustomThemePalette(normalized);
  if (custom) {
    return { palette: custom, lightMode: false, resolvedId: normalized };
  }
  const light = detectLightBackground(env);
  return {
    palette: light ? BUILTIN_THEMES.light! : BUILTIN_THEMES.dark!,
    lightMode: light,
    resolvedId: light ? 'light' : 'dark',
  };
}

/** Apply theme by id (`auto`, `dark`, `light`, or custom name). Returns resolved palette id. */
export function applyThemeById(themeId: string, env: NodeJS.ProcessEnv = process.env): string {
  activeThemeId = themeId.trim() || 'auto';
  const resolved = resolveThemePalette(activeThemeId, env);
  activeExports = buildThemeExports(resolved.palette, resolved.lightMode);
  return resolved.resolvedId;
}

export function getThemeExports(): ThemeExports {
  return activeExports;
}

export function getThinkingBorderColor(level: string | undefined): (text: string) => string {
  const palette = activeExports.palette;
  const key = (() => {
    switch ((level ?? 'off').toLowerCase()) {
      case 'minimal':
        return 'thinkingMinimal' as const;
      case 'low':
        return 'thinkingLow' as const;
      case 'medium':
        return 'thinkingMedium' as const;
      case 'high':
        return 'thinkingHigh' as const;
      case 'xhigh':
        return 'thinkingXhigh' as const;
      case 'adaptive':
        return 'thinkingAdaptive' as const;
      default:
        return 'thinkingOff' as const;
    }
  })();
  return fg(palette[key]);
}

export function getBashModeBorderColor(): (text: string) => string {
  return fg(activeExports.palette.bashMode);
}

export function getBashExcludeBorderColor(): (text: string) => string {
  return fg(activeExports.palette.bashExclude);
}

export function getDefaultEditorBorderColor(): (text: string) => string {
  return activeExports.editorTheme.borderColor;
}

export function getCustomThemesDir(): string {
  return resolveCustomThemesDir();
}

/** Initialize theme from CLI flag, env, or settings id. */
export function initTuiTheme(options?: {
  themeId?: string;
  env?: NodeJS.ProcessEnv;
}): string {
  const env = options?.env ?? process.env;
  const fromEnv = env.XOPC_THEME?.trim();
  const themeId = options?.themeId?.trim() || fromEnv || 'auto';
  return applyThemeById(themeId, env);
}
