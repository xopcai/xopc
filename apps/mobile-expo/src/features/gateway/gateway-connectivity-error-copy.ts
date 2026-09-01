import type { GatewayConnectivityError } from '../../api/gateway-error';
import type { MessageBundle } from '../../i18n/messages';

export function gatewayConnectivityErrorMessage(
  error: GatewayConnectivityError,
  messages: MessageBundle['gatewayConnect'],
): string {
  switch (error.kind) {
    case 'token-invalid':
      return messages.sessionExpired;
    case 'offline-network':
      return messages.offlineNetwork;
    case 'offline-device':
      return messages.offlineDevice;
    case 'no-route':
      return messages.unreachableUrl;
    case 'reverse-proxy-unreachable':
      return messages.reverseProxyUnreachable ?? messages.unreachableUrl;
    case 'misconfigured':
      return messages.invalidUrl;
    case 'server-error':
      return error.message;
    default:
      return messages.connectFailed;
  }
}
