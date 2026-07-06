import type { GatewayUrlValidationCode } from './validate-gateway-url';

type GatewayUrlMessages = {
  invalidUrl: string;
  loopbackUrl: string;
  unreachableUrl: string;
};

export function gatewayUrlValidationMessage(
  code: GatewayUrlValidationCode | 'LOOPBACK_NOT_REACHABLE' | string,
  messages: GatewayUrlMessages,
): string {
  switch (code) {
    case 'LOOPBACK_NOT_REACHABLE':
      return messages.loopbackUrl;
    case 'UNREACHABLE':
    case 'NOT_XOPC_GATEWAY':
      return messages.unreachableUrl;
    default:
      return messages.invalidUrl;
  }
}

export function zodGatewayBaseUrlErrorMessage(
  issue: string | undefined,
  messages: GatewayUrlMessages,
): string {
  if (issue === 'LOOPBACK_NOT_REACHABLE') return messages.loopbackUrl;
  return issue ?? messages.invalidUrl;
}
