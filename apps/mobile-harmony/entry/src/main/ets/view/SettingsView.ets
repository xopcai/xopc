import { appSettings, XopcSettings } from '../service/settings';
import { gatewaySession } from '../service/gatewaySession';
import { realtimeClient } from '../service/realtimeClient';
import { common } from '@kit.AbilityKit';
import { pushNotifications, XopcPushNotifications } from '../service/pushNotifications';

@ComponentV2
export struct XopcSettingsView {
  @Event onDisconnected: () => void = (): void => {};
  @Local preferences: XopcSettings = appSettings;
  @Local error: string = '';
  @Local push: XopcPushNotifications = pushNotifications;

  private async choose(language: string, theme: string): Promise<void> {
    try { const context = this.getUIContext().getHostContext(); if (context) await this.preferences.update(context, language, theme); }
    catch (error) { this.error = (error as Error).message; }
  }
  private async disconnect(): Promise<void> {
    try {
      const result = await this.getUIContext().getPromptAction().showDialog({
        title: $r('app.string.disconnect'), message: $r('app.string.disconnect_help'),
        buttons: [{ text: $r('app.string.cancel'), color: $r('app.color.secondary') },
          { text: $r('app.string.confirm'), color: $r('app.color.danger') }]
      });
      if (result.index !== 1) return;
      if (this.push.busy) { this.error = 'PUSH_OPERATION_IN_PROGRESS'; return; }
      if (this.push.enabled && !await this.push.disable()) return;
      this.push.reset();
      await realtimeClient.forgetIdentity(); await gatewaySession.disconnect(); this.onDisconnected();
    } catch (error) { this.error = (error as Error).message; }
  }
  build() {
    Column({ space: 20 }) {
      Text($r('app.string.settings')).id('settings-title').fontSize(26).fontWeight(FontWeight.Bold).fontColor($r('app.color.foreground'))
      Text('xopc · 0.1.0').fontColor($r('app.color.secondary'))
      Text(gatewaySession.currentProfile()?.name ?? '').fontColor($r('app.color.foreground'))
      Text($r('app.string.language')).fontColor($r('app.color.foreground'))
      Row({ space: 8 }) {
        Button('中文').id('language-zh').onClick((): void => { this.choose('zh-CN', this.preferences.theme); })
        Button('English').id('language-en').onClick((): void => { this.choose('en-US', this.preferences.theme); })
        Button($r('app.string.system')).onClick((): void => { this.choose('', this.preferences.theme); })
      }
      Text($r('app.string.appearance')).fontColor($r('app.color.foreground'))
      Row({ space: 8 }) {
        Button($r('app.string.light')).onClick((): void => { this.choose(this.preferences.language, 'light'); })
        Button($r('app.string.dark')).id('theme-dark').onClick((): void => { this.choose(this.preferences.language, 'dark'); })
        Button($r('app.string.system')).id('theme-system').onClick((): void => { this.choose(this.preferences.language, 'system'); })
      }
      if (gatewaySession.currentProfile()) {
        Text($r('app.string.notifications')).fontColor($r('app.color.foreground'))
        Text(this.push.registered ? $r('app.string.push_registered') : $r('app.string.push_help'))
          .fontColor($r('app.color.secondary')).fontSize(13)
        Row({ space: 8 }) {
          Button($r('app.string.enable_push')).enabled(!this.push.busy)
            .onClick((): void => { this.push.enable(this.getUIContext().getHostContext() as common.UIAbilityContext); })
          if (this.push.enabled) {
            Button($r('app.string.disable_push')).enabled(!this.push.busy).onClick((): void => { this.push.disable(); })
          }
        }
        if (this.push.error) { Text(this.push.error).fontColor($r('app.color.danger')).fontSize(13) }
        Button($r('app.string.disconnect')).enabled(!this.push.busy).onClick((): void => { this.disconnect(); })
      }
      if (this.error) { Text(this.error).fontColor($r('app.color.danger')) }
    }.width('100%').height('100%').padding(20).backgroundColor($r('app.color.surface'))
  }
}
