import { xopcAppVersion } from '../common/appInfo';
import {
  appThemeColors,
  XopcColorScheme,
  XopcThemeColors,
  XopcThemePreview,
  xopcThemePreview,
} from '../common/themePalette';
import { appSettings, XopcSettings } from '../service/settings';
import { gatewaySession } from '../service/gatewaySession';
import { common } from '@kit.AbilityKit';
import { pushNotifications, XopcPushNotifications } from '../service/pushNotifications';
import { XopcPageHeader, XopcHubRow, XopcSectionLabel } from './MobileComponents';
import { connectionModel } from '../viewmodel/connectionViewModel';
import { XopcMobileRoute } from '../model/home';
import { XopcPersonalAgentRecord } from '../model/personalAgent';
import { XopcPersonalAgentAvatar } from './PersonalAgentAvatar';
import { userErrorMessage } from '../common/userError';

@ComponentV2
struct XopcPreferenceOption {
  @Local colors: XopcThemeColors = appThemeColors;
  @Param label: ResourceStr = '';
  @Param selected: boolean = false;
  @Param optionId: string = '';
  @Event onSelect: () => void = (): void => {};

  build() {
    Button({ type: ButtonType.Normal }) {
      Row() {
        Text(this.label).fontSize(16).fontColor(this.colors.foreground).layoutWeight(1)
        if (this.selected) { SymbolGlyph($r('sys.symbol.checkmark')).fontSize(20).fontColor([this.colors.accent]) }
      }.width('100%').height(56).padding({ left: 16, right: 16 })
    }.id(this.optionId).width('100%').padding(0)
      .backgroundColor(this.selected ? this.colors.accentSoft : this.colors.panel)
      .borderRadius(this.colors.corner(14)).margin({ bottom: 8 })
      .accessibilitySelected(this.selected)
      .onClick(this.onSelect)
  }
}

@ComponentV2
export struct XopcSettingsView {
  @Local colors: XopcThemeColors = appThemeColors;
  @Param initialSection: string = '';
  @Param personalAgent: XopcPersonalAgentRecord | null = null;
  @Param useNavigation: boolean = false;
  @Event onOpenSection: (section: string) => void = (_section: string): void => {};
  @Event onExit: () => void = (): void => {};
  @Event onNavigate: (route: XopcMobileRoute) => void = (_route: XopcMobileRoute): void => {};
  @Local preferences: XopcSettings = appSettings;
  @Local selectedLanguage: string = '';
  @Local selectedTheme: string = 'system';
  @Local selectedScheme: XopcColorScheme = 'default';
  @Local error: string = '';
  @Local push: XopcPushNotifications = pushNotifications;
  @Local section: string = '';
  aboutToAppear(): void {
    this.section = this.initialSection;
    this.selectedLanguage = this.preferences.language;
    this.selectedTheme = this.preferences.theme;
    this.selectedScheme = this.preferences.colorScheme;
  }
  private openSection(section: string): void {
    if (this.useNavigation) this.onOpenSection(section); else this.section = section;
  }

  private languageLabel(): ResourceStr {
    return this.selectedLanguage === 'zh-CN' ? '中文' : this.selectedLanguage === 'en-US' ? 'English' : $r('app.string.system');
  }
  private themeLabel(): ResourceStr {
    return this.selectedTheme === 'dark' ? $r('app.string.dark') : this.selectedTheme === 'light' ? $r('app.string.light') : $r('app.string.system');
  }

  private async choose(language: string, theme: string, colorScheme: XopcColorScheme = this.selectedScheme): Promise<void> {
    try {
      const context = this.getUIContext().getHostContext();
      if (!context) return;
      this.selectedLanguage = language;
      this.selectedTheme = theme;
      this.selectedScheme = colorScheme;
      await this.preferences.update(context, language, theme, colorScheme);
    }
    catch (error) { this.error = (error as Error).message; }
  }

  @Builder
  schemePreviewHalf(preview: XopcThemePreview) {
    Column() {
      Column({ space: 4 }) {
        Row({ space: 4 }) {
          Row().width(7).height(7).borderRadius(4).backgroundColor(preview.accent)
          Row().height(5).layoutWeight(1).borderRadius(3).backgroundColor(preview.foreground)
        }.width('100%')
        Row().height(5).width('72%').borderRadius(3).backgroundColor(preview.muted)
      }.width('100%').padding(5).borderRadius(this.colors.corner(5)).backgroundColor(preview.panel)
    }.width('50%').height(44).padding(5).justifyContent(FlexAlign.Center).backgroundColor(preview.canvas)
  }

  @Builder
  schemeCard(scheme: XopcColorScheme, label: ResourceStr, id: string) {
    Button({ type: ButtonType.Normal }) {
      Column({ space: 8 }) {
        Row() {
          this.schemePreviewHalf(xopcThemePreview(scheme, false))
          this.schemePreviewHalf(xopcThemePreview(scheme, true))
        }.width('100%').borderRadius(this.colors.corner(8)).clip(true)
        Row() {
          Text(label).fontSize(13).fontWeight(FontWeight.Medium)
            .fontColor(this.selectedScheme === scheme ? this.colors.accent : this.colors.secondary)
            .layoutWeight(1)
          if (this.selectedScheme === scheme) {
            SymbolGlyph($r('sys.symbol.checkmark')).fontSize(16).fontColor([this.colors.accent])
          }
        }.width('100%')
      }.width('100%').alignItems(HorizontalAlign.Start)
    }.id(id).width('100%').height(84).padding(8)
      .backgroundColor(this.selectedScheme === scheme ? this.colors.accentSoft : this.colors.panel)
      .borderRadius(this.colors.corner(12)).accessibilitySelected(this.selectedScheme === scheme)
      .onClick((): void => { this.choose(this.selectedLanguage, this.selectedTheme, scheme); })
  }
  private async openAboutLink(path: string = ''): Promise<void> {
    const language = this.preferences.effectiveLanguage().startsWith('zh') ? 'zh' : 'en';
    const url = 'https://xopc.ai/' + language + path;
    try {
      await (this.getUIContext().getHostContext() as common.UIAbilityContext).openLink(url, { appLinkingOnly: false });
    } catch (error) { this.error = (error as Error).message; }
  }

  @Builder
  aboutSettings() {
    Column({ space: 8 }) {
      Image($r('app.media.brand_logo')).width(64).height(64).accessibilityLevel('no')
      Text('xopc').fontSize(24).fontWeight(FontWeight.Bold).fontColor(this.colors.foreground)
      Text(xopcAppVersion()).id('settings-about-version').fontSize(14).fontColor(this.colors.secondary)
    }.width('100%').padding({ top: 22, bottom: 28 })
    XopcHubRow({ heading: $r('app.string.settings_website'), symbol: $r('sys.symbol.link'),
      onOpen: (): void => { void this.openAboutLink(); } }).id('settings-about-website')
    XopcHubRow({ heading: $r('app.string.settings_support'), symbol: $r('sys.symbol.questionmark_circle'),
      onOpen: (): void => { void this.openAboutLink('/support'); } }).id('settings-about-support')
    XopcHubRow({ heading: $r('app.string.settings_privacy_policy'), symbol: $r('sys.symbol.lock'),
      onOpen: (): void => { void this.openAboutLink('/privacy'); } }).id('settings-about-privacy')
    XopcHubRow({ heading: $r('app.string.settings_terms'), symbol: $r('sys.symbol.doc_text'),
      onOpen: (): void => { void this.openAboutLink('/terms'); } }).id('settings-about-terms')
  }

  @Builder
  rootSettings() {
    if (gatewaySession.currentProfile()) {
      XopcSectionLabel({ heading: $r('app.string.personalization') })
      Button({ type: ButtonType.Normal }) {
        Row({ space: 12 }) {
          XopcPersonalAgentAvatar({ agentId: this.personalAgent?.agentId ?? '', extent: 40, compact: true,
            appearance: this.personalAgent?.appearance ?? 'loopi', revision: this.personalAgent?.revision ?? 0 })
          Column({ space: 3 }) {
            Text(this.personalAgent?.displayName || $r('app.string.chat_personal_agent')).fontSize(16)
              .fontWeight(FontWeight.Medium).fontColor(this.colors.foreground).maxLines(1)
            Text($r('app.string.personal_agent_summary')).fontSize(12).fontColor(this.colors.secondary)
          }.layoutWeight(1).alignItems(HorizontalAlign.Start)
          SymbolGlyph($r('sys.symbol.chevron_right')).fontSize(15).fontColor([this.colors.secondary])
        }.width('100%').constraintSize({ minHeight: 64 }).padding({ left: 14, right: 14 })
      }.id('settings-personal-agent').width('100%').padding(0).borderRadius(this.colors.corner(16))
        .backgroundColor(this.colors.panel).margin({ bottom: 8 }).enabled(!!this.personalAgent)
        .onClick((): void => { this.onNavigate({ page: 'personal-agent-profile', itemId: '' }); })
      XopcHubRow({ heading: $r('app.string.settings_privacy_memory'), symbol: $r('sys.symbol.lock'),
        onOpen: (): void => { this.onNavigate({ page: 'about-you', itemId: '' }); } }).id('settings-privacy-memory')
      XopcHubRow({ heading: $r('app.string.personal_goals'), symbol: $r('sys.symbol.flag'),
        onOpen: (): void => { this.onNavigate({ page: 'personal-goals', itemId: '' }); } }).id('settings-goals')
    }
    XopcSectionLabel({ heading: $r('app.string.settings_connection_notifications') })
    XopcHubRow({ heading: gatewaySession.currentProfile()?.name ?? $r('app.string.gateways_title'),
      summary: gatewaySession.currentProfile() ? $r('app.string.connection') : '',
      symbol: $r('sys.symbol.link'), onOpen: (): void => { connectionModel.openGateways(); } })
    if (gatewaySession.currentProfile()) {
      if (this.useNavigation) {
        XopcHubRow({ heading: $r('app.string.ms_title'), symbol: $r('sys.symbol.slider_horizontal_2'),
          onOpen: (): void => { this.onNavigate({ page: 'model-settings', itemId: '' }); } }).id('settings-models')
      }
      XopcHubRow({ heading: $r('app.string.notifications'), summary: this.push.registered ? $r('app.string.push_registered') : $r('app.string.push_help'),
        symbol: $r('sys.symbol.bell'), onOpen: (): void => { this.openSection('notifications'); } })
    }
    if (this.useNavigation) {
      XopcSectionLabel({ heading: $r('app.string.settings_data_sharing') })
      XopcHubRow({ heading: $r('app.string.share_center'), summary: $r('app.string.share_center_help'),
        symbol: $r('sys.symbol.share'), onOpen: (): void => { this.onNavigate({ page: 'sharing', itemId: '' }); } })
    }
    XopcSectionLabel({ heading: $r('app.string.preferences') })
    XopcHubRow({ heading: $r('app.string.language'), summary: this.languageLabel(),
      symbol: $r('sys.symbol.doc_text'), onOpen: (): void => { this.openSection('language'); } }).id('open-language')
    XopcHubRow({ heading: $r('app.string.appearance'), summary: this.themeLabel(),
      symbol: $r('sys.symbol.sun_max'), onOpen: (): void => { this.openSection('appearance'); } }).id('open-appearance')
    XopcSectionLabel({ heading: $r('app.string.settings_about_section') })
    XopcHubRow({ heading: $r('app.string.settings_about_xopc'), summary: xopcAppVersion(),
      symbol: $r('sys.symbol.info_circle'), onOpen: (): void => { this.openSection('about'); } }).id('settings-about')
  }

  build() {
    Column() {
      XopcPageHeader({ backVisible: this.useNavigation || !!this.section,
        onBack: (): void => {
          if (this.useNavigation) this.onExit();
          else this.section = '';
        } })
      Scroll() {
        Column() {
          if (!this.section) { this.rootSettings() }
          else if (this.section === 'about') { this.aboutSettings() }
          else if (this.section === 'language') {
            XopcPreferenceOption({ label: $r('app.string.system'), selected: !this.selectedLanguage,
              optionId: 'language-system', onSelect: (): void => { this.choose('', this.selectedTheme); } })
            XopcPreferenceOption({ label: '中文', selected: this.selectedLanguage === 'zh-CN',
              optionId: 'language-zh', onSelect: (): void => { this.choose('zh-CN', this.selectedTheme); } })
            XopcPreferenceOption({ label: 'English', selected: this.selectedLanguage === 'en-US',
              optionId: 'language-en', onSelect: (): void => { this.choose('en-US', this.selectedTheme); } })
          } else if (this.section === 'appearance') {
            Text($r('app.string.display_mode')).fontSize(13).fontWeight(FontWeight.Medium)
              .fontColor(this.colors.secondary).margin({ top: 4, bottom: 4 })
            XopcPreferenceOption({ label: $r('app.string.system'), selected: this.selectedTheme === 'system',
              optionId: 'theme-system', onSelect: (): void => { this.choose(this.selectedLanguage, 'system'); } })
            XopcPreferenceOption({ label: $r('app.string.light'), selected: this.selectedTheme === 'light',
              optionId: 'theme-light', onSelect: (): void => { this.choose(this.selectedLanguage, 'light'); } })
            XopcPreferenceOption({ label: $r('app.string.dark'), selected: this.selectedTheme === 'dark',
              optionId: 'theme-dark', onSelect: (): void => { this.choose(this.selectedLanguage, 'dark'); } })
            Text($r('app.string.color_scheme')).fontSize(13).fontWeight(FontWeight.Medium)
              .fontColor(this.colors.secondary).margin({ top: 24, bottom: 12 })
            Grid() {
              GridItem() { this.schemeCard('default', $r('app.string.color_scheme_default'), 'scheme-default') }
              GridItem() { this.schemeCard('porcelain', $r('app.string.color_scheme_porcelain'), 'scheme-porcelain') }
              GridItem() { this.schemeCard('dawn', $r('app.string.color_scheme_dawn'), 'scheme-dawn') }
              GridItem() { this.schemeCard('emerald', $r('app.string.color_scheme_emerald'), 'scheme-emerald') }
              GridItem() { this.schemeCard('clay', $r('app.string.color_scheme_clay'), 'scheme-clay') }
            }.columnsTemplate('1fr 1fr').columnsGap(12).rowsGap(12).height(276).width('100%')
          } else if (this.section === 'notifications') {
        Text(this.push.registered ? $r('app.string.push_registered') : $r('app.string.push_help'))
          .fontColor(this.colors.secondary).fontSize(16).lineHeight(24).width('100%').margin({ bottom: 20 })
        Row({ space: 8 }) {
          Button($r('app.string.enable_push')).enabled(!this.push.busy)
            .onClick((): void => { this.push.enable(this.getUIContext().getHostContext() as common.UIAbilityContext); })
          if (this.push.enabled) {
            Button($r('app.string.disable_push')).enabled(!this.push.busy).onClick((): void => { this.push.disable(); })
          }
        }
        if (this.push.error) { Text(userErrorMessage(this.push.error, 'save')).fontColor(this.colors.danger).fontSize(13) }
          }
          if (this.error) { Text(userErrorMessage(this.error, 'save')).fontColor(this.colors.danger).margin({ top: 16 }) }
        }.width('100%').padding({ left: 20, right: 20, bottom: 24 }).alignItems(HorizontalAlign.Start)
      }.layoutWeight(1).width('100%').align(Alignment.Top)
    }.width('100%').height('100%').backgroundColor(this.colors.surface)
  }
}
