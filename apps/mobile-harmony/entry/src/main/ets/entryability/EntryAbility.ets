import { UIAbility, Want } from '@kit.AbilityKit';
import { KeyboardAvoidMode, window } from '@kit.ArkUI';
import { BusinessError } from '@kit.BasicServicesKit';
import { hilog } from '@kit.PerformanceAnalysisKit';
import { realtimeClient } from '../service/realtimeClient';
import { gatewaySession } from '../service/gatewaySession';
import { appSettings } from '../service/settings';
import { voiceCapture } from '../service/voiceCapture';
import { pushNotifications } from '../service/pushNotifications';
import { notificationNavigation } from '../service/notificationNavigation';
import { layoutState } from '../service/layoutState';
import { chatReadAloud } from '../service/chatReadAloud';
import { decodeShareHandoff, shareIntake, SHARE_INTAKE_URI } from '../service/shareIntake';

export default class EntryAbility extends UIAbility {
  private mainWindow?: window.Window;
  private onAvoidArea = (data: window.AvoidAreaOptions): void => {
    if (data.type === window.AvoidAreaType.TYPE_KEYBOARD) layoutState.keyboardVisible = data.area.bottomRect.height > 0;
  };
  onWindowStageDestroy(): void {
    try { this.mainWindow?.off('avoidAreaChange', this.onAvoidArea); }
    catch (_error) { hilog.warn(0x0000, 'XopcApp', 'Window listener cleanup failed'); }
    this.mainWindow = undefined; layoutState.keyboardVisible = false;
  }
  private receiveWant(want: Want): void {
    if (want.uri === SHARE_INTAKE_URI) {
      const payload = want.parameters?.xopcSharePayload;
      if (typeof payload === 'string') {
        const shared = decodeShareHandoff(payload);
        if (shared) shareIntake.receive(shared);
      }
      return;
    }
    if (want.uri) notificationNavigation.receive(want.uri);
  }
  onCreate(want: Want): void { this.receiveWant(want); }
  onNewWant(want: Want): void { this.receiveWant(want); }
  onForeground(): void { gatewaySession.setForeground(true); if (gatewaySession.currentProfile()) realtimeClient.start(); pushNotifications.restore(); }
  onBackground(): void { gatewaySession.setForeground(false); realtimeClient.stop(); voiceCapture.cancel(); chatReadAloud.leaveForeground(); }
  onDestroy(): void { realtimeClient.reset(); voiceCapture.cancel(); chatReadAloud.disableContinuous(); }
  onWindowStageCreate(stage: window.WindowStage): void {
    stage.loadContent('pages/Index', (error: BusinessError): void => {
      if (error.code) {
        hilog.error(0x0000, 'XopcApp', 'Window load failed: %{public}d', error.code);
      } else {
        try {
          this.mainWindow = stage.getMainWindowSync();
          this.mainWindow.getUIContext().setKeyboardAvoidMode(KeyboardAvoidMode.RESIZE);
          this.mainWindow.on('avoidAreaChange', this.onAvoidArea);
          layoutState.keyboardVisible = this.mainWindow.getWindowAvoidArea(window.AvoidAreaType.TYPE_KEYBOARD).bottomRect.height > 0;
        } catch (_error) { hilog.warn(0x0000, 'XopcApp', 'Keyboard layout initialization failed'); }
        pushNotifications.onWindowReady();
        appSettings.restore(this.context).catch((_error: Error): void => {
          hilog.warn(0x0000, 'XopcApp', 'Preferences could not be restored');
        });
      }
    });
  }
}
