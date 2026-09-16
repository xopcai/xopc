import { UIAbility, Want } from '@kit.AbilityKit';
import { window } from '@kit.ArkUI';
import { BusinessError } from '@kit.BasicServicesKit';
import { hilog } from '@kit.PerformanceAnalysisKit';
import { realtimeClient } from '../service/realtimeClient';
import { gatewaySession } from '../service/gatewaySession';
import { appSettings } from '../service/settings';
import { voiceCapture } from '../service/voiceCapture';
import { pushNotifications } from '../service/pushNotifications';
import { notificationNavigation } from '../service/notificationNavigation';

export default class EntryAbility extends UIAbility {
  onCreate(want: Want): void { if (want.uri) notificationNavigation.receive(want.uri); }
  onNewWant(want: Want): void { if (want.uri) notificationNavigation.receive(want.uri); }
  onForeground(): void { gatewaySession.setForeground(true); if (gatewaySession.currentProfile()) realtimeClient.start(); pushNotifications.restore(); }
  onBackground(): void { gatewaySession.setForeground(false); realtimeClient.stop(); voiceCapture.cancel(); }
  onDestroy(): void { realtimeClient.reset(); voiceCapture.cancel(); }
  onWindowStageCreate(stage: window.WindowStage): void {
    stage.loadContent('pages/Index', (error: BusinessError): void => {
      if (error.code) {
        hilog.error(0x0000, 'XopcApp', 'Window load failed: %{public}d', error.code);
      } else {
        pushNotifications.onWindowReady();
        appSettings.restore(this.context).catch((_error: Error): void => {
          hilog.warn(0x0000, 'XopcApp', 'Preferences could not be restored');
        });
      }
    });
  }
}
