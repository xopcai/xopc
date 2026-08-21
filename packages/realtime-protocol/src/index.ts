import {
  clientEndpointMessageSchema,
  endpointHelloPayloadSchema,
  serverEndpointMessageSchema,
} from '@xopcai/endpoint-tools-protocol';
import { z } from 'zod';

export const REALTIME_PROTOCOL_VERSION = 1 as const;
export const REALTIME_MAX_CLIENT_FRAME_BYTES = 256 * 1024;
export const REALTIME_HELLO_TIMEOUT_MS = 5_000;
export const REALTIME_HEARTBEAT_INTERVAL_MS = 15_000;
export const REALTIME_HEARTBEAT_TIMEOUT_MS = 45_000;

export const realtimeClientKindSchema = z.enum(['web', 'desktop', 'mobile', 'tui', 'mcp']);
export const realtimeTopicSchema = z.string().min(1).max(512);
export const realtimeEventNameSchema = z.string().regex(/^[a-z][a-z0-9_.-]*$/).max(160);

const messageIdSchema = z.uuid();
const timestampSchema = z.number().int().nonnegative();
const sequenceSchema = z.number().int().positive();

const envelope = <TKind extends string, TPayload extends z.ZodType>(
  kind: TKind,
  payload: TPayload,
) => z.strictObject({
  protocolVersion: z.literal(REALTIME_PROTOCOL_VERSION),
  messageId: messageIdSchema,
  kind: z.literal(kind),
  sentAt: timestampSchema,
  payload,
});

export const realtimeSubscriptionSchema = z.strictObject({
  topic: realtimeTopicSchema,
  afterSeq: z.number().int().nonnegative().optional(),
});

export const clientRealtimeMessageSchema = z.discriminatedUnion('kind', [
  envelope('realtime.hello', z.strictObject({
    ticket: z.string().min(32).max(512),
    clientId: z.string().min(1).max(160),
    clientKind: realtimeClientKindSchema,
    subscriptions: z.array(realtimeSubscriptionSchema).max(100).default([]),
    endpoint: endpointHelloPayloadSchema.optional(),
  })),
  envelope('realtime.subscribe', z.strictObject({
    subscriptions: z.array(realtimeSubscriptionSchema).min(1).max(100),
  })),
  envelope('realtime.unsubscribe', z.strictObject({
    topics: z.array(realtimeTopicSchema).min(1).max(100),
  })),
  envelope('realtime.ping', z.strictObject({})),
  envelope('endpoint.message', clientEndpointMessageSchema),
]);

export const realtimeEventPayloadSchema = z.strictObject({
  topic: realtimeTopicSchema,
  seq: sequenceSchema,
  event: realtimeEventNameSchema,
  data: z.unknown(),
});

export const serverRealtimeMessageSchema = z.discriminatedUnion('kind', [
  envelope('realtime.ready', z.strictObject({
    connectionId: z.uuid(),
    heartbeatIntervalMs: z.literal(REALTIME_HEARTBEAT_INTERVAL_MS),
    heartbeatTimeoutMs: z.literal(REALTIME_HEARTBEAT_TIMEOUT_MS),
    endpoint: z.strictObject({
      endpointId: z.string().min(1).max(160),
      turnToken: z.string().min(32).max(160),
    }).optional(),
  })),
  envelope('realtime.event', realtimeEventPayloadSchema),
  envelope('realtime.gap', z.strictObject({
    topic: realtimeTopicSchema,
    requestedSeq: z.number().int().nonnegative(),
    earliestSeq: sequenceSchema,
  })),
  envelope('realtime.pong', z.strictObject({})),
  envelope('realtime.error', z.strictObject({
    code: z.string().min(1).max(80),
    message: z.string().min(1).max(500),
  })),
  envelope('endpoint.message', serverEndpointMessageSchema),
]);

export type RealtimeClientKind = z.infer<typeof realtimeClientKindSchema>;
export type RealtimeSubscription = z.infer<typeof realtimeSubscriptionSchema>;
export type ClientRealtimeMessage = z.infer<typeof clientRealtimeMessageSchema>;
export type ServerRealtimeMessage = z.infer<typeof serverRealtimeMessageSchema>;
export type RealtimeEventPayload = z.infer<typeof realtimeEventPayloadSchema>;

export function parseClientRealtimeMessage(value: unknown): ClientRealtimeMessage {
  return clientRealtimeMessageSchema.parse(value);
}

export function parseServerRealtimeMessage(value: unknown): ServerRealtimeMessage {
  return serverRealtimeMessageSchema.parse(value);
}

export function parseClientRealtimeJsonFrame(text: string): unknown {
  const bytes = new TextEncoder().encode(text).byteLength;
  if (bytes > REALTIME_MAX_CLIENT_FRAME_BYTES) {
    throw new Error(`Realtime client frame exceeds ${REALTIME_MAX_CLIENT_FRAME_BYTES} bytes`);
  }
  return JSON.parse(text) as unknown;
}
