import { z } from 'zod';

import { devicePairingRouteSchema, DEVICE_PAIRING_VERSION } from './device-pairing.js';

export const DESKTOP_HOST_MANIFEST = Object.freeze({
  contract: 'xopc.desktop-host.v1', devicePairingVersion: DEVICE_PAIRING_VERSION, requestProofVersion: 1,
  credentialOnly: true, observation: false, execution: false,
} as const);
export const desktopPairingInvitationSchema = z.strictObject({
  version: z.literal(1), targetKind: z.literal('desktop'),
  pairingToken: z.string().regex(/^xopc_pair_[0-9a-f-]{36}_[A-Za-z0-9_-]{43}$/i),
  gatewayId: z.uuid(), gatewayPublicKey: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  routes: z.array(devicePairingRouteSchema).min(1).max(8), expiresAt: z.number().int().positive(),
});
export type DesktopPairingInvitation = z.infer<typeof desktopPairingInvitationSchema>;
