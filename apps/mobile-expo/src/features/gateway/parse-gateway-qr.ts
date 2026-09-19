import { readMobilePairingInvitation } from '@xopcai/gateway-contract';

export type ParsedGatewayQr = {
  version: 4;
  pairingToken: string;
  gatewayId: string;
  gatewayPublicKey: string;
  origins: string[];
  expiresAt: number;
};

export function parseGatewayQrPayload(raw: string): ParsedGatewayQr | null {
  try {
    const value = readMobilePairingInvitation(raw);
    if (value.expiresAt <= Date.now()) return null;
    return {
      version: value.version,
      pairingToken: value.pairingToken,
      gatewayId: value.gatewayId,
      gatewayPublicKey: value.gatewayPublicKey,
      origins: value.origins,
      expiresAt: value.expiresAt,
    };
  } catch {
    return null;
  }
}

export function hasPairableGatewayQr(parsed: ParsedGatewayQr | null): parsed is ParsedGatewayQr {
  return parsed !== null;
}
