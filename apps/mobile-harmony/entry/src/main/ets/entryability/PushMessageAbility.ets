import { UIAbility } from '@kit.AbilityKit';
import { pushService } from '@kit.PushKit';
import { hilog } from '@kit.PerformanceAnalysisKit';
import { pushNotifications } from '../service/pushNotifications';

export default class PushMessageAbility extends UIAbility {
  onCreate(): void {
    try {
      pushService.receiveMessage('DEFAULT', this, (): void => { pushNotifications.receivedMessage(); });
    } catch (_error) { hilog.warn(0x0000, 'XopcPush', 'Foreground push registration failed'); }
  }
}
