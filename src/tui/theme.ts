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
        contrastRatio(bgLum, '#1E1E1E') >= contrastRatio(bgLum, '#E8E3D5')
      );
    }
  }
  return false;
}

export const lightMode = isLightBackground();

const darkPalette = {
  text: '#E8E3D5',
  dim: '#7B7F87',
  accent: '#60A5FA',      // blue accent (matching xopc design system)
  accentSoft: '#93C5FD',
  border: '#3C414B',
  userBg: '#2B2F36',
  userText: '#F3EEE0',
  systemText: '#9BA3B2',
  toolPendingBg: '#1F2A2F',
  toolSuccessBg: '#1E2D23',
  toolErrorBg: '#2F1F1F',
  toolTitle: '#60A5FA',
  toolOutput: '#E1DACB',
  quote: '#8CC8FF',
  quoteBorder: '#3B4D6B',
  code: '#F0C987',
  codeBlock: '#1E232A',
  codeBorder: '#343A45',
  link: '#7DD3A5',
  error: '#F97066',
  success: '#7DD3A5',
} as const;

const lightPalette = {
  text: '#1E1E1E',
  dim: '#5B6472',
  accent: '#2563EB',
  accentSoft: '#3B82F6',
  border: '#5B6472',
  userBg: '#F3F0E8',
  userText: '#1E1E1E',
  systemText: '#4B5563',
  toolPendingBg: '#EFF6FF',
  toolSuccessBg: '#ECFDF5',
  toolErrorBg: '#FEF2F2',
  toolTitle: '#2563EB',
  toolOutput: '#374151',
  quote: '#1D4ED8',
  quoteBorder: '#2563EB',
  code: '#92400E',
  codeBlock: '#F9FAFB',
  codeBorder: '#92400E',
  link: '#047857',
  error: '#DC2626',
  success: '#047857',
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
