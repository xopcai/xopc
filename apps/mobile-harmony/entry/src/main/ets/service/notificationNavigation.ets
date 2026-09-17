import { decodeBase64Url } from '../common/protocol';
import { notificationRoute, XopcNotificationRoute } from '../common/notificationRoute';
import { fromUtf8 } from './secureStore';
import { gatewaySession } from './gatewaySession';

interface NotificationAck { consumerId: string; surface: string; }

export class XopcNotificationNavigation {
  private pending: string = '';
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
    const ack: NotificationAck = { consumerId: 'harmonyos:' + profile.deviceId, surface: 'mobile' };
    gatewaySession.request('/api/notifications/' + encodeURIComponent(route.eventId) + '/ack', 'POST', JSON.stringify(ack))
      .catch((_error: Error): void => {});
  }
}
export const notificationNavigation: XopcNotificationNavigation = new XopcNotificationNavigation();
