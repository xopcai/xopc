import { z } from 'zod';

export const BROWSER_PREVIEW_CAPABILITY = 'browser.preview.v1' as const;
export const BROWSER_PREVIEW_LEASE_MS = 10_000;
export const BROWSER_PREVIEW_REQUEST_MS = 60_000;

const requestId = z.uuid();
const conversationId = z.uuid();
const origin = z.url().refine(value => {
  const url = new URL(value);
  return (url.protocol === 'https:' || url.protocol === 'http:') && url.origin === value;
});
const ice = z.strictObject({
  iceServers: z.array(z.strictObject({
    urls: z.array(z.string().max(512)).min(1).max(8), username: z.string().max(128), credential: z.string().max(128),
  })).max(1),
  iceTransportPolicy: z.enum(['all', 'relay']),
});
const quality = z.enum(['normal', 'low', 'snapshot']);
const signal = z.discriminatedUnion('type', [
  z.strictObject({ type: z.enum(['offer', 'answer']), sdp: z.string().min(1).max(32_768) }),
  z.strictObject({
    type: z.literal('candidate'),
    candidate: z.string().max(4096),
    sdpMid: z.string().max(128).nullable().optional(),
    sdpMLineIndex: z.number().int().min(0).max(16).nullable().optional(),
    usernameFragment: z.string().max(256).nullable().optional(),
  }),
]);

export const browserPreviewClientSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('view'), requestId, conversationId }),
  z.strictObject({ type: z.literal('accept'), requestId }),
  z.strictObject({ type: z.literal('renew'), requestId }),
  z.strictObject({ type: z.literal('close'), requestId }),
  z.strictObject({ type: z.literal('quality'), requestId, quality }),
  z.strictObject({ type: z.literal('signal'), requestId, signal }),
]);

export const browserPreviewServerSchema = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal('requested'), requestId, conversationId, origin,
    tabId: z.number().int().min(0), browserSessionId: z.uuid(),
    viewer: z.string().min(1).max(160),
  }),
  z.strictObject({ type: z.literal('waiting'), requestId, origin }),
  z.strictObject({ type: z.literal('accepted'), requestId, ice: ice.optional() }),
  z.strictObject({ type: z.literal('quality'), requestId, quality, snapshotToken: z.uuid().optional() }),
  z.strictObject({ type: z.literal('lease'), requestId }),
  z.strictObject({ type: z.literal('signal'), requestId, signal }),
  z.strictObject({
    type: z.literal('closed'), requestId,
    reason: z.enum(['unavailable', 'ended', 'expired', 'busy']),
  }),
]);

export type BrowserPreviewClientMessage = z.infer<typeof browserPreviewClientSchema>;
export type BrowserPreviewServerMessage = z.infer<typeof browserPreviewServerSchema>;
export type BrowserPreviewSignal = z.infer<typeof signal>;

export type BrowserPreviewIce = z.infer<typeof ice>;
export type BrowserPreviewQuality = z.infer<typeof quality>;
