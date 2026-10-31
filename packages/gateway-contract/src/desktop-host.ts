import { z } from 'zod';

import { devicePairingRouteSchema, DEVICE_PAIRING_VERSION } from './device-pairing.js';

export const DESKTOP_HOST_MANIFEST = Object.freeze({
  contract: 'xopc.desktop-host.v1', devicePairingVersion: DEVICE_PAIRING_VERSION, requestProofVersion: 1,
  credentialOnly: true, observation: false, execution: false,
} as const);
export const desktopSshOriginSchema = z.string().max(2048).url().refine(value => {
  try { const url = new URL(value); return value === url.origin && url.protocol === 'http:' && ['127.0.0.1', '[::1]', 'localhost'].includes(url.hostname); }
  catch { return false; }
}, 'Desktop SSH pairing requires a canonical loopback HTTP origin');
export const desktopPairingRouteSchema = z.union([
  devicePairingRouteSchema.refine(route => route.kind !== 'local-browser', 'Desktop pairing cannot use browser enrollment'),
  z.strictObject({ id: z.string().min(1).max(80), kind: z.literal('ssh-loopback'), url: desktopSshOriginSchema }),
]);
export const DESKTOP_HOST_CAPABILITIES = Object.freeze({ sshPairing: true } as const);
export const desktopPairingInvitationSchema = z.strictObject({
  version: z.literal(1), targetKind: z.literal('desktop'),
  pairingToken: z.string().regex(/^xopc_pair_[0-9a-f-]{36}_[A-Za-z0-9_-]{43}$/i),
  gatewayId: z.uuid(), gatewayPublicKey: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  routes: z.array(desktopPairingRouteSchema).min(1).max(8), expiresAt: z.number().int().positive(),
});
export type DesktopPairingInvitation = z.infer<typeof desktopPairingInvitationSchema>;
