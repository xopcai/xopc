import { z } from 'zod';

export const DEVICE_PAIRING_VERSION = 3;
export const devicePairingKeySchema = z.strictObject({
  kty: z.literal('EC'), crv: z.literal('P-256'),
  x: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  y: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
});
export const devicePairingDeviceSchema = z.strictObject({
  displayName: z.string().trim().min(1).max(80),
  platform: z.enum(['ios', 'android']),
  publicKeyJwk: devicePairingKeySchema,
});
export const initialDeviceRefreshTokenSchema = z.string().regex(
  /^xopc_rt_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}_[A-Za-z0-9_-]{43}$/i,
);
export const devicePairingProofSchema = z.strictObject({
  gatewayId: z.string().uuid(),
  requestId: z.string().uuid(),
  pairingToken: z.string().min(1).max(256),
  timestamp: z.number().int().positive(),
  nonce: z.string().regex(/^[A-Za-z0-9_-]{24,128}$/),
  signature: z.string().regex(/^[A-Za-z0-9_-]{86}$/),
});
export const devicePairingRequestSchema = devicePairingProofSchema.extend({ device: devicePairingDeviceSchema });
export const devicePairingCompleteSchema = devicePairingProofSchema.extend({
  idempotencyKey: z.string().uuid(), initialRefreshToken: initialDeviceRefreshTokenSchema,
});
export type DevicePairingAction = 'request' | 'status' | 'complete' | 'cancel';
export type DevicePairingState = 'pending' | 'approved' | 'completed' | 'rejected' | 'cancelled' | 'expired';
export type DevicePairingStatus = {
  requestId: string; setupId: string; status: DevicePairingState; revision: number;
  displayName: string; platform: 'ios' | 'android'; confirmationCode: string;
  expiresAt: number; serverTime: number; deviceId?: string;
};

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.entries(value).filter(([, v]) => v !== undefined).sort(([a], [b]) => a.localeCompare(b, 'en'))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

/** Identical domain-separated proof input on the phone and Gateway. */
export function buildDevicePairingProof(action: DevicePairingAction, body: Record<string, unknown>): string {
  const { signature: _signature, ...payload } = body;
  return `xopc-device-pairing-v3\nPOST\n${action}\n${canonical(payload)}`;
}
