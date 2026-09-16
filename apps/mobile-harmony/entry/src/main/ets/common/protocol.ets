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

export function parseInvitationJson(json: string, now: number): XopcInvitation {
  const invitation = JSON.parse(json) as XopcInvitation;
  if (!invitation || invitation.version !== 3 || invitation.targetKind !== 'mobile'
    || typeof invitation.gatewayId !== 'string' || !UUID.test(invitation.gatewayId)
    || typeof invitation.gatewayName !== 'string' || !invitation.gatewayName.trim() || invitation.gatewayName.length > 120
    || typeof invitation.pairingToken !== 'string' || !new RegExp('^xopc_pair_[0-9a-f-]{36}_[A-Za-z0-9_-]{43}$', 'i').test(invitation.pairingToken)
    || typeof invitation.gatewayPublicKey !== 'string' || decodeBase64Url(invitation.gatewayPublicKey).length !== 32
    || !Number.isSafeInteger(invitation.expiresAt) || invitation.expiresAt <= now) throw new Error('INVALID_INVITATION');
  invitation.routes = validateRoutes(invitation.routes);
  return invitation;
}

export function invitationPayload(link: string): string {
  const prefix = 'https://link.xopc.ai/connect#p=';
  const text = link.trim();
  if (!text.startsWith(prefix) || text.length > 16384) throw new Error('INVALID_INVITATION');
  return text.slice(prefix.length);
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
