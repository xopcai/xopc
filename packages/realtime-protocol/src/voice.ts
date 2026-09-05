import { z } from 'zod';
export { encodeVoiceAudioFrame, decodeVoiceAudioFrame } from './voice-audio.js';

export const VOICE_REALTIME_PROTOCOL_VERSION = 2 as const;
export const VOICE_REALTIME_WS_PATH = '/api/voice/realtime/v2/ws' as const;
export const VOICE_REALTIME_MAX_BINARY_FRAME_BYTES = 64 * 1024;
export const VOICE_REALTIME_START_TIMEOUT_MS = 10_000;
export const VOICE_REALTIME_HEARTBEAT_INTERVAL_MS = 15_000;

const idSchema = z.uuid();
const timestampSchema = z.number().int().nonnegative();

export const voicePurposeSchema = z.enum(['dictation', 'conversation']);
export const voiceEngineSchema = z.enum(['agent', 'omni']);
export const voiceInputModeSchema = z.literal('server_vad');
export const voiceLanguageSchema = z.enum(['zh', 'en']);
export const voicePcmFormatSchema = z.strictObject({
  encoding: z.literal('pcm_s16le'),
  sampleRate: z.union([z.literal(16_000), z.literal(24_000)]),
  channels: z.literal(1),
});

export const voiceProviderRouteSchema = z.strictObject({
  provider: z.string().min(1).max(100),
  model: z.string().min(1).max(200),
  managed: z.boolean(),
});

export const voiceRouteSchema = z.discriminatedUnion('engine', [
  z.strictObject({ engine: z.literal('dictation'), stt: voiceProviderRouteSchema }),
  z.strictObject({ engine: z.literal('agent'), stt: voiceProviderRouteSchema, tts: voiceProviderRouteSchema }),
  z.strictObject({ engine: z.literal('omni'), omni: voiceProviderRouteSchema }),
]);

const availabilitySchema = z.strictObject({
  available: z.boolean(),
  reasonCode: z.enum(['VOICE_DISABLED', 'PROVIDER_UNAVAILABLE']).optional(),
});

export const realtimeVoiceStatusSchema = z.object({
  enabled: z.boolean(),
  defaultEngine: voiceEngineSchema,
  omni: voiceProviderRouteSchema.nullable(),
  stt: voiceProviderRouteSchema.nullable(),
  tts: voiceProviderRouteSchema.extend({ voice: z.string().optional() }).nullable(),
  capabilities: z.strictObject({
    dictation: availabilitySchema,
    agent: availabilitySchema,
    omni: availabilitySchema,
    languages: z.array(voiceLanguageSchema),
    bargeIn: z.boolean(),
  }),
});
export type RealtimeVoiceStatus = z.infer<typeof realtimeVoiceStatusSchema>;

export const createVoiceSessionRequestSchema = z.strictObject({
  purpose: voicePurposeSchema,
  engine: voiceEngineSchema.optional(),
  sessionKey: z.string().min(1).max(512).optional(),
  language: voiceLanguageSchema.optional(),
}).superRefine((value, context) => {
  if (value.purpose === 'conversation' && !value.sessionKey) {
    context.addIssue({ code: 'custom', path: ['sessionKey'], message: 'sessionKey is required for conversation' });
  }
  if (value.purpose !== 'conversation' && value.engine !== undefined) {
    context.addIssue({ code: 'custom', path: ['engine'], message: 'engine is only supported for conversation' });
  }
});

export const createVoiceSessionResponseSchema = z.strictObject({
  sessionId: idSchema,
  ticket: z.string().min(32).max(512),
  ticketExpiresAt: z.iso.datetime(),
  websocketPath: z.literal(VOICE_REALTIME_WS_PATH),
  protocolVersion: z.literal(VOICE_REALTIME_PROTOCOL_VERSION),
  purpose: voicePurposeSchema,
  inputMode: voiceInputModeSchema,
  bargeIn: z.boolean(),
  inputFormat: voicePcmFormatSchema,
  limits: z.strictObject({
    maxBinaryFrameBytes: z.literal(VOICE_REALTIME_MAX_BINARY_FRAME_BYTES),
    maxSessionMs: z.number().int().positive(),
    idleTimeoutMs: z.number().int().positive(),
  }),
  route: voiceRouteSchema,
});

const clientEnvelope = <TType extends string, TPayload extends z.ZodType>(
  type: TType,
  payload: TPayload,
) => z.strictObject({
  protocolVersion: z.literal(VOICE_REALTIME_PROTOCOL_VERSION),
  messageId: idSchema,
  type: z.literal(type),
  sentAt: timestampSchema,
  payload,
});

export const voiceClientMessageSchema = z.discriminatedUnion('type', [
  clientEnvelope('session.start', z.strictObject({
    sessionId: idSchema,
    ticket: z.string().min(32).max(512),
  })),
  clientEnvelope('session.metric', z.strictObject({
    responseId: z.string().min(1).max(160),
    metric: z.enum(['speech_end_to_audio_received', 'local_stop']),
    durationMs: z.number().finite().min(0).max(600_000),
  })),
  clientEnvelope('input.mute', z.strictObject({ muted: z.boolean() })),
  clientEnvelope('input.commit', z.strictObject({})),
  clientEnvelope('response.cancel', z.strictObject({ responseId: z.string().min(1).max(160) })),
  clientEnvelope('response.audio.played', z.strictObject({
    responseId: z.string().min(1).max(160),
    playedBytes: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).multipleOf(2),
  })),
  clientEnvelope('session.stop', z.strictObject({
    reason: z.enum(['user_finished', 'surface_closed', 'replaced']),
  })),
  clientEnvelope('session.ping', z.strictObject({})),
]);

const transcriptPayloadSchema = z.strictObject({
  utteranceId: z.string().min(1).max(160),
  revision: z.number().int().positive(),
  text: z.string().max(32 * 1024),
  language: voiceLanguageSchema.optional(),
});

const serverEnvelope = <TType extends string, TPayload extends z.ZodType>(
  type: TType,
  payload: TPayload,
) => z.strictObject({
  protocolVersion: z.literal(VOICE_REALTIME_PROTOCOL_VERSION),
  eventId: idSchema,
  seq: z.number().int().positive(),
  type: z.literal(type),
  sentAt: timestampSchema,
  sessionId: idSchema,
  payload,
});

export const voiceServerEventSchema = z.discriminatedUnion('type', [
  serverEnvelope('session.ready', z.strictObject({
    purpose: voicePurposeSchema,
    inputMode: voiceInputModeSchema,
    inputFormat: voicePcmFormatSchema,
    route: voiceRouteSchema,
    heartbeatIntervalMs: z.literal(VOICE_REALTIME_HEARTBEAT_INTERVAL_MS),
  })),
  serverEnvelope('input.speech_started', z.strictObject({ utteranceId: z.string().min(1).max(160) })),
  serverEnvelope('input.speech_stopped', z.strictObject({ utteranceId: z.string().min(1).max(160) })),
  serverEnvelope('input.transcript.delta', transcriptPayloadSchema),
  serverEnvelope('input.transcript.final', transcriptPayloadSchema),
  serverEnvelope('response.created', z.strictObject({ responseId: z.string().min(1).max(160) })),
  serverEnvelope('response.activity', z.strictObject({
    responseId: z.string().min(1).max(160),
    toolCallId: z.string().min(1).max(160),
    toolName: z.string().min(1).max(256),
    status: z.enum(['running', 'completed', 'failed']),
  })),
  serverEnvelope('response.clarification', z.strictObject({
    responseId: z.string().min(1).max(160),
    requestId: z.string().min(1).max(160),
    question: z.string().min(1).max(8_000),
    choices: z.array(z.string().max(1_000)).max(20).optional(),
  })),
  serverEnvelope('response.text.delta', z.strictObject({
    responseId: z.string().min(1).max(160),
    delta: z.string().max(32 * 1024),
  })),
  serverEnvelope('response.text.done', z.strictObject({
    responseId: z.string().min(1).max(160),
  })),
  serverEnvelope('response.audio.started', z.strictObject({
    responseId: z.string().min(1).max(160),
    format: voicePcmFormatSchema,
  })),
  serverEnvelope('response.audio.done', z.strictObject({ responseId: z.string().min(1).max(160) })),
  serverEnvelope('response.done', z.strictObject({
    responseId: z.string().min(1).max(160),
    finishReason: z.enum(['completed', 'text_only', 'audio_partial']),
    audio: z.boolean(),
  })),
  serverEnvelope('response.cancelled', z.strictObject({
    responseId: z.string().min(1).max(160),
    reason: z.enum(['barge_in', 'client_cancelled', 'session_closed']),
  })),
  serverEnvelope('session.pong', z.strictObject({})),
  serverEnvelope('session.error', z.strictObject({
    code: z.string().min(1).max(80),
    message: z.string().min(1).max(500),
    recoverable: z.boolean(),
  })),
  serverEnvelope('session.closed', z.strictObject({ reason: z.string().min(1).max(160) })),
]);

export type VoicePurpose = z.infer<typeof voicePurposeSchema>;
export type VoiceInputMode = z.infer<typeof voiceInputModeSchema>;
export type VoiceLanguage = z.infer<typeof voiceLanguageSchema>;
export type VoicePcmFormat = z.infer<typeof voicePcmFormatSchema>;
export type VoiceProviderRoute = z.infer<typeof voiceProviderRouteSchema>;
export type VoiceRoute = z.infer<typeof voiceRouteSchema>;
export type CreateVoiceSessionRequest = z.infer<typeof createVoiceSessionRequestSchema>;
export type CreateVoiceSessionResponse = z.infer<typeof createVoiceSessionResponseSchema>;
export type VoiceClientMessage = z.infer<typeof voiceClientMessageSchema>;
export type VoiceServerEvent = z.infer<typeof voiceServerEventSchema>;

export function parseVoiceClientMessage(value: unknown): VoiceClientMessage {
  return voiceClientMessageSchema.parse(value);
}

export function parseVoiceServerEvent(value: unknown): VoiceServerEvent {
  return voiceServerEventSchema.parse(value);
}

export function parseVoiceClientJsonFrame(text: string): unknown {
  if (new TextEncoder().encode(text).byteLength > 16 * 1024) {
    throw new Error('Voice control frame exceeds 16384 bytes');
  }
  return JSON.parse(text) as unknown;
}
