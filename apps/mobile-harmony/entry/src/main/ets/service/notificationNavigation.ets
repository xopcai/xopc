import { decodeBase64Url } from '../common/protocol';
import { notificationRoute, XopcNotificationRoute } from '../common/notificationRoute';
import { fromUtf8, XopcSecureStore } from './secureStore';
import { gatewaySession } from './gatewaySession';
import { XopcHttpError } from './transport';

interface NotificationAck { consumerId: string; surface: string; }

export class XopcNotificationNavigation {
  private pending: string = '';
  private store: XopcSecureStore = new XopcSecureStore();
  private acknowledgements: Promise<void> = Promise.resolve();
  onTarget?: (route: XopcNotificationRoute) => void;
  receive(uri: string): void {
    const prefix = 'xopc://notification#p=';
    if (!uri.startsWith(prefix) || uri.length > 6000) return;
    try { this.pending = fromUtf8(decodeBase64Url(uri.slice(prefix.length))); this.consume(); }
    catch (_error) { this.pending = ''; }
  }
  consume(): void {
    const profile = gatewaySession.currentProfile();
    if (!profile || !this.onTarget || !this.pending) return;
    const route = notificationRoute(this.pending, profile.gatewayId); this.pending = '';
    if (!route) return;
    // The link selects an authenticated read-only screen; it cannot switch Gateways or perform actions.
    this.onTarget(route);
    this.flush(route.eventId);
  }

  flush(eventId: string = ''): void {
    const profile = gatewaySession.currentProfile();
    if (!profile) return;
    const deviceId = profile.deviceId;
    const gatewayId = profile.gatewayId;
    const key = 'push-acks.' + deviceId;
    this.acknowledgements = this.acknowledgements.then(async (): Promise<void> => {
      const saved = await this.store.read(key);
      let pending = saved ? JSON.parse(saved) as string[] : [];
      if (eventId && !pending.includes(eventId)) {
        pending = pending.concat([eventId]).slice(-32);
        await this.store.write(key, JSON.stringify(pending));
      }
      const ack: NotificationAck = { consumerId: 'harmonyos:' + deviceId, surface: 'mobile' };
      for (const id of pending) {
        const current = gatewaySession.currentProfile();
        if (!current || current.deviceId !== deviceId || current.gatewayId !== gatewayId) return;
        try {
          await gatewaySession.request('/api/notifications/' + encodeURIComponent(id) + '/ack', 'POST', JSON.stringify(ack));
        } catch (error) {
          const failure = error as Error;
          if (!(failure instanceof XopcHttpError) || failure.status !== 404) return;
        }
        pending = pending.filter((value: string): boolean => value !== id);
        if (pending.length === 0) await this.store.remove(key);
        else await this.store.write(key, JSON.stringify(pending));
      }
    }).catch((_error: Error): void => {});
  }
}
export const notificationNavigation: XopcNotificationNavigation = new XopcNotificationNavigation();
