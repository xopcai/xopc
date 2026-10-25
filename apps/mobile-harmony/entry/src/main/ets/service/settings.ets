import { common, ConfigurationConstant } from '@kit.AbilityKit';
import { preferences } from '@kit.ArkData';
import { XopcSecureStore } from './secureStore';
import { i18n, resourceManager } from '@kit.LocalizationKit';
import { CustomTheme } from '@kit.ArkUI';
import { appThemeColors, normalizeXopcColorScheme, XopcColorScheme, xopcCustomTheme } from '../common/themePalette';

interface XopcPreferences { language: string; theme: string; colorScheme?: string; }
const PREFERENCES_STORE: string = 'xopc-display';
const PREFERENCES_KEY: string = 'preferences';

@ObservedV2
export class XopcSettings {
  @Trace language: string = '';
  @Trace theme: string = 'system';
  @Trace colorScheme: XopcColorScheme = 'default';
  onColorModeChanged?: (dark: boolean) => void;
  private store: XopcSecureStore = new XopcSecureStore();

  effectiveLanguage(): string { return this.language || i18n.System.getSystemLanguage(); }
  customTheme(): CustomTheme { return xopcCustomTheme(this.colorScheme); }
  themeColorMode(): ThemeColorMode {
    return this.theme === 'dark' ? ThemeColorMode.DARK : this.theme === 'light' ? ThemeColorMode.LIGHT : ThemeColorMode.SYSTEM;
  }
  isDark(context: common.Context): boolean {
    return this.theme === 'dark' || (this.theme === 'system'
      && context.resourceManager.getConfigurationSync().colorMode === resourceManager.ColorMode.DARK);
  }

  async restore(context: common.Context): Promise<void> {
    const data = await preferences.getPreferences(context, PREFERENCES_STORE);
    let raw = await data.get(PREFERENCES_KEY, '') as string;
    if (!raw) {
      try { raw = await this.store.read(PREFERENCES_KEY) ?? ''; }
      catch (_error) { raw = ''; }
    }
    if (raw) {
      const saved = JSON.parse(raw) as XopcPreferences;
      this.language = ['zh-CN', 'en-US'].includes(saved.language) ? saved.language : '';
      this.theme = ['light', 'dark'].includes(saved.theme) ? saved.theme : 'system';
      this.colorScheme = normalizeXopcColorScheme(saved.colorScheme);
    }
    this.apply(context);
  }
  async update(context: common.Context, language: string, theme: string,
    colorScheme: string = this.colorScheme): Promise<void> {
    if (!['', 'zh-CN', 'en-US'].includes(language) || !['system', 'light', 'dark'].includes(theme)
      || !['default', 'porcelain', 'dawn', 'emerald', 'clay'].includes(colorScheme)) throw new Error('INVALID_PREFERENCE');
    const normalizedScheme = normalizeXopcColorScheme(colorScheme);
    const saved: XopcPreferences = { language, theme, colorScheme: normalizedScheme };
    this.language = language; this.theme = theme; this.colorScheme = normalizedScheme; this.apply(context);
    const data = await preferences.getPreferences(context, PREFERENCES_STORE);
    await data.put(PREFERENCES_KEY, JSON.stringify(saved));
    await data.flush();
  }
  private apply(context: common.Context): void {
    const application = context.getApplicationContext();
    const dark = this.isDark(context);
    appThemeColors.apply(this.colorScheme, dark);
    this.onColorModeChanged?.(dark);
    application.setColorMode(this.theme === 'dark' ? ConfigurationConstant.ColorMode.COLOR_MODE_DARK
      : this.theme === 'light' ? ConfigurationConstant.ColorMode.COLOR_MODE_LIGHT : ConfigurationConstant.ColorMode.COLOR_MODE_NOT_SET);
    application.setLanguage(this.language);
  }

  syncSystemColorMode(colorMode: ConfigurationConstant.ColorMode | undefined): void {
    if (this.theme === 'system') {
      const dark = colorMode === ConfigurationConstant.ColorMode.COLOR_MODE_DARK;
      appThemeColors.apply(this.colorScheme, dark);
      this.onColorModeChanged?.(dark);
    }
  }
}
export const appSettings: XopcSettings = new XopcSettings();
