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

@ComponentV2
export struct XopcSettingsView {
  @Local colors: XopcThemeColors = appThemeColors;
  @Param initialSection: string = '';
  @Param useNavigation: boolean = false;
  @Event onOpenSection: (section: string) => void = (_section: string): void => {};
  @Event onExit: () => void = (): void => {};
  @Event onDisconnected: () => void = (): void => {};
  @Local preferences: XopcSettings = appSettings;
  @Local error: string = '';
  @Local push: XopcPushNotifications = pushNotifications;
  @Local section: string = '';
  aboutToAppear(): void { this.section = this.initialSection; }
  private openSection(section: string): void {
    if (section === 'connection') { connectionModel.openGateways(); return; }
    if (this.useNavigation) this.onOpenSection(section); else this.section = section;
  }

  private languageLabel(): ResourceStr {
    return this.preferences.language === 'zh-CN' ? '中文' : this.preferences.language === 'en-US' ? 'English' : $r('app.string.system');
  }
  private themeLabel(): ResourceStr {
    return this.preferences.theme === 'dark' ? $r('app.string.dark') : this.preferences.theme === 'light' ? $r('app.string.light') : $r('app.string.system');
  }

  private async choose(language: string, theme: string, colorScheme: string = this.preferences.colorScheme): Promise<void> {
    try { const context = this.getUIContext().getHostContext(); if (context) await this.preferences.update(context, language, theme, colorScheme); }
    catch (error) { this.error = (error as Error).message; }
  }

  @Builder
  schemePreviewHalf(preview: XopcThemePreview) {
    Column({ space: 4 }) {
      Row({ space: 4 }) {
        Row().width(7).height(7).borderRadius(4).backgroundColor(preview.accent)
        Row().height(5).layoutWeight(1).borderRadius(3).backgroundColor(preview.foreground)
      }.width('100%')
      Row().height(5).width('72%').borderRadius(3).backgroundColor(preview.muted)
    }.width('50%').height(44).padding(8).justifyContent(FlexAlign.Center).backgroundColor(preview.panel)
  }

  @Builder
  schemeCard(scheme: XopcColorScheme, label: ResourceStr, id: string) {
    Button({ type: ButtonType.Normal }) {
      Column({ space: 8 }) {
        Row() {
          this.schemePreviewHalf(xopcThemePreview(scheme, false))
          this.schemePreviewHalf(xopcThemePreview(scheme, true))
        }.width('100%').borderRadius(8).clip(true)
        Row() {
          Text(label).fontSize(13).fontWeight(FontWeight.Medium)
            .fontColor(this.preferences.colorScheme === scheme ? this.colors.accent : this.colors.secondary)
            .layoutWeight(1)
          if (this.preferences.colorScheme === scheme) {
            SymbolGlyph($r('sys.symbol.checkmark')).fontSize(16).fontColor([this.colors.accent])
          }
        }.width('100%')
      }.width('100%').alignItems(HorizontalAlign.Start)
    }.id(id).width('100%').height(84).padding(8).borderRadius(12)
      .backgroundColor(this.preferences.colorScheme === scheme ? this.colors.accentSoft : this.colors.panel)
      .onClick((): void => { this.choose(this.preferences.language, this.preferences.theme, scheme); })
  }
  @Builder
  option(label: ResourceStr, selected: boolean, id: string, action: () => void) {
    Button({ type: ButtonType.Normal }) {
      Row() {
        Text(label).fontSize(16).fontColor(this.colors.foreground).layoutWeight(1)
        if (selected) { SymbolGlyph($r('sys.symbol.checkmark')).fontSize(20).fontColor([this.colors.accent]) }
      }.width('100%').height(56).padding({ left: 16, right: 16 })
    }.id(id).width('100%').padding(0).borderRadius(14)
      .backgroundColor(selected ? this.colors.accentSoft : this.colors.panel).margin({ bottom: 8 }).onClick(action)
  }

  @Builder
  rootSettings() {
    if (gatewaySession.currentProfile()) {
      XopcSectionLabel({ heading: $r('app.string.connection') })
      XopcHubRow({ heading: gatewaySession.currentProfile()?.name ?? 'Gateway', summary: $r('app.string.connection'),
        symbol: $r('sys.symbol.link'), onOpen: (): void => { this.openSection('connection'); } })
      XopcHubRow({ heading: $r('app.string.notifications'), summary: this.push.registered ? $r('app.string.push_registered') : $r('app.string.push_help'),
        symbol: $r('sys.symbol.bell'), onOpen: (): void => { this.openSection('notifications'); } })
    }
    XopcSectionLabel({ heading: $r('app.string.preferences') })
    XopcHubRow({ heading: $r('app.string.language'), summary: this.languageLabel(),
      symbol: $r('sys.symbol.doc_text'), onOpen: (): void => { this.openSection('language'); } }).id('open-language')
    XopcHubRow({ heading: $r('app.string.appearance'), summary: this.themeLabel(),
      symbol: $r('sys.symbol.sun_max'), onOpen: (): void => { this.openSection('appearance'); } }).id('open-appearance')
    XopcSectionLabel({ heading: $r('app.string.about') })
    XopcHubRow({ heading: 'xopc', summary: '0.1.0', symbol: $r('sys.symbol.info_circle'), navigable: false })
  }

  build() {
    Column() {
      if (this.section) {
        Row({ space: 8 }) {
          Button() { SymbolGlyph($r('sys.symbol.chevron_left')).fontSize(22).fontColor([this.colors.foreground]) }
            .id('preference-back').width(44).height(44).backgroundColor(Color.Transparent)
            .accessibilityText($r('app.string.back')).onClick((): void => { if (this.useNavigation) this.onExit(); else this.section = ''; })
          Text(this.section === 'language' ? $r('app.string.language') : this.section === 'appearance' ? $r('app.string.appearance') :
            this.section === 'connection' ? $r('app.string.connection') : $r('app.string.notifications'))
            .fontSize(22).fontWeight(FontWeight.Bold).fontColor(this.colors.foreground)
        }.width('100%').padding({ left: 8, right: 20, top: 12, bottom: 12 })
      } else if (this.useNavigation) {
        Row({ space: 8 }) {
          Button() { SymbolGlyph($r('sys.symbol.chevron_left')).fontSize(22).fontColor([this.colors.foreground]) }
            .width(44).height(44).backgroundColor(Color.Transparent).accessibilityText($r('app.string.back'))
            .onClick((): void => { this.onExit(); })
          Text($r('app.string.settings')).fontSize(24).fontWeight(FontWeight.Bold).fontColor(this.colors.foreground)
        }.id('settings-navigation-title').width('100%').padding({ left: 8, right: 20, top: 12, bottom: 12 })
      } else {
        XopcPageHeader({ heading: $r('app.string.settings') }).id('settings-title')
      }
      Scroll() {
        Column() {
          if (!this.section) { this.rootSettings() }
          else if (this.section === 'language') {
            this.option($r('app.string.system'), !this.preferences.language, 'language-system', (): void => { this.choose('', this.preferences.theme); })
            this.option('中文', this.preferences.language === 'zh-CN', 'language-zh', (): void => { this.choose('zh-CN', this.preferences.theme); })
            this.option('English', this.preferences.language === 'en-US', 'language-en', (): void => { this.choose('en-US', this.preferences.theme); })
          } else if (this.section === 'appearance') {
            Text($r('app.string.display_mode')).fontSize(13).fontWeight(FontWeight.Medium)
              .fontColor(this.colors.secondary).margin({ top: 4, bottom: 4 })
            this.option($r('app.string.system'), this.preferences.theme === 'system', 'theme-system', (): void => { this.choose(this.preferences.language, 'system'); })
            this.option($r('app.string.light'), this.preferences.theme === 'light', 'theme-light', (): void => { this.choose(this.preferences.language, 'light'); })
            this.option($r('app.string.dark'), this.preferences.theme === 'dark', 'theme-dark', (): void => { this.choose(this.preferences.language, 'dark'); })
            Text($r('app.string.color_scheme')).fontSize(13).fontWeight(FontWeight.Medium)
              .fontColor(this.colors.secondary).margin({ top: 24, bottom: 12 })
            Grid() {
              GridItem() { this.schemeCard('default', $r('app.string.color_scheme_default'), 'scheme-default') }
              GridItem() { this.schemeCard('porcelain', $r('app.string.color_scheme_porcelain'), 'scheme-porcelain') }
              GridItem() { this.schemeCard('dawn', $r('app.string.color_scheme_dawn'), 'scheme-dawn') }
              GridItem() { this.schemeCard('emerald', $r('app.string.color_scheme_emerald'), 'scheme-emerald') }
              GridItem() { this.schemeCard('clay', $r('app.string.color_scheme_clay'), 'scheme-clay') }
            }.columnsTemplate('1fr 1fr').columnsGap(12).rowsGap(12).height(276).width('100%')
          } else if (this.section === 'connection') {
            XopcHubRow({ heading: gatewaySession.currentProfile()?.name ?? '', summary: $r('app.string.connection'), navigable: false })
            Button($r('app.string.gateways_title')).id('open-gateways').fontColor(this.colors.accent).backgroundColor(this.colors.panel)
              .width('100%').height(48).margin({ top: 24 }).enabled(!this.push.busy).onClick((): void => { connectionModel.openGateways(); })
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
        if (this.push.error) { Text(this.push.error).fontColor(this.colors.danger).fontSize(13) }
          }
          if (this.error) { Text(this.error).fontColor(this.colors.danger).margin({ top: 16 }) }
        }.width('100%').padding({ left: 20, right: 20, bottom: 24 }).alignItems(HorizontalAlign.Start)
      }.layoutWeight(1).width('100%').align(Alignment.Top)
    }.width('100%').height('100%').backgroundColor(this.colors.surface)
  }
}
