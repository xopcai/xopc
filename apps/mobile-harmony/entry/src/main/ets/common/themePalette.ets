import { CustomColors, CustomTheme } from '@kit.ArkUI';

export type XopcColorScheme = 'default' | 'porcelain' | 'dawn' | 'emerald' | 'clay';

export const XOPC_COLOR_SCHEMES: XopcColorScheme[] = ['default', 'porcelain', 'dawn', 'emerald', 'clay'];

class XopcThemeTokens {
  surface: Resource;
  panel: Resource;
  foreground: Resource;
  secondary: Resource;
  tertiary: Resource;
  accent: Resource;
  danger: Resource;
  grouped: Resource;
  input: Resource;
  border: Resource;
  accentSoft: Resource;
  active: Resource;

  constructor(surface: Resource, panel: Resource, foreground: Resource,
    secondary: Resource, tertiary: Resource, accent: Resource, danger: Resource,
    grouped: Resource, input: Resource, border: Resource, accentSoft: Resource, active: Resource) {
    this.surface = surface;
    this.panel = panel;
    this.foreground = foreground;
    this.secondary = secondary;
    this.tertiary = tertiary;
    this.accent = accent;
    this.danger = danger;
    this.grouped = grouped;
    this.input = input;
    this.border = border;
    this.accentSoft = accentSoft;
    this.active = active;
  }
}

@ObservedV2
export class XopcThemeColors {
  @Trace surface: Resource;
  @Trace panel: Resource;
  @Trace foreground: Resource;
  @Trace secondary: Resource;
  @Trace tertiary: Resource;
  @Trace accent: Resource;
  @Trace danger: Resource;
  @Trace grouped: Resource;
  @Trace input: Resource;
  @Trace border: Resource;
  @Trace accentSoft: Resource;
  @Trace active: Resource;

  constructor(tokens: XopcThemeTokens) {
    this.surface = tokens.surface;
    this.panel = tokens.panel;
    this.foreground = tokens.foreground;
    this.secondary = tokens.secondary;
    this.tertiary = tokens.tertiary;
    this.accent = tokens.accent;
    this.danger = tokens.danger;
    this.grouped = tokens.grouped;
    this.input = tokens.input;
    this.border = tokens.border;
    this.accentSoft = tokens.accentSoft;
    this.active = tokens.active;
  }

  apply(scheme: XopcColorScheme, dark: boolean): void {
    const tokens = xopcThemeTokens(scheme, dark);
    this.surface = tokens.surface;
    this.panel = tokens.panel;
    this.foreground = tokens.foreground;
    this.secondary = tokens.secondary;
    this.tertiary = tokens.tertiary;
    this.accent = tokens.accent;
    this.danger = tokens.danger;
    this.grouped = tokens.grouped;
    this.input = tokens.input;
    this.border = tokens.border;
    this.accentSoft = tokens.accentSoft;
    this.active = tokens.active;
  }
}

export class XopcThemePreview {
  canvas: Resource;
  panel: Resource;
  accent: Resource;
  foreground: Resource;
  muted: Resource;

  constructor(canvas: Resource, panel: Resource, accent: Resource,
    foreground: Resource, muted: Resource) {
    this.canvas = canvas;
    this.panel = panel;
    this.accent = accent;
    this.foreground = foreground;
    this.muted = muted;
  }
}

export function normalizeXopcColorScheme(value: string | undefined): XopcColorScheme {
  return XOPC_COLOR_SCHEMES.includes(value as XopcColorScheme) ? value as XopcColorScheme : 'default';
}

function xopcThemeTokens(scheme: XopcColorScheme, dark: boolean): XopcThemeTokens {
  if (scheme === 'default' && !dark) return new XopcThemeTokens(
    $r('app.color.theme_default_surface_light'),
    $r('app.color.theme_default_panel_light'),
    $r('app.color.theme_default_foreground_light'),
    $r('app.color.theme_default_secondary_light'),
    $r('app.color.theme_default_tertiary_light'),
    $r('app.color.theme_default_accent_light'),
    $r('app.color.theme_default_danger_light'),
    $r('app.color.theme_default_grouped_light'),
    $r('app.color.theme_default_input_light'),
    $r('app.color.theme_default_border_light'),
    $r('app.color.theme_default_accent_soft_light'),
    $r('app.color.theme_default_active_light')
  );
  if (scheme === 'default' && dark === true) return new XopcThemeTokens(
    $r('app.color.theme_default_surface_dark'),
    $r('app.color.theme_default_panel_dark'),
    $r('app.color.theme_default_foreground_dark'),
    $r('app.color.theme_default_secondary_dark'),
    $r('app.color.theme_default_tertiary_dark'),
    $r('app.color.theme_default_accent_dark'),
    $r('app.color.theme_default_danger_dark'),
    $r('app.color.theme_default_grouped_dark'),
    $r('app.color.theme_default_input_dark'),
    $r('app.color.theme_default_border_dark'),
    $r('app.color.theme_default_accent_soft_dark'),
    $r('app.color.theme_default_active_dark')
  );
  if (scheme === 'porcelain' && dark === false) return new XopcThemeTokens(
    $r('app.color.theme_porcelain_surface_light'),
    $r('app.color.theme_porcelain_panel_light'),
    $r('app.color.theme_porcelain_foreground_light'),
    $r('app.color.theme_porcelain_secondary_light'),
    $r('app.color.theme_porcelain_tertiary_light'),
    $r('app.color.theme_porcelain_accent_light'),
    $r('app.color.theme_porcelain_danger_light'),
    $r('app.color.theme_porcelain_grouped_light'),
    $r('app.color.theme_porcelain_input_light'),
    $r('app.color.theme_porcelain_border_light'),
    $r('app.color.theme_porcelain_accent_soft_light'),
    $r('app.color.theme_porcelain_active_light')
  );
  if (scheme === 'porcelain' && dark === true) return new XopcThemeTokens(
    $r('app.color.theme_porcelain_surface_dark'),
    $r('app.color.theme_porcelain_panel_dark'),
    $r('app.color.theme_porcelain_foreground_dark'),
    $r('app.color.theme_porcelain_secondary_dark'),
    $r('app.color.theme_porcelain_tertiary_dark'),
    $r('app.color.theme_porcelain_accent_dark'),
    $r('app.color.theme_porcelain_danger_dark'),
    $r('app.color.theme_porcelain_grouped_dark'),
    $r('app.color.theme_porcelain_input_dark'),
    $r('app.color.theme_porcelain_border_dark'),
    $r('app.color.theme_porcelain_accent_soft_dark'),
    $r('app.color.theme_porcelain_active_dark')
  );
  if (scheme === 'dawn' && dark === false) return new XopcThemeTokens(
    $r('app.color.theme_dawn_surface_light'),
    $r('app.color.theme_dawn_panel_light'),
    $r('app.color.theme_dawn_foreground_light'),
    $r('app.color.theme_dawn_secondary_light'),
    $r('app.color.theme_dawn_tertiary_light'),
    $r('app.color.theme_dawn_accent_light'),
    $r('app.color.theme_dawn_danger_light'),
    $r('app.color.theme_dawn_grouped_light'),
    $r('app.color.theme_dawn_input_light'),
    $r('app.color.theme_dawn_border_light'),
    $r('app.color.theme_dawn_accent_soft_light'),
    $r('app.color.theme_dawn_active_light')
  );
  if (scheme === 'dawn' && dark === true) return new XopcThemeTokens(
    $r('app.color.theme_dawn_surface_dark'),
    $r('app.color.theme_dawn_panel_dark'),
    $r('app.color.theme_dawn_foreground_dark'),
    $r('app.color.theme_dawn_secondary_dark'),
    $r('app.color.theme_dawn_tertiary_dark'),
    $r('app.color.theme_dawn_accent_dark'),
    $r('app.color.theme_dawn_danger_dark'),
    $r('app.color.theme_dawn_grouped_dark'),
    $r('app.color.theme_dawn_input_dark'),
    $r('app.color.theme_dawn_border_dark'),
    $r('app.color.theme_dawn_accent_soft_dark'),
    $r('app.color.theme_dawn_active_dark')
  );
  if (scheme === 'emerald' && dark === false) return new XopcThemeTokens(
    $r('app.color.theme_emerald_surface_light'),
    $r('app.color.theme_emerald_panel_light'),
    $r('app.color.theme_emerald_foreground_light'),
    $r('app.color.theme_emerald_secondary_light'),
    $r('app.color.theme_emerald_tertiary_light'),
    $r('app.color.theme_emerald_accent_light'),
    $r('app.color.theme_emerald_danger_light'),
    $r('app.color.theme_emerald_grouped_light'),
    $r('app.color.theme_emerald_input_light'),
    $r('app.color.theme_emerald_border_light'),
    $r('app.color.theme_emerald_accent_soft_light'),
    $r('app.color.theme_emerald_active_light')
  );
  if (scheme === 'emerald' && dark === true) return new XopcThemeTokens(
    $r('app.color.theme_emerald_surface_dark'),
    $r('app.color.theme_emerald_panel_dark'),
    $r('app.color.theme_emerald_foreground_dark'),
    $r('app.color.theme_emerald_secondary_dark'),
    $r('app.color.theme_emerald_tertiary_dark'),
    $r('app.color.theme_emerald_accent_dark'),
    $r('app.color.theme_emerald_danger_dark'),
    $r('app.color.theme_emerald_grouped_dark'),
    $r('app.color.theme_emerald_input_dark'),
    $r('app.color.theme_emerald_border_dark'),
    $r('app.color.theme_emerald_accent_soft_dark'),
    $r('app.color.theme_emerald_active_dark')
  );
  if (scheme === 'clay' && dark === false) return new XopcThemeTokens(
    $r('app.color.theme_clay_surface_light'),
    $r('app.color.theme_clay_panel_light'),
    $r('app.color.theme_clay_foreground_light'),
    $r('app.color.theme_clay_secondary_light'),
    $r('app.color.theme_clay_tertiary_light'),
    $r('app.color.theme_clay_accent_light'),
    $r('app.color.theme_clay_danger_light'),
    $r('app.color.theme_clay_grouped_light'),
    $r('app.color.theme_clay_input_light'),
    $r('app.color.theme_clay_border_light'),
    $r('app.color.theme_clay_accent_soft_light'),
    $r('app.color.theme_clay_active_light')
  );
  if (scheme === 'clay' && dark === true) return new XopcThemeTokens(
    $r('app.color.theme_clay_surface_dark'),
    $r('app.color.theme_clay_panel_dark'),
    $r('app.color.theme_clay_foreground_dark'),
    $r('app.color.theme_clay_secondary_dark'),
    $r('app.color.theme_clay_tertiary_dark'),
    $r('app.color.theme_clay_accent_dark'),
    $r('app.color.theme_clay_danger_dark'),
    $r('app.color.theme_clay_grouped_dark'),
    $r('app.color.theme_clay_input_dark'),
    $r('app.color.theme_clay_border_dark'),
    $r('app.color.theme_clay_accent_soft_dark'),
    $r('app.color.theme_clay_active_dark')
  );
  return xopcThemeTokens('default', dark);
}

export const appThemeColors: XopcThemeColors = new XopcThemeColors(xopcThemeTokens('default', false));

function xopcThemeColors(tokens: XopcThemeTokens): CustomColors {
  return {
    brand: tokens.accent,
    alert: tokens.danger,
    confirm: tokens.accent,
    fontPrimary: tokens.foreground,
    fontSecondary: tokens.secondary,
    fontTertiary: tokens.tertiary,
    fontFourth: tokens.tertiary,
    fontEmphasize: tokens.accent,
    iconPrimary: tokens.foreground,
    iconSecondary: tokens.secondary,
    iconTertiary: tokens.tertiary,
    iconEmphasize: tokens.accent,
    backgroundPrimary: tokens.surface,
    backgroundSecondary: tokens.grouped,
    backgroundTertiary: tokens.panel,
    backgroundFourth: tokens.input,
    backgroundEmphasize: tokens.accent,
    compForegroundPrimary: tokens.foreground,
    compBackgroundPrimary: tokens.panel,
    compBackgroundPrimaryTran: tokens.panel,
    compBackgroundGray: tokens.grouped,
    compBackgroundSecondary: tokens.input,
    compBackgroundTertiary: tokens.grouped,
    compBackgroundEmphasize: tokens.accent,
    compEmphasizeSecondary: tokens.accentSoft,
    compEmphasizeTertiary: tokens.accentSoft,
    compDivider: tokens.border,
    interactiveHover: tokens.input,
    interactivePressed: tokens.grouped,
    interactiveActive: tokens.active,
    interactiveSelect: tokens.active,
  };
}

export function xopcCustomTheme(scheme: XopcColorScheme): CustomTheme {
  return {
    colors: xopcThemeColors(xopcThemeTokens(scheme, false)),
    darkColors: xopcThemeColors(xopcThemeTokens(scheme, true)),
  };
}

export function xopcThemePreview(scheme: XopcColorScheme, dark: boolean): XopcThemePreview {
  const tokens = xopcThemeTokens(scheme, dark);
  return new XopcThemePreview(tokens.surface, tokens.panel, tokens.accent, tokens.foreground, tokens.input);
}
