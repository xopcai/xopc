import { z } from 'zod';

export const DEVICE_PAIRING_VERSION = 3;
export const MOBILE_PAIRING_INVITATION_VERSION = 4;
export const MOBILE_PAIRING_INVITATION_PREFIX = 'https://link.xopc.ai/c#';
export const BROWSER_PAIRING_INVITATION_VERSION = 1;
export const BROWSER_PAIRING_INVITATION_PREFIX = `XOPC-BROWSER-INVITE-V${BROWSER_PAIRING_INVITATION_VERSION}:`;
export const devicePairingTargetKindSchema = z.enum(['mobile', 'browser']);
export const devicePlatformSchema = z.enum(['ios', 'android', 'harmonyos', 'chrome']);
export type DevicePlatform = z.infer<typeof devicePlatformSchema>;
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
export const browserPairingInvitationPayloadSchema = z.strictObject({
  version: z.literal(DEVICE_PAIRING_VERSION),
  targetKind: z.literal('browser'),
  pairingToken: z.string().regex(/^xopc_pair_[0-9a-f-]{36}_[A-Za-z0-9_-]{43}$/i),
  gatewayId: z.string().uuid(),
  gatewayName: z.string().trim().min(1).max(120),
  gatewayPublicKey: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  routes: z.array(devicePairingRouteSchema).min(1).max(8),
  expiresAt: z.number().int().positive(),
});
export type BrowserPairingInvitationPayload = z.infer<typeof browserPairingInvitationPayloadSchema>;

const secureMobileOriginSchema = z.string().url().superRefine((origin, context) => {
  const url = new URL(origin);
  if (url.protocol !== 'https:' || url.username || url.password || origin !== url.origin) {
    context.addIssue({ code: 'custom', message: 'Mobile pairing origins must be canonical HTTPS origins' });
  }
});

export const mobilePairingInvitationSchema = z.strictObject({
  version: z.literal(MOBILE_PAIRING_INVITATION_VERSION),
  pairingToken: z.string().regex(/^xopc_pair_[0-9a-f-]{36}_[A-Za-z0-9_-]{43}$/i),
  gatewayId: z.string().uuid(),
  gatewayPublicKey: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  origins: z.array(secureMobileOriginSchema).min(1).max(8),
  expiresAt: z.number().int().positive(),
}).superRefine((payload, context) => {
  if (new Set(payload.origins).size !== payload.origins.length) {
    context.addIssue({ code: 'custom', path: ['origins'], message: 'Mobile pairing origins must be unique' });
  }
});
export type MobilePairingInvitation = z.infer<typeof mobilePairingInvitationSchema>;

const BASE64URL_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const MOBILE_PAIRING_TOKEN = /^xopc_pair_([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})_([A-Za-z0-9_-]{43})$/i;
const MOBILE_INVITATION_FIXED_BYTES = 1 + 16 + 32 + 16 + 32 + 4 + 1;
const MAX_MOBILE_INVITATION_LENGTH = 16_384;

function encodeBase64Url(bytes: Uint8Array): string {
  let result = '';
  for (let index = 0; index < bytes.length; index += 3) {
    const a = bytes[index] ?? 0;
    const b = bytes[index + 1] ?? 0;
    const c = bytes[index + 2] ?? 0;
    result += BASE64URL_ALPHABET[a >> 2];
    result += BASE64URL_ALPHABET[((a & 3) << 4) | (b >> 4)];
    if (index + 1 < bytes.length) result += BASE64URL_ALPHABET[((b & 15) << 2) | (c >> 6)];
    if (index + 2 < bytes.length) result += BASE64URL_ALPHABET[c & 63];
  }
  return result;
}

function decodeBase64Url(value: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]*$/.test(value) || value.length % 4 === 1) throw new Error('Mobile pairing invitation is malformed');
  const output: number[] = [];
  let accumulator = 0;
  let bits = 0;
  for (const character of value) {
    accumulator = (accumulator << 6) | BASE64URL_ALPHABET.indexOf(character);
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      output.push((accumulator >> bits) & 0xff);
    }
  }
  const bytes = Uint8Array.from(output);
  if (encodeBase64Url(bytes) !== value) throw new Error('Mobile pairing invitation is malformed');
  return bytes;
}

function uuidToBytes(uuid: string): Uint8Array {
  const hex = uuid.replaceAll('-', '');
  if (!/^[0-9a-f]{32}$/i.test(hex)) throw new Error('Mobile pairing UUID is malformed');
  return Uint8Array.from({ length: 16 }, (_, index) => Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16));
}

function bytesToUuid(bytes: Uint8Array): string {
  const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function asciiBytes(value: string): Uint8Array {
  const bytes = Uint8Array.from(value, character => character.charCodeAt(0));
  if (bytes.some(byte => byte < 0x21 || byte > 0x7e) || bytes.length !== value.length) {
    throw new Error('Mobile pairing origin must be ASCII');
  }
  return bytes;
}

function asciiText(bytes: Uint8Array): string {
  if (bytes.some(byte => byte < 0x21 || byte > 0x7e)) throw new Error('Mobile pairing origin must be ASCII');
  return Array.from(bytes, byte => String.fromCharCode(byte)).join('');
}

export function formatMobilePairingInvitation(input: MobilePairingInvitation): string {
  const invitation = mobilePairingInvitationSchema.parse(input);
  const token = MOBILE_PAIRING_TOKEN.exec(invitation.pairingToken);
  if (!token) throw new Error('Mobile pairing token is malformed');
  const secret = decodeBase64Url(token[2]);
  const publicKey = decodeBase64Url(invitation.gatewayPublicKey);
  if (secret.length !== 32 || publicKey.length !== 32) throw new Error('Mobile pairing key is malformed');
  const expiresAtSeconds = Math.floor(invitation.expiresAt / 1_000);
  if (expiresAtSeconds > 0xffff_ffff) throw new Error('Mobile pairing expiry is out of range');
  const origins = invitation.origins.map(asciiBytes);
  if (origins.some(origin => origin.length > 0xffff)) throw new Error('Mobile pairing origin is too long');
  const bytes = new Uint8Array(MOBILE_INVITATION_FIXED_BYTES + origins.reduce((sum, origin) => sum + 2 + origin.length, 0));
  const view = new DataView(bytes.buffer);
  let offset = 0;
  bytes[offset++] = MOBILE_PAIRING_INVITATION_VERSION;
  bytes.set(uuidToBytes(token[1]), offset); offset += 16;
  bytes.set(secret, offset); offset += 32;
  bytes.set(uuidToBytes(invitation.gatewayId), offset); offset += 16;
  bytes.set(publicKey, offset); offset += 32;
  view.setUint32(offset, expiresAtSeconds); offset += 4;
  bytes[offset++] = origins.length;
  for (const origin of origins) {
    view.setUint16(offset, origin.length); offset += 2;
    bytes.set(origin, offset); offset += origin.length;
  }
  return `${MOBILE_PAIRING_INVITATION_PREFIX}${encodeBase64Url(bytes)}`;
}

export function readMobilePairingInvitation(value: string): MobilePairingInvitation {
  const link = value.trim();
  if (!link.startsWith(MOBILE_PAIRING_INVITATION_PREFIX) || link.length > MAX_MOBILE_INVITATION_LENGTH) {
    throw new Error('Mobile pairing invitation is invalid');
  }
  const bytes = decodeBase64Url(link.slice(MOBILE_PAIRING_INVITATION_PREFIX.length));
  if (bytes.length < MOBILE_INVITATION_FIXED_BYTES) throw new Error('Mobile pairing invitation is truncated');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 0;
  if (bytes[offset++] !== MOBILE_PAIRING_INVITATION_VERSION) throw new Error('Mobile pairing invitation version is not supported');
  const pairingId = bytesToUuid(bytes.slice(offset, offset + 16)); offset += 16;
  const secret = encodeBase64Url(bytes.slice(offset, offset + 32)); offset += 32;
  const gatewayId = bytesToUuid(bytes.slice(offset, offset + 16)); offset += 16;
  const gatewayPublicKey = encodeBase64Url(bytes.slice(offset, offset + 32)); offset += 32;
  const expiresAt = view.getUint32(offset) * 1_000; offset += 4;
  const routeCount = bytes[offset++];
  if (routeCount < 1 || routeCount > 8) throw new Error('Mobile pairing invitation route count is invalid');
  const origins: string[] = [];
  for (let index = 0; index < routeCount; index += 1) {
    if (offset + 2 > bytes.length) throw new Error('Mobile pairing invitation is truncated');
    const length = view.getUint16(offset); offset += 2;
    if (length === 0 || offset + length > bytes.length) throw new Error('Mobile pairing invitation is truncated');
    origins.push(asciiText(bytes.slice(offset, offset + length))); offset += length;
  }
  if (offset !== bytes.length) throw new Error('Mobile pairing invitation has trailing data');
  return mobilePairingInvitationSchema.parse({
    version: MOBILE_PAIRING_INVITATION_VERSION,
    pairingToken: `xopc_pair_${pairingId}_${secret}`,
    gatewayId,
    gatewayPublicKey,
    origins,
    expiresAt,
  });
}
export const devicePairingKeySchema = z.strictObject({
  kty: z.literal('EC'), crv: z.literal('P-256'),
  x: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  y: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
});
export const devicePairingDeviceSchema = z.strictObject({
  displayName: z.string().trim().min(1).max(80),
  platform: devicePlatformSchema,
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
  displayName: string; platform: DevicePlatform; confirmationCode: string;
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
