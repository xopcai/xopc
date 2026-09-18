import { appSettings, XopcSettings } from '../service/settings';
import { gatewaySession } from '../service/gatewaySession';
import { common } from '@kit.AbilityKit';
import { pushNotifications, XopcPushNotifications } from '../service/pushNotifications';
import { XopcPageHeader, XopcHubRow, XopcSectionLabel } from './MobileComponents';
import { connectionModel } from '../viewmodel/connectionViewModel';

@ComponentV2
export struct XopcSettingsView {
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

  private async choose(language: string, theme: string): Promise<void> {
    try { const context = this.getUIContext().getHostContext(); if (context) await this.preferences.update(context, language, theme); }
    catch (error) { this.error = (error as Error).message; }
  }
  @Builder
  option(label: ResourceStr, selected: boolean, id: string, action: () => void) {
    Button({ type: ButtonType.Normal }) {
      Row() {
        Text(label).fontSize(16).fontColor($r('app.color.foreground')).layoutWeight(1)
        if (selected) { SymbolGlyph($r('sys.symbol.checkmark')).fontSize(20).fontColor([$r('app.color.accent')]) }
      }.width('100%').height(56)
    }.id(id).width('100%').padding(0).backgroundColor(Color.Transparent).onClick(action)
      .border({ width: { bottom: 0.5 }, color: $r('app.color.border_subtle') })
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
          Button() { SymbolGlyph($r('sys.symbol.chevron_left')).fontSize(22).fontColor([$r('app.color.foreground')]) }
            .id('preference-back').width(44).height(44).backgroundColor(Color.Transparent)
            .accessibilityText($r('app.string.back')).onClick((): void => { if (this.useNavigation) this.onExit(); else this.section = ''; })
          Text(this.section === 'language' ? $r('app.string.language') : this.section === 'appearance' ? $r('app.string.appearance') :
            this.section === 'connection' ? $r('app.string.connection') : $r('app.string.notifications'))
            .fontSize(22).fontWeight(FontWeight.Bold).fontColor($r('app.color.foreground'))
        }.width('100%').padding({ left: 8, right: 20, top: 12, bottom: 12 })
      } else if (this.useNavigation) {
        Row({ space: 8 }) {
          Button() { SymbolGlyph($r('sys.symbol.chevron_left')).fontSize(22).fontColor([$r('app.color.foreground')]) }
            .width(44).height(44).backgroundColor(Color.Transparent).accessibilityText($r('app.string.back'))
            .onClick((): void => { this.onExit(); })
          Text($r('app.string.settings')).fontSize(24).fontWeight(FontWeight.Bold).fontColor($r('app.color.foreground'))
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
            this.option($r('app.string.system'), this.preferences.theme === 'system', 'theme-system', (): void => { this.choose(this.preferences.language, 'system'); })
            this.option($r('app.string.light'), this.preferences.theme === 'light', 'theme-light', (): void => { this.choose(this.preferences.language, 'light'); })
            this.option($r('app.string.dark'), this.preferences.theme === 'dark', 'theme-dark', (): void => { this.choose(this.preferences.language, 'dark'); })
          } else if (this.section === 'connection') {
            XopcHubRow({ heading: gatewaySession.currentProfile()?.name ?? '', summary: $r('app.string.connection'), navigable: false })
            Button($r('app.string.gateways_title')).id('open-gateways').fontColor($r('app.color.accent')).backgroundColor($r('app.color.panel'))
              .width('100%').height(48).margin({ top: 24 }).enabled(!this.push.busy).onClick((): void => { connectionModel.openGateways(); })
          } else if (this.section === 'notifications') {
        Text(this.push.registered ? $r('app.string.push_registered') : $r('app.string.push_help'))
          .fontColor($r('app.color.secondary')).fontSize(16).lineHeight(24).width('100%').margin({ bottom: 20 })
        Row({ space: 8 }) {
          Button($r('app.string.enable_push')).enabled(!this.push.busy)
            .onClick((): void => { this.push.enable(this.getUIContext().getHostContext() as common.UIAbilityContext); })
          if (this.push.enabled) {
            Button($r('app.string.disable_push')).enabled(!this.push.busy).onClick((): void => { this.push.disable(); })
          }
        }
        if (this.push.error) { Text(this.push.error).fontColor($r('app.color.danger')).fontSize(13) }
          }
          if (this.error) { Text(this.error).fontColor($r('app.color.danger')).margin({ top: 16 }) }
        }.width('100%').padding({ left: 20, right: 20, bottom: 24 }).alignItems(HorizontalAlign.Start)
      }.layoutWeight(1).width('100%').align(Alignment.Top)
    }.width('100%').height('100%').backgroundColor($r('app.color.surface'))
  }
}
