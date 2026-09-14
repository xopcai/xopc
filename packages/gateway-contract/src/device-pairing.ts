import { z } from 'zod';

export const DEVICE_PAIRING_VERSION = 3;
export const BROWSER_PAIRING_INVITATION_VERSION = 1;
export const BROWSER_PAIRING_INVITATION_PREFIX = `XOPC-BROWSER-INVITE-V${BROWSER_PAIRING_INVITATION_VERSION}:`;
export const devicePairingTargetKindSchema = z.enum(['mobile', 'browser']);
export type DevicePairingTargetKind = z.infer<typeof devicePairingTargetKindSchema>;
export const devicePairingRouteSchema = z.strictObject({
  id: z.string().trim().min(1).max(80),
  kind: z.enum(['xopc-secure-link', 'tailscale', 'custom-https', 'local-browser']),
  url: z.string().url(),
}).superRefine((route, context) => {
  const url = new URL(route.url);
  const isOrigin = !url.username && !url.password && url.pathname === '/' && !url.search && !url.hash;
  const valid = route.kind === 'local-browser'
    ? url.protocol === 'http:' && url.hostname === '127.0.0.1' && isOrigin
    : url.protocol === 'https:' && isOrigin;
  if (!valid) context.addIssue({ code: 'custom', path: ['url'], message: 'Pairing route must be a secure origin' });
});
export const devicePairingInvitationPayloadSchema = z.strictObject({
  version: z.literal(DEVICE_PAIRING_VERSION),
  targetKind: devicePairingTargetKindSchema,
  pairingToken: z.string().regex(/^xopc_pair_[0-9a-f-]{36}_[A-Za-z0-9_-]{43}$/i),
  gatewayId: z.string().uuid(),
  gatewayName: z.string().trim().min(1).max(120),
  gatewayPublicKey: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  routes: z.array(devicePairingRouteSchema).min(1).max(8),
  expiresAt: z.number().int().positive(),
}).superRefine((payload, context) => {
  if (payload.targetKind === 'mobile' && payload.routes.some(route => route.kind === 'local-browser')) {
    context.addIssue({ code: 'custom', path: ['routes'], message: 'Mobile invitations require remote routes' });
  }
});
export type DevicePairingInvitationPayload = z.infer<typeof devicePairingInvitationPayloadSchema>;
export const devicePairingKeySchema = z.strictObject({
  kty: z.literal('EC'), crv: z.literal('P-256'),
  x: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  y: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
});
export const devicePairingDeviceSchema = z.strictObject({
  displayName: z.string().trim().min(1).max(80),
  platform: z.enum(['ios', 'android', 'chrome']),
  publicKeyJwk: devicePairingKeySchema,
  extensionId: z.string().regex(/^[a-p]{32}$/).optional(),
}).superRefine((device, context) => {
  if (device.platform === 'chrome' && !device.extensionId) {
    context.addIssue({ code: 'custom', path: ['extensionId'], message: 'Chrome devices require an extension id' });
  }
  if (device.platform !== 'chrome' && device.extensionId) {
    context.addIssue({ code: 'custom', path: ['extensionId'], message: 'Only Chrome devices may set an extension id' });
  }
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
  displayName: string; platform: 'ios' | 'android' | 'chrome'; confirmationCode: string;
  expiresAt: number; serverTime: number; deviceId?: string; connectedAt?: number;
};

export function isRetryableDevicePairingHttpStatus(status: number): boolean {
  return status >= 500 || [404, 408, 425, 429].includes(status);
}

/** Browser invitations are opaque clipboard values, not navigable web links. */
export function formatBrowserPairingInvitation(encodedPayload: string): string {
  if (!/^[A-Za-z0-9_-]+$/.test(encodedPayload)) throw new Error('Browser pairing payload is invalid');
  return `${BROWSER_PAIRING_INVITATION_PREFIX}${encodedPayload}`;
}

export function readBrowserPairingInvitation(value: string): string {
  const invitation = value.trim();
  if (!invitation.startsWith(BROWSER_PAIRING_INVITATION_PREFIX)) {
    throw new Error('Browser pairing invitation is invalid');
  }
  const encodedPayload = invitation.slice(BROWSER_PAIRING_INVITATION_PREFIX.length);
  if (!/^[A-Za-z0-9_-]+$/.test(encodedPayload)) throw new Error('Browser pairing invitation is invalid');
  return encodedPayload;
}

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
