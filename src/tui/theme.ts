import type { EditorTheme, MarkdownTheme, SelectListTheme } from '@mariozechner/pi-tui';
import chalk from 'chalk';

const XTERM_LEVELS = [0, 95, 135, 175, 215, 255] as const;

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

function isLightBackground(): boolean {
  const explicit = (process.env.XOPC_THEME ?? '').toLowerCase().trim();
  if (explicit === 'light') return true;
  if (explicit === 'dark') return false;

  const colorfgbg = process.env.COLORFGBG;
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

export const lightMode = isLightBackground();

// Palette tokens align with DESIGN.md (§2 surface/text/border, §2.5 accent, §12.1).
const darkPalette = {
  text: '#f5f5f7',
  dim: '#a1a1a6',
  accent: '#3b82f6',
  accentSoft: '#60a5fa',
  border: '#48484a',
  userBg: '#3a3a3c',
  userText: '#f5f5f7',
  systemText: '#8e8e93',
  toolPendingBg: '#2c2c2e',
  toolSuccessBg: '#1e2a22',
  toolErrorBg: '#2a2222',
  toolTitle: '#3b82f6',
  toolOutput: '#d1d1d6',
  quote: '#60a5fa',
  quoteBorder: '#48484a',
  code: '#d1d1d6',
  codeBlock: '#1c1c1e',
  codeBorder: '#48484a',
  link: '#60a5fa',
  error: '#f87171',
  success: '#34d399',
} as const;

const lightPalette = {
  text: '#1d1d1f',
  dim: '#6e6e73',
  accent: '#2563eb',
  accentSoft: '#3b82f6',
  border: '#d2d2d7',
  userBg: '#ffffff',
  userText: '#1d1d1f',
  systemText: '#86868b',
  toolPendingBg: '#f0f5ff',
  toolSuccessBg: '#ecfdf5',
  toolErrorBg: '#fef2f2',
  toolTitle: '#2563eb',
  toolOutput: '#6e6e73',
  quote: '#2563eb',
  quoteBorder: '#d2d2d7',
  code: '#92400e',
  codeBlock: '#ffffff',
  codeBorder: '#d2d2d7',
  link: '#2563eb',
  error: '#dc2626',
  success: '#059669',
} as const;

export const palette = lightMode ? lightPalette : darkPalette;

const fg = (hex: string) => (text: string) => chalk.hex(hex)(text);
const bg = (hex: string) => (text: string) => chalk.bgHex(hex)(text);

function highlightCode(code: string): string[] {
  return code.split('\n').map((line) => fg(palette.code)(line));
}

export const theme = {
  fg: fg(palette.text),
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

export const markdownTheme: MarkdownTheme = {
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
  highlightCode,
};

export const selectListTheme: SelectListTheme = {
  selectedPrefix: (text) => fg(palette.accent)(text),
  selectedText: (text) => chalk.bold(fg(palette.accent)(text)),
  description: (text) => fg(palette.dim)(text),
  scrollInfo: (text) => fg(palette.dim)(text),
  noMatch: (text) => fg(palette.dim)(text),
};

export const editorTheme: EditorTheme = {
  borderColor: (text) => fg(palette.border)(text),
  selectList: selectListTheme,
};
