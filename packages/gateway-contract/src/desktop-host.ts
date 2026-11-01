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
export const DESKTOP_HOST_CAPABILITIES = Object.freeze({ sshPairing: true, deviceStateObservation: true, screenObservation: true, signedGatewayFrames: 1, signedDeviceFrames: 1, observationRevocationVersion: 1, reliableExecutionVersion: 1 } as const);
export const DESKTOP_STATE_OBSERVATION_TOOL = 'desktop.device.get_state' as const;
export const DESKTOP_SCREEN_OBSERVATION_TOOL = 'desktop.screen.capture' as const;
export const desktopExecutionGrantSchema = z.strictObject({
  version: z.literal(1), grantId: z.uuid(), localApprovalId: z.uuid(),
  toolRevisions: z.partialRecord(z.enum(['desktop.clipboard.write', 'desktop.operation.get_status']), z.string().regex(/^[a-f0-9]{64}$/))
    .refine(value => Object.keys(value).length > 0),
  expiresAt: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
});
export type DesktopExecutionGrant = z.infer<typeof desktopExecutionGrantSchema>;
export const desktopPairingInvitationSchema = z.strictObject({
  version: z.literal(1), targetKind: z.literal('desktop'),
  pairingToken: z.string().regex(/^xopc_pair_[0-9a-f-]{36}_[A-Za-z0-9_-]{43}$/i),
  gatewayId: z.uuid(), gatewayPublicKey: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  routes: z.array(desktopPairingRouteSchema).min(1).max(8), expiresAt: z.number().int().positive(),
});
export type DesktopPairingInvitation = z.infer<typeof desktopPairingInvitationSchema>;
