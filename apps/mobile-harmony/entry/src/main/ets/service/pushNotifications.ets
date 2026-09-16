import { pushService } from '@kit.PushKit';
import { notificationManager } from '@kit.NotificationKit';
import { common } from '@kit.AbilityKit';
import { BusinessError } from '@kit.BasicServicesKit';
import { gatewaySession } from './gatewaySession';
import { XopcSecureStore } from './secureStore';
import { appSettings } from './settings';

interface PushRegistration { platform: string; pushToken: string; permissions: string; locale: string; appVersion: string; }

@ObservedV2
export class XopcPushNotifications {
  @Trace enabled: boolean = false;
  @Trace registered: boolean = false;
  @Trace busy: boolean = false;
  @Trace error: string = '';
  @Trace received: number = 0;
  private store: XopcSecureStore = new XopcSecureStore();
  private deviceId: string = '';
  private renewedAt: number = 0;
  private generation: number = 0;
  private windowReady: boolean = false;

  onWindowReady(): void { this.windowReady = true; }
  receivedMessage(): void { this.received++; }

  async restore(): Promise<void> {
    const profile = gatewaySession.currentProfile();
    if (!profile || this.busy) return;
    const generation = this.generation;
    try {
      const optedIn = await this.store.read('push.' + profile.deviceId) === 'enabled';
      if (generation !== this.generation || gatewaySession.currentProfile()?.deviceId !== profile.deviceId) return;
      this.enabled = optedIn; this.deviceId = profile.deviceId;
      if (optedIn && Date.now() - this.renewedAt > 60 * 60 * 1000) await this.register(false);
    } catch (error) { this.setError(error as BusinessError); }
  }

  async enable(context: common.UIAbilityContext): Promise<void> {
    if (!this.windowReady || this.busy || !gatewaySession.currentProfile()) return;
    this.busy = true; this.error = '';
    const generation = this.generation;
    try {
      if (!await notificationManager.isNotificationEnabled()) await notificationManager.requestEnableNotification(context);
      if (generation !== this.generation) return;
      if (!await notificationManager.isNotificationEnabled()) throw new Error('NOTIFICATION_PERMISSION_REQUIRED');
      this.busy = false; await this.register(true);
    } catch (error) { if (generation === this.generation) this.setError(error as BusinessError); }
    finally { if (generation === this.generation) this.busy = false; }
  }

  private async register(persist: boolean): Promise<void> {
    const profile = gatewaySession.currentProfile();
    if (!profile || this.busy) return;
    const generation = this.generation; this.busy = true; this.error = '';
    try {
      const granted = await notificationManager.isNotificationEnabled();
      const token = await pushService.getToken();
      if (generation !== this.generation || gatewaySession.currentProfile()?.deviceId !== profile.deviceId) return;
      if (!token) throw new Error('PUSH_TOKEN_UNAVAILABLE');
      const body: PushRegistration = { platform: 'harmonyos', pushToken: token,
        permissions: granted ? 'granted' : 'denied', locale: appSettings.effectiveLanguage().startsWith('zh') ? 'zh' : 'en', appVersion: '0.1.0' };
      await gatewaySession.request('/api/devices/me/push', 'PUT', JSON.stringify(body));
      if (generation !== this.generation) return;
      if (persist) await this.store.write('push.' + profile.deviceId, 'enabled');
      this.deviceId = profile.deviceId; this.enabled = true; this.registered = granted; this.renewedAt = Date.now();
    } catch (error) {
      if (generation === this.generation) { this.registered = false; this.setError(error as BusinessError); }
    } finally { if (generation === this.generation) this.busy = false; }
  }

  async disable(): Promise<boolean> {
    if (this.busy) return false;
    const profile = gatewaySession.currentProfile();
    if (!profile) return true;
    this.busy = true; this.error = '';
    try {
      // Remove the server registration before forgetting credentials, so an offline failure remains retryable.
      await gatewaySession.request('/api/devices/me/push', 'DELETE');
      await this.store.remove('push.' + profile.deviceId);
      this.enabled = false; this.registered = false; this.renewedAt = 0; this.deviceId = '';
      return true;
    } catch (error) { this.setError(error as BusinessError); return false; }
    finally { this.busy = false; }
  }
  reset(): void { ++this.generation; this.enabled = false; this.registered = false; this.deviceId = ''; this.renewedAt = 0; }
  private setError(error: BusinessError): void {
    this.error = error.code ? 'PUSH_ERROR_' + error.code + ' · AGC / signing / network' : error.message;
  }
}

export const pushNotifications: XopcPushNotifications = new XopcPushNotifications();
