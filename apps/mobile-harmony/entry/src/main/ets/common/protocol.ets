import type { XopcInvitation, XopcPairingBody, XopcRoute } from '../model/gateway';

const ALPHABET: string = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const UUID = new RegExp('^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$', 'i');

export function encodeBase64Url(bytes: Uint8Array): string {
  let result = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i]; const b = bytes[i + 1] ?? 0; const c = bytes[i + 2] ?? 0;
    result += ALPHABET[a >> 2] + ALPHABET[((a & 3) << 4) | (b >> 4)];
    if (i + 1 < bytes.length) result += ALPHABET[((b & 15) << 2) | (c >> 6)];
    if (i + 2 < bytes.length) result += ALPHABET[c & 63];
  }
  return result;
}

export function decodeBase64Url(text: string): Uint8Array {
  if (!new RegExp('^[A-Za-z0-9_-]*$').test(text) || text.length % 4 === 1) throw new Error('INVALID_BASE64');
  const bytes: number[] = [];
  let bits = 0; let accumulator = 0;
  for (let i = 0; i < text.length; i++) {
    accumulator = (accumulator << 6) | ALPHABET.indexOf(text[i]); bits += 6;
    if (bits >= 8) { bits -= 8; bytes.push((accumulator >> bits) & 255); }
  }
  const result = new Uint8Array(bytes);
  if (encodeBase64Url(result) !== text) throw new Error('INVALID_BASE64');
  return result;
}

/** Validate before handing an origin to NetworkKit; no paths, userinfo or redirects. */
export function secureOrigin(input: string): string {
  if (typeof input !== 'string' || !new RegExp('^https://(?:[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?|\\[[0-9A-Fa-f:]+\\])(?::[0-9]{1,5})?/?$').test(input)) {
    throw new Error('INVALID_SECURE_ORIGIN');
  }
  const port = new RegExp(':([0-9]+)/?$').exec(input);
  if (port && (Number(port[1]) < 1 || Number(port[1]) > 65535)) throw new Error('INVALID_SECURE_ORIGIN');
  return input.endsWith('/') ? input.slice(0, -1) : input;
}

export function validateRoutes(routes: XopcRoute[]): XopcRoute[] {
  if (!Array.isArray(routes) || routes.length < 1 || routes.length > 8) throw new Error('INVALID_ROUTES');
  const ids = new Set<string>();
  return routes.map((route: XopcRoute): XopcRoute => {
    if (!route || typeof route.id !== 'string' || !route.id.trim() || route.id.length > 80 || ids.has(route.id)
      || !['xopc-secure-link', 'tailscale', 'custom-https'].includes(route.kind)) throw new Error('INVALID_ROUTES');
    ids.add(route.id);
    return { id: route.id, kind: route.kind, url: secureOrigin(route.url) };
  });
}

const MOBILE_INVITATION_PREFIX: string = 'https://link.xopc.ai/c#';
const MOBILE_INVITATION_VERSION: number = 4;
const MOBILE_INVITATION_FIXED_BYTES: number = 102;

function uuidBytes(uuid: string): Uint8Array {
  const hex = uuid.replace(new RegExp('-', 'g'), '');
  if (!new RegExp('^[0-9a-f]{32}$', 'i').test(hex)) throw new Error('INVALID_INVITATION');
  const bytes = new Uint8Array(16);
  for (let i = 0; i < bytes.length; i++) bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return bytes;
}

function bytesUuid(bytes: Uint8Array): string {
  if (bytes.length !== 16) throw new Error('INVALID_INVITATION');
  let hex = '';
  for (let i = 0; i < bytes.length; i++) hex += bytes[i].toString(16).padStart(2, '0');
  return hex.slice(0, 8) + '-' + hex.slice(8, 12) + '-' + hex.slice(12, 16) + '-' + hex.slice(16, 20) + '-' + hex.slice(20);
}

function asciiBytes(value: string): Uint8Array {
  const bytes = new Uint8Array(value.length);
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code < 0x21 || code > 0x7e) throw new Error('INVALID_INVITATION');
    bytes[i] = code;
  }
  return bytes;
}

function asciiText(bytes: Uint8Array): string {
  let result = '';
  for (let i = 0; i < bytes.length; i++) {
    if (bytes[i] < 0x21 || bytes[i] > 0x7e) throw new Error('INVALID_INVITATION');
    result += String.fromCharCode(bytes[i]);
  }
  return result;
}

export function formatMobilePairingInvitation(invitation: XopcInvitation): string {
  const token = new RegExp('^xopc_pair_([0-9a-f-]{36})_([A-Za-z0-9_-]{43})$', 'i').exec(invitation.pairingToken);
  if (!token || invitation.version !== MOBILE_INVITATION_VERSION || !UUID.test(invitation.gatewayId)
    || decodeBase64Url(invitation.gatewayPublicKey).length !== 32 || !Number.isSafeInteger(invitation.expiresAt)
    || !Array.isArray(invitation.origins) || invitation.origins.length < 1 || invitation.origins.length > 8) {
    throw new Error('INVALID_INVITATION');
  }
  const secret = decodeBase64Url(token[2]);
  const publicKey = decodeBase64Url(invitation.gatewayPublicKey);
  if (secret.length !== 32 || publicKey.length !== 32) throw new Error('INVALID_INVITATION');
  const origins: Uint8Array[] = [];
  let length = MOBILE_INVITATION_FIXED_BYTES;
  const unique = new Set<string>();
  for (let i = 0; i < invitation.origins.length; i++) {
    const origin = secureOrigin(invitation.origins[i]);
    if (unique.has(origin) || origin !== invitation.origins[i]) throw new Error('INVALID_INVITATION');
    unique.add(origin);
    const bytes = asciiBytes(origin);
    if (bytes.length > 65535) throw new Error('INVALID_INVITATION');
    origins.push(bytes); length += 2 + bytes.length;
  }
  const output = new Uint8Array(length);
  let offset = 0;
  output[offset++] = MOBILE_INVITATION_VERSION;
  output.set(uuidBytes(token[1]), offset); offset += 16;
  output.set(secret, offset); offset += 32;
  output.set(uuidBytes(invitation.gatewayId), offset); offset += 16;
  output.set(publicKey, offset); offset += 32;
  const seconds = Math.floor(invitation.expiresAt / 1000);
  if (seconds <= 0 || seconds > 4294967295) throw new Error('INVALID_INVITATION');
  output[offset++] = Math.floor(seconds / 16777216) & 255;
  output[offset++] = Math.floor(seconds / 65536) & 255;
  output[offset++] = Math.floor(seconds / 256) & 255;
  output[offset++] = seconds & 255;
  output[offset++] = origins.length;
  for (let i = 0; i < origins.length; i++) {
    output[offset++] = Math.floor(origins[i].length / 256); output[offset++] = origins[i].length & 255;
    output.set(origins[i], offset); offset += origins[i].length;
  }
  return MOBILE_INVITATION_PREFIX + encodeBase64Url(output);
}

export function readMobilePairingInvitation(link: string, now: number): XopcInvitation {
  const text = link.trim();
  if (!text.startsWith(MOBILE_INVITATION_PREFIX) || text.length > 16384) throw new Error('INVALID_INVITATION');
  const bytes = decodeBase64Url(text.slice(MOBILE_INVITATION_PREFIX.length));
  if (bytes.length < MOBILE_INVITATION_FIXED_BYTES) throw new Error('INVALID_INVITATION');
  let offset = 0;
  if (bytes[offset++] !== MOBILE_INVITATION_VERSION) throw new Error('INVALID_INVITATION');
  const pairingId = bytesUuid(bytes.slice(offset, offset + 16)); offset += 16;
  const secret = encodeBase64Url(bytes.slice(offset, offset + 32)); offset += 32;
  const gatewayId = bytesUuid(bytes.slice(offset, offset + 16)); offset += 16;
  const gatewayPublicKey = encodeBase64Url(bytes.slice(offset, offset + 32)); offset += 32;
  const seconds = bytes[offset] * 16777216 + bytes[offset + 1] * 65536 + bytes[offset + 2] * 256 + bytes[offset + 3]; offset += 4;
  const expiresAt = seconds * 1000;
  const count = bytes[offset++];
  if (count < 1 || count > 8 || expiresAt <= now) throw new Error('INVALID_INVITATION');
  const origins: string[] = [];
  const unique = new Set<string>();
  for (let i = 0; i < count; i++) {
    if (offset + 2 > bytes.length) throw new Error('INVALID_INVITATION');
    const length = bytes[offset] * 256 + bytes[offset + 1]; offset += 2;
    if (length < 1 || offset + length > bytes.length) throw new Error('INVALID_INVITATION');
    const origin = secureOrigin(asciiText(bytes.slice(offset, offset + length))); offset += length;
    if (unique.has(origin)) throw new Error('INVALID_INVITATION');
    unique.add(origin); origins.push(origin);
  }
  if (offset !== bytes.length) throw new Error('INVALID_INVITATION');
  return { version: MOBILE_INVITATION_VERSION, pairingToken: 'xopc_pair_' + pairingId + '_' + secret,
    gatewayId, gatewayPublicKey, origins, expiresAt };
}

/** Fixed canonical order matches gateway-contract's recursive key sorting. */
export function pairingProof(action: string, body: XopcPairingBody): string {
  const fields: string[] = [];
  const device = body.device;
  if (device) {
    const key = device.publicKeyJwk;
    fields.push('"device":{"displayName":' + JSON.stringify(device.displayName) + ',"platform":' + JSON.stringify(device.platform)
      + ',"publicKeyJwk":{"crv":' + JSON.stringify(key.crv) + ',"kty":' + JSON.stringify(key.kty)
      + ',"x":' + JSON.stringify(key.x) + ',"y":' + JSON.stringify(key.y) + '}}');
  }
  fields.push('"gatewayId":' + JSON.stringify(body.gatewayId));
  if (body.idempotencyKey !== undefined) fields.push('"idempotencyKey":' + JSON.stringify(body.idempotencyKey));
  if (body.initialRefreshToken !== undefined) fields.push('"initialRefreshToken":' + JSON.stringify(body.initialRefreshToken));
  fields.push('"nonce":' + JSON.stringify(body.nonce), '"pairingToken":' + JSON.stringify(body.pairingToken),
    '"requestId":' + JSON.stringify(body.requestId), '"timestamp":' + JSON.stringify(body.timestamp));
  return 'xopc-device-pairing-v3\nPOST\n' + action + '\n{' + fields.join(',') + '}';
}

export function fixedIntegerBytes(integer: bigint, length: number): Uint8Array {
  const hex = integer.toString(16).padStart(length * 2, '0');
  if (integer < BigInt(0) || hex.length !== length * 2) throw new Error('INVALID_INTEGER');
  const bytes = new Uint8Array(length);
  for (let i = 0; i < length; i++) bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return bytes;
}
