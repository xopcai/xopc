/**
 * Design tokens — single source of truth for all visual constants.
 *
 * Aligned with xopc DESIGN.md: "Quiet Momentum" — neutral surfaces dominate,
 * indigo is the primary direction/focus signal, semantic colors are status-only.
 *
 * Usage:
 *   import { colors, spacing, radii, typography } from '../theme/tokens';
 *   const bg = colors[isDark ? 'dark' : 'light'].surface.base;
 */

// ── Structural types ────────────────────────────────────────

export type SurfaceColors = {
  /** App background / grouped sections */
  base: string;
  /** Subtle grouped-list base and secondary regions */
  grouped: string;
  /** Cards, panels, elevated content */
  panel: string;
  /** Floating docks, popovers, and other intentionally raised surfaces */
  elevated: string;
  /** Input fields, composer shell */
  input: string;
  /** Hover / pressed state */
  hover: string;
  /** Explicit pressed state for custom pressables */
  pressed: string;
  /** Active / strong selection */
  active: string;
};

export type TextColors = {
  primary: string;
  secondary: string;
  tertiary: string;
  disabled: string;
  inverse: string;
};

export type BorderColors = {
  subtle: string;
  default: string;
  strong: string;
};

export type AccentColors = {
  primary: string;
  primaryHover: string;
  /** Text/icon color displayed on primary accent backgrounds */
  onPrimary: string;
  /** Selection highlight background */
  selectionBg: string;
  /** Soft accent tint for cards / highlights (e.g. Today Brief) */
  soft: string;
};

export type SemanticColors = {
  success: string;
  warning: string;
  error: string;
  errorBold: string;
  info: string;
};

export type OverlayColors = {
  scrim: string;
};

export type ColorScheme = {
  surface: SurfaceColors;
  text: TextColors;
  border: BorderColors;
  accent: AccentColors;
  semantic: SemanticColors;
  overlay: OverlayColors;
};

export type ElevationRecipe = {
  shadowColor: string;
  shadowOpacity: number;
  shadowRadius: number;
  shadowOffset: { width: number; height: number };
  elevation: number;
};

export type ElevationScheme = {
  raised: ElevationRecipe;
  overlay: ElevationRecipe;
};

// ── Surface & Layer ─────────────────────────────────────────

const lightSurface: SurfaceColors = {
  base: '#F7F7F5',
  grouped: '#EFEFED',
  panel: '#FFFFFF',
  elevated: '#FFFFFF',
  input: '#EEF0F4',
  hover: '#ECEDEA',
  pressed: '#E8E9E8',
  active: '#E8EDFF',
};

const darkSurface: SurfaceColors = {
  base: '#101113',
  grouped: '#17181B',
  panel: '#1B1C20',
  elevated: '#24262C',
  input: '#23252B',
  hover: '#2B2D33',
  pressed: '#2B2D33',
  active: '#263250',
};

// ── Text ────────────────────────────────────────────────────

const lightText: TextColors = {
  primary: '#17181C',
  secondary: '#63656E',
  tertiary: '#8E9099',
  disabled: '#B8BEC8',
  inverse: '#FFFFFF',
};

const darkText: TextColors = {
  primary: '#F5F5F7',
  secondary: '#A8AAB4',
  tertiary: '#777982',
  disabled: '#4F5661',
  inverse: '#000000',
};

// ── Border ──────────────────────────────────────────────────

const lightBorder: BorderColors = {
  subtle: '#E7E7E5',
  default: '#DCDDDF',
  strong: '#C9CAD0',
};

const darkBorder: BorderColors = {
  subtle: '#292A2F',
  default: '#36373E',
  strong: '#4A4B53',
};

// ── Accent & Semantic ───────────────────────────────────────

const lightAccent: AccentColors = {
  primary: '#4B63D9',
  primaryHover: '#3D52B8',
  onPrimary: '#FFFFFF',
  selectionBg: 'rgba(75,99,217,0.13)',
  soft: '#EEF1FF',
};

const darkAccent: AccentColors = {
  primary: '#91A4FF',
  primaryHover: '#B5C2FF',
  onPrimary: '#FFFFFF',
  selectionBg: 'rgba(145,164,255,0.20)',
  soft: '#202944',
};

export const semantic = {
  success: { light: '#27845A', dark: '#56C58D' },
  warning: { light: '#B66A15', dark: '#F0AD4E' },
  error: { light: '#C83C45', dark: '#FF7A82' },
  errorBold: { light: '#C83C45', dark: '#FF7A82' },
  info: { light: '#4B63D9', dark: '#91A4FF' },
} as const;

// ── Composed palette per scheme ─────────────────────────────

export const lightColors: ColorScheme = {
  surface: lightSurface,
  text: lightText,
  border: lightBorder,
  accent: lightAccent,
  semantic: {
    success: semantic.success.light,
    warning: semantic.warning.light,
    error: semantic.error.light,
    errorBold: semantic.errorBold.light,
    info: semantic.info.light,
  },
  overlay: {
    scrim: 'rgba(0,0,0,0.28)',
  },
};

export const darkColors: ColorScheme = {
  surface: darkSurface,
  text: darkText,
  border: darkBorder,
  accent: darkAccent,
  semantic: {
    success: semantic.success.dark,
    warning: semantic.warning.dark,
    error: semantic.error.dark,
    errorBold: semantic.errorBold.dark,
    info: semantic.info.dark,
  },
  overlay: {
    scrim: 'rgba(0,0,0,0.52)',
  },
};

export const colors = { light: lightColors, dark: darkColors } as const;

// ── Depth ──────────────────────────────────────────────────

export const elevations: { light: ElevationScheme; dark: ElevationScheme } = {
  light: {
    raised: {
      shadowColor: lightText.primary,
      shadowOpacity: 0.08,
      shadowRadius: 14,
      shadowOffset: { width: 0, height: 5 },
      elevation: 3,
    },
    overlay: {
      shadowColor: lightText.primary,
      shadowOpacity: 0.16,
      shadowRadius: 28,
      shadowOffset: { width: 0, height: 12 },
      elevation: 8,
    },
  },
  dark: {
    raised: {
      shadowColor: '#000000',
      shadowOpacity: 0.12,
      shadowRadius: 10,
      shadowOffset: { width: 0, height: 4 },
      elevation: 2,
    },
    overlay: {
      shadowColor: '#000000',
      shadowOpacity: 0.24,
      shadowRadius: 22,
      shadowOffset: { width: 0, height: 10 },
      elevation: 6,
    },
  },
};

// ── Spacing (8pt grid) ──────────────────────────────────────

export const spacing = {
  /** 2px */
  xxs: 2,
  /** 4px */
  xs: 4,
  /** 8px */
  sm: 8,
  /** 12px */
  md: 12,
  /** 16px */
  lg: 16,
  /** 20px — default editorial/content inset */
  content: 20,
  /** 24px */
  xl: 24,
  /** 28px — intentional section separation */
  section: 28,
  /** 32px */
  xxl: 32,
  /** 48px */
  xxxl: 48,
} as const;

// ── Border Radius ───────────────────────────────────────────

export const radii = {
  /** 6px — tags, small badges */
  sm: 6,
  /** 10px — chips, list items */
  md: 10,
  /** 14px — cards, dialogs */
  lg: 14,
  /** 18px — panels, modals */
  xl: 18,
  /** 22px — composer, buttons */
  xxl: 22,
  /** Full pill */
  full: 9999,
} as const;

// ── Typography ──────────────────────────────────────────────

export const typography = {
  /** 34px — welcome/empty state hero; use sparingly */
  display: { fontSize: 34, lineHeight: 41, fontWeight: '700' as const },
  /** 28px — root screen identity */
  largeTitle: { fontSize: 28, lineHeight: 34, fontWeight: '700' as const },
  /** 22px — page/modal titles */
  title: { fontSize: 22, lineHeight: 28, fontWeight: '700' as const },
  /** 17px — section titles */
  heading: { fontSize: 17, lineHeight: 24, fontWeight: '600' as const },
  /** 16px — body, main UI text */
  body: { fontSize: 16, lineHeight: 23, fontWeight: '400' as const },
  /** 15px — UI controls, buttons */
  ui: { fontSize: 15, lineHeight: 20, fontWeight: '500' as const },
  /** 13px — secondary labels */
  label: { fontSize: 13, lineHeight: 18, fontWeight: '500' as const },
  /** 12px — timestamps, metadata */
  caption: { fontSize: 12, lineHeight: 16, fontWeight: '400' as const },
  /** 11px — exceptional badges only */
  micro: { fontSize: 11, lineHeight: 14, fontWeight: '600' as const },
} as const;
