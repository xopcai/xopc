import { pushService } from '@kit.PushKit';
import { notificationManager } from '@kit.NotificationKit';
import { common } from '@kit.AbilityKit';
import { BusinessError } from '@kit.BasicServicesKit';
import { hilog } from '@kit.PerformanceAnalysisKit';
import { gatewaySession } from './gatewaySession';
import { XopcSecureStore } from './secureStore';
import { XopcHttpError } from './transport';
import { appSettings } from './settings';
import { xopcAppVersion } from '../common/appInfo';

interface PushRegistration { platform: string; pushToken: string; permissions: string; locale: string; appVersion: string; }

@ObservedV2
export class XopcPushNotifications {
  @Trace enabled: boolean = false;
  @Trace registered: boolean = false;
  @Trace busy: boolean = false;
  @Trace error: string = '';
  @Trace permissionBlocked: boolean = false;
  @Trace retryDisable: boolean = false;
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
      const allowed = await notificationManager.isNotificationEnabled();
      const optedIn = await this.store.read('push.' + profile.deviceId) === 'enabled';
      if (generation !== this.generation || gatewaySession.currentProfile()?.deviceId !== profile.deviceId) return;
      const blocked = !allowed;
      if (this.permissionBlocked !== blocked || this.deviceId !== profile.deviceId) this.renewedAt = 0;
      this.permissionBlocked = blocked;
      this.enabled = optedIn; this.deviceId = profile.deviceId;
      if (!allowed) this.registered = false;
      if (allowed && this.error === 'NOTIFICATION_PERMISSION_REQUIRED') this.error = '';
      if (optedIn && Date.now() - this.renewedAt > 60 * 60 * 1000) await this.register(false);
    } catch (error) { this.setError(error as BusinessError, 'storage'); }
  }

  async enable(context: common.UIAbilityContext): Promise<void> {
    if (!this.windowReady || this.busy) return;
    if (!gatewaySession.currentProfile()) {
      this.error = 'NOT_PAIRED';
      return;
    }
    this.busy = true; this.error = ''; this.retryDisable = false;
    const generation = this.generation;
    try {
      if (!await notificationManager.isNotificationEnabled()) await notificationManager.requestEnableNotification(context);
      if (generation !== this.generation) return;
      this.permissionBlocked = !await notificationManager.isNotificationEnabled();
      if (this.permissionBlocked) throw new Error('NOTIFICATION_PERMISSION_REQUIRED');
      this.busy = false; await this.register(true);
    } catch (error) { if (generation === this.generation) this.setError(error as BusinessError, 'permission'); }
    finally { if (generation === this.generation) this.busy = false; }
  }

  private async register(persist: boolean): Promise<void> {
    const profile = gatewaySession.currentProfile();
    if (!profile || this.busy) return;
    const generation = this.generation; this.busy = true; this.error = '';
    let phase: string = 'permission';
    try {
      const granted = await notificationManager.isNotificationEnabled();
      if (generation !== this.generation || gatewaySession.currentProfile()?.deviceId !== profile.deviceId) return;
      this.permissionBlocked = !granted;
      if (!granted && persist) { this.registered = false; throw new Error('NOTIFICATION_PERMISSION_REQUIRED'); }
      phase = 'token';
      const token = await pushService.getToken();
      if (generation !== this.generation || gatewaySession.currentProfile()?.deviceId !== profile.deviceId) return;
      if (!token) throw new Error('PUSH_TOKEN_UNAVAILABLE');
      const body: PushRegistration = { platform: 'harmonyos', pushToken: token,
        permissions: granted ? 'granted' : 'denied', locale: appSettings.effectiveLanguage().startsWith('zh') ? 'zh' : 'en', appVersion: xopcAppVersion() };
      phase = 'registration';
      await gatewaySession.request('/api/devices/me/push', 'PUT', JSON.stringify(body));
      if (generation !== this.generation) return;
      phase = 'storage';
      if (persist) await this.store.write('push.' + profile.deviceId, 'enabled');
      this.deviceId = profile.deviceId; this.enabled = true; this.registered = granted; this.renewedAt = Date.now();
    } catch (error) {
      if (generation === this.generation) { this.registered = false; this.setError(error as BusinessError, phase); }
    } finally { if (generation === this.generation) this.busy = false; }
  }

  async disable(): Promise<boolean> {
    if (this.busy) return false;
    const profile = gatewaySession.currentProfile();
    if (!profile) return true;
    this.busy = true; this.error = ''; this.retryDisable = true;
    let phase: string = 'removal';
    try {
      // Remove the server registration before forgetting credentials, so an offline failure remains retryable.
      await gatewaySession.request('/api/devices/me/push', 'DELETE');
      phase = 'storage';
      await this.store.remove('push.' + profile.deviceId);
      this.enabled = false; this.registered = false; this.renewedAt = 0; this.deviceId = '';
      return true;
    } catch (error) { this.setError(error as BusinessError, phase); return false; }
    finally { this.busy = false; }
  }
  async openSettings(context: common.UIAbilityContext): Promise<void> {
    try {
      if (typeof notificationManager.openNotificationSettingsWithResult === 'function') {
        await notificationManager.openNotificationSettingsWithResult(context);
        await this.restore();
      } else {
        await notificationManager.openNotificationSettings(context);
      }
    } catch (error) { this.setError(error as BusinessError, 'permission'); }
  }

  reset(): void { ++this.generation; this.enabled = false; this.registered = false; this.deviceId = ''; this.renewedAt = 0; this.error = ''; this.retryDisable = false; this.permissionBlocked = false; }
  private setError(error: BusinessError, phase: string): void {
    const status = error instanceof XopcHttpError ? error.status : 0;
    const code = error.code ?? 0;
    hilog.warn(0x0000, 'XopcPush', 'Push operation failed: phase=%{public}s status=%{public}d code=%{public}d',
      phase, status, code);
    if (phase === 'permission') {
      this.permissionBlocked = true;
      this.error = 'NOTIFICATION_PERMISSION_REQUIRED';
    } else if (phase === 'token') {
      this.error = code === 1000900012 ? 'PUSH_KIT_NOT_ENABLED' : 'PUSH_TOKEN_UNAVAILABLE';
    } else if (phase === 'registration' && error instanceof XopcHttpError && status === 503 &&
      error.body.includes('PUSH_CLOUD_AUTH_REQUIRED')) {
      this.error = 'PUSH_CLOUD_AUTH_REQUIRED';
    } else if (phase === 'registration' && error instanceof XopcHttpError && status === 503 &&
      (error.body.includes('PUSH_PLATFORM_UNAVAILABLE') || error.body.includes('Harmony push is not configured on this Gateway'))) {
      this.error = 'PUSH_PLATFORM_UNAVAILABLE';
    } else if ((phase === 'registration' || phase === 'removal') &&
      (status === 0 || status === 502 || status === 504)) {
      this.error = error.message === 'NOT_PAIRED' || error.message === 'DEVICE_AUTH_DENIED' ||
        error.message === 'DEVICE_CREDENTIALS_MISSING' ? 'NOT_PAIRED' : 'PUSH_GATEWAY_UNREACHABLE';
    } else {
      this.error = error.message || 'PUSH_OPERATION_FAILED';
    }
  }
}

export const pushNotifications: XopcPushNotifications = new XopcPushNotifications();
