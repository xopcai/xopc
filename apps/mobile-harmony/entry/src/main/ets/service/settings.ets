import { common, ConfigurationConstant } from '@kit.AbilityKit';
import { XopcSecureStore } from './secureStore';
import { i18n } from '@kit.LocalizationKit';

interface XopcPreferences { language: string; theme: string; }

@ObservedV2
export class XopcSettings {
  @Trace language: string = '';
  @Trace theme: string = 'system';
  private store: XopcSecureStore = new XopcSecureStore();

  effectiveLanguage(): string { return this.language || i18n.System.getSystemLanguage(); }

  async restore(context: common.Context): Promise<void> {
    const raw = await this.store.read('preferences');
    if (raw) {
      const saved = JSON.parse(raw) as XopcPreferences;
      this.language = ['zh-CN', 'en-US'].includes(saved.language) ? saved.language : '';
      this.theme = ['light', 'dark'].includes(saved.theme) ? saved.theme : 'system';
    }
    this.apply(context);
  }
  async update(context: common.Context, language: string, theme: string): Promise<void> {
    if (!['', 'zh-CN', 'en-US'].includes(language) || !['system', 'light', 'dark'].includes(theme)) throw new Error('INVALID_PREFERENCE');
    const saved: XopcPreferences = { language, theme };
    await this.store.write('preferences', JSON.stringify(saved));
    this.language = language; this.theme = theme; this.apply(context);
  }
  private apply(context: common.Context): void {
    const application = context.getApplicationContext();
    application.setColorMode(this.theme === 'dark' ? ConfigurationConstant.ColorMode.COLOR_MODE_DARK
      : this.theme === 'light' ? ConfigurationConstant.ColorMode.COLOR_MODE_LIGHT : ConfigurationConstant.ColorMode.COLOR_MODE_NOT_SET);
    application.setLanguage(this.language);
  }
}
export const appSettings: XopcSettings = new XopcSettings();
