import { z } from 'zod';

/** Versioned separately from optional Endpoint/Computer contracts. */
export const DESKTOP_CHAT_MANIFEST = Object.freeze({
  contract: 'xopc.desktop-chat.v1',
  realtimeProtocolVersion: 2,
  identityProofVersion: 1,
  transport: 'read-ticket-resource.v1',
} as const);

export const DesktopChatIdentitySchema = z.strictObject({
  gatewayId: z.uuid(),
  publicKey: z.string().min(80).max(512),
});
export const DesktopChatBootstrapSchema = z.strictObject({
  ok: z.literal(true),
  payload: DesktopChatIdentitySchema.extend({
    manifest: z.strictObject({
      contract: z.literal(DESKTOP_CHAT_MANIFEST.contract),
      realtimeProtocolVersion: z.literal(DESKTOP_CHAT_MANIFEST.realtimeProtocolVersion),
      identityProofVersion: z.literal(1),
      transport: z.literal(DESKTOP_CHAT_MANIFEST.transport),
    }),
  }),
});
export type DesktopChatIdentity = z.infer<typeof DesktopChatIdentitySchema>;
