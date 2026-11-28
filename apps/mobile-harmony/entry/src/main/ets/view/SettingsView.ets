import { XOPC_PAGE_PADDING_X } from '../common/designTokens';
import { xopcClickEffect } from '../common/motionTokens';
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
import { XOPC_PAGE_HEADER_HEIGHT_VP, XopcPageHeader, XopcHubRow, XopcSectionLabel } from './MobileComponents';
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
      .borderRadius(this.colors.corner(14)).clipShape(this.colors.cornerClip(14)).margin({ bottom: 8 })
      .clickEffect(xopcClickEffect())
      .accessibilitySelected(this.selected)
      .onClick(this.onSelect)
  }
}

@ComponentV2
export struct XopcSettingsView {
  @Local colors: XopcThemeColors = appThemeColors;
  @Param section: string = '';
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
  aboutToAppear(): void {
    this.selectedLanguage = this.preferences.language;
    this.selectedTheme = this.preferences.theme;
    this.selectedScheme = this.preferences.colorScheme;
    if (this.section === 'notifications') void this.push.restore();
  }
  private languageLabel(): ResourceStr {
    return this.selectedLanguage === 'zh-CN' ? '中文' : this.selectedLanguage === 'en-US' ? 'English' : $r('app.string.system');
  }
  private themeLabel(): ResourceStr {
    return this.selectedTheme === 'dark' ? $r('app.string.dark') : this.selectedTheme === 'light' ? $r('app.string.light') : $r('app.string.system');
  }

  private sectionTitle(): Resource {
    switch (this.section) {
      case 'about': return $r('app.string.settings_about_xopc');
      case 'language': return $r('app.string.language');
      case 'appearance': return $r('app.string.appearance');
      case 'notifications': return $r('app.string.notifications');
      default: return $r('app.string.settings');
    }
  }

  private notificationStatus(): Resource {
    if (this.push.permissionBlocked) return $r('app.string.push_disabled');
    if (this.push.registered) return $r('app.string.push_registered');
    return this.push.enabled ? $r('app.string.push_not_registered') : $r('app.string.push_disabled');
  }

  private setPushEnabled(value: boolean): void {
    if (value) {
      void this.push.enable(this.getUIContext().getHostContext() as common.UIAbilityContext);
    } else {
      void this.push.disable();
    }
  }

  @Builder
  private notificationPreferences() {
    Column({ space: 12 }) {
      Row({ space: 12 }) {
        SymbolGlyph($r('sys.symbol.bell')).fontSize(22).fontColor([this.colors.accent])
        Column({ space: 4 }) {
          Text($r('app.string.push_title')).fontSize(16).fontWeight(FontWeight.Medium).fontColor(this.colors.foreground)
          Text($r('app.string.push_description')).fontSize(13).fontColor(this.colors.secondary)
        }.layoutWeight(1).alignItems(HorizontalAlign.Start)
        if (this.push.busy) {
          LoadingProgress().width(26).height(26).color(this.colors.accent)
            .id('push-progress').margin({ left: 12, right: 12 }).accessibilityText($r('app.string.push_updating'))
        } else {
          Toggle({ type: ToggleType.Switch, isOn: this.push.registered && !this.push.permissionBlocked })
            .selectedColor(this.colors.accent).id('push-switch').accessibilityText($r('app.string.push_title'))
            .enabled(!!gatewaySession.currentProfile())
            .onChange((value: boolean): void => { this.setPushEnabled(value); })
        }
      }.width('100%').constraintSize({ minHeight: 48 })
      if (!this.push.busy && (this.push.permissionBlocked || this.push.error)) {
        Column({ space: 4 }) {
          Text(this.push.permissionBlocked ? $r('app.string.push_permission_required') : this.notificationError())
            .fontSize(13).fontColor(this.colors.secondary)
          Button(this.push.permissionBlocked ? $r('app.string.push_system_settings') : $r('app.string.retry'),
            { type: ButtonType.Normal })
            .height(44).padding({ left: 0, right: 16 }).backgroundColor(Color.Transparent).fontColor(this.colors.accent)
            .id(this.push.permissionBlocked ? 'push-system-settings' : 'push-retry')
            .onClick((): void => {
              if (this.push.permissionBlocked) {
                void this.push.openSettings(this.getUIContext().getHostContext() as common.UIAbilityContext);
              } else {
                this.setPushEnabled(!this.push.retryDisable);
              }
            })
        }.width('100%').alignItems(HorizontalAlign.Start)
      }
    }.width('100%').padding(16).borderRadius(this.colors.corner(16)).backgroundColor(this.colors.panel)
  }

  private notificationError(): ResourceStr {
    switch (this.push.error) {
      case 'NOT_PAIRED': return $r('app.string.push_pair_required');
      case 'NOTIFICATION_PERMISSION_REQUIRED': return $r('app.string.push_permission_required');
      case 'PUSH_KIT_NOT_ENABLED': return $r('app.string.push_kit_not_enabled');
      case 'PUSH_TOKEN_UNAVAILABLE': return $r('app.string.push_token_unavailable');
      case 'PUSH_CLOUD_AUTH_REQUIRED': return $r('app.string.push_cloud_auth_required');
      case 'PUSH_PLATFORM_UNAVAILABLE': return $r('app.string.push_platform_unavailable');
      case 'PUSH_GATEWAY_UNREACHABLE': return $r('app.string.push_gateway_unreachable');
      default: return userErrorMessage(this.push.error, 'save');
    }
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
      .borderRadius(this.colors.corner(12)).clipShape(this.colors.cornerClip(12)).clickEffect(xopcClickEffect())
      .accessibilitySelected(this.selectedScheme === scheme)
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
          Text(this.personalAgent?.displayName || $r('app.string.chat_personal_agent')).fontSize(16)
            .fontWeight(FontWeight.Medium).fontColor(this.colors.foreground).maxLines(1)
            .textOverflow({ overflow: TextOverflow.Ellipsis }).layoutWeight(1)
          SymbolGlyph($r('sys.symbol.chevron_right')).fontSize(15).fontColor([this.colors.secondary])
        }.width('100%').constraintSize({ minHeight: 64 }).padding({ left: 14, right: 14 })
      }.id('settings-personal-agent').width('100%').padding(0).borderRadius(this.colors.corner(16)).clipShape(this.colors.cornerClip(16))
        .backgroundColor(this.colors.panel).margin({ bottom: 8 }).enabled(!!this.personalAgent)
        .clickEffect(xopcClickEffect())
        .onClick((): void => { this.onNavigate({ page: 'personal-agent-profile', itemId: '' }); })
      XopcHubRow({ heading: $r('app.string.settings_privacy_memory'), symbol: $r('sys.symbol.lock'),
        onOpen: (): void => { this.onNavigate({ page: 'about-you', itemId: '' }); } }).id('settings-privacy-memory')
      XopcHubRow({ heading: $r('app.string.personal_goals'), symbol: $r('sys.symbol.flag'),
        onOpen: (): void => { this.onNavigate({ page: 'personal-goals', itemId: '' }); } }).id('settings-goals')
    }
    XopcSectionLabel({ heading: $r('app.string.settings_connection_notifications') })
    XopcHubRow({ heading: $r('app.string.gateways_title'), trailingValue: gatewaySession.currentProfile()?.name ?? '',
      symbol: $r('sys.symbol.link'), onOpen: (): void => { connectionModel.openGateways(); } }).id('settings-gateways')
    if (gatewaySession.currentProfile()) {
      if (this.useNavigation) {
        XopcHubRow({ heading: $r('app.string.ms_title'), symbol: $r('sys.symbol.rectangle_stack'),
          onOpen: (): void => { this.onNavigate({ page: 'model-settings', itemId: '' }); } }).id('settings-models')
      }
      XopcHubRow({ heading: $r('app.string.notifications'), trailingValue: this.notificationStatus(),
        symbol: $r('sys.symbol.bell'), onOpen: (): void => { this.onOpenSection('notifications'); } }).id('settings-notifications')
    }
    if (this.useNavigation) {
      XopcSectionLabel({ heading: $r('app.string.settings_data_sharing') })
      XopcHubRow({ heading: $r('app.string.share_center'),
        symbol: $r('sys.symbol.share'), onOpen: (): void => { this.onNavigate({ page: 'sharing', itemId: '' }); } }).id('settings-share-history')
    }
    XopcSectionLabel({ heading: $r('app.string.preferences') })
    XopcHubRow({ heading: $r('app.string.language'), trailingValue: this.languageLabel(),
      symbol: $r('sys.symbol.doc_text'), onOpen: (): void => { this.onOpenSection('language'); } }).id('open-language')
    XopcHubRow({ heading: $r('app.string.appearance'), trailingValue: this.themeLabel(),
      symbol: $r('sys.symbol.sun_max'), onOpen: (): void => { this.onOpenSection('appearance'); } }).id('open-appearance')
    XopcSectionLabel({ heading: $r('app.string.settings_about_section') })
    XopcHubRow({ heading: $r('app.string.settings_about_xopc'), trailingValue: xopcAppVersion(),
      symbol: $r('sys.symbol.info_circle'), onOpen: (): void => { this.onOpenSection('about'); } }).id('settings-about')
  }

  build() {
    Stack({ alignContent: Alignment.Top }) {
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
              GridItem() { this.schemeCard('emerald', $r('app.string.color_scheme_emerald'), 'scheme-emerald') }
              GridItem() { this.schemeCard('clay', $r('app.string.color_scheme_clay'), 'scheme-clay') }
            }.columnsTemplate('1fr 1fr').columnsGap(12).rowsGap(12).height(180).width('100%')
          } else if (this.section === 'notifications') {
            this.notificationPreferences()
          }
          if (this.error) { Text(userErrorMessage(this.error, 'save')).fontColor(this.colors.danger).margin({ top: 16 }) }
        }.width('100%').padding({ left: XOPC_PAGE_PADDING_X, right: XOPC_PAGE_PADDING_X, top: XOPC_PAGE_HEADER_HEIGHT_VP, bottom: 24 }).alignItems(HorizontalAlign.Start)
      }.height('100%').width('100%').align(Alignment.Top)
      XopcPageHeader({ heading: this.sectionTitle(), showStaticTitle: true,
        backVisible: true, backId: 'settings-back', onBack: this.onExit })
    }.width('100%').height('100%').backgroundColor(this.colors.surface)
  }
}
