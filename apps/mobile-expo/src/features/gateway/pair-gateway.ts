import * as Device from 'expo-device';
import { Platform } from 'react-native';

import { getOrCreateDevicePrivateKey, writeDeviceRefreshToken } from '../../storage/device-credentials';
import { useGatewayStore } from '../../stores/gateway-store';
import { parseGatewayProfile, type GatewayProfile, type GatewayScope } from '../../stores/gateway-types';
import {
  decodeBase64UrlJson,
  devicePublicKeyJwk,
  verifyGatewayPayload,
} from './device-crypto';
import { parseGatewayQrPayload, type ParsedGatewayQr } from './parse-gateway-qr';

type SignedResponse = { ok?: boolean; signedPayload?: string; signature?: string; error?: { message?: string } };
type ExchangePayload = {
  gateway: { id: string; name: string };
  device: { id: string; scopes: GatewayScope[] };
  routes: ParsedGatewayQr['routes'];
  tokens: {
    accessToken: string;
    accessTokenExpiresAt: number;
    refreshToken: string;
    refreshTokenExpiresAt: number;
  };
};

const PAIRING_REQUEST_TIMEOUT_MS = 8_000;

function pairingId(pairingToken: string): string {
  const value = pairingToken.slice('xopc_pair_'.length);
  const separator = value.indexOf('_');
  if (separator < 1) throw new Error('Invalid pairing token');
  return value.slice(0, separator);
}

async function postSigned(origin: string, path: string, body: unknown): Promise<SignedResponse> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PAIRING_REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(`${origin}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const data = await response.json().catch(() => ({})) as SignedResponse;
    if (!response.ok) throw new Error(data.error?.message ?? `Gateway request failed (${response.status})`);
    return data;
  } finally {
    clearTimeout(timer);
  }
}

async function verifyRoute(pairing: ParsedGatewayQr, origin: string): Promise<void> {
  const response = await postSigned(origin, '/api/device-pairing/probe', {
    pairingId: pairingId(pairing.pairingToken),
  });
  if (!response.signedPayload || !response.signature || !verifyGatewayPayload(
    pairing.gatewayPublicKey,
    response.signedPayload,
    response.signature,
  )) throw new Error('Gateway identity verification failed');
  const proof = decodeBase64UrlJson<{ gatewayId?: string; pairingId?: string; issuedAt?: number }>(response.signedPayload);
  if (
    proof.gatewayId !== pairing.gatewayId || proof.pairingId !== pairingId(pairing.pairingToken) ||
    typeof proof.issuedAt !== 'number' || Math.abs(Date.now() - proof.issuedAt) > 5 * 60_000
  ) throw new Error('Gateway identity proof is invalid');
}

export async function pairWithGateway(pairing: ParsedGatewayQr): Promise<GatewayProfile> {
  if (pairing.expiresAt <= Date.now()) throw new Error('Pairing link has expired');
  const privateKey = getOrCreateDevicePrivateKey();
  let selectedOrigin = '';
  let lastError: unknown;
  for (const route of pairing.routes) {
    try {
      await verifyRoute(pairing, route.url);
      selectedOrigin = route.url;
      break;
    } catch (error) {
      lastError = error;
    }
  }
  if (!selectedOrigin) throw new Error('No secure gateway route is reachable', { cause: lastError });

  const response = await postSigned(selectedOrigin, '/api/device-pairing/exchange', {
    pairingToken: pairing.pairingToken,
    device: {
      displayName: Device.modelName ?? (Platform.OS === 'ios' ? 'iPhone' : 'Android'),
      platform: Platform.OS,
      publicKeyJwk: devicePublicKeyJwk(privateKey),
    },
  });
  if (!response.signedPayload || !response.signature || !verifyGatewayPayload(
    pairing.gatewayPublicKey,
    response.signedPayload,
    response.signature,
  )) throw new Error('Pairing response signature is invalid');
  const payload = decodeBase64UrlJson<ExchangePayload>(response.signedPayload);
  if (payload.gateway?.id !== pairing.gatewayId) throw new Error('Pairing response gateway does not match');
  const activeRouteId = payload.routes.find((route) => route.url === selectedOrigin)?.id ?? payload.routes[0]?.id;
  const profile = parseGatewayProfile({
    gatewayId: payload.gateway.id,
    name: payload.gateway.name || pairing.gatewayName,
    gatewayPublicKey: pairing.gatewayPublicKey,
    deviceId: payload.device.id,
    scopes: payload.device.scopes,
    routes: payload.routes,
    activeRouteId,
    updatedAt: Date.now(),
  });
  if (
    !profile || !payload.tokens?.accessToken || !payload.tokens.refreshToken ||
    !Number.isFinite(payload.tokens.accessTokenExpiresAt) ||
    !Number.isFinite(payload.tokens.refreshTokenExpiresAt) ||
    payload.tokens.accessTokenExpiresAt <= Date.now() || payload.tokens.refreshTokenExpiresAt <= Date.now()
  ) {
    throw new Error('Gateway returned invalid device credentials');
  }
  writeDeviceRefreshToken(profile.gatewayId, payload.tokens.refreshToken);
  useGatewayStore.getState().savePairedProfile(
    profile,
    payload.tokens.accessToken,
    payload.tokens.accessTokenExpiresAt,
  );
  return profile;
}

export async function pairGatewayLink(link: string): Promise<GatewayProfile> {
  const pairing = parseGatewayQrPayload(link);
  if (!pairing) throw new Error('Scan a current xopc mobile pairing QR code');
  return pairWithGateway(pairing);
}
