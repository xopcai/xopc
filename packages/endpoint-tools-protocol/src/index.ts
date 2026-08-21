import { z } from 'zod';

export const ENDPOINT_PROTOCOL_VERSION = 1 as const;
export const ENDPOINT_MAX_JSON_FRAME_BYTES = 256 * 1024;
export const ENDPOINT_HELLO_TIMEOUT_MS = 5_000;
export const ENDPOINT_HEARTBEAT_INTERVAL_MS = 15_000;
export const ENDPOINT_HEARTBEAT_TIMEOUT_MS = 45_000;
export const ENDPOINT_INVOCATION_RECEIPT_TIMEOUT_MS = 3_000;
export const ENDPOINT_MAX_CONCURRENT_INVOCATIONS = 4;

export const endpointKindSchema = z.enum(['web', 'desktop', 'mobile']);
export const endpointAvailabilitySchema = z.enum(['foreground', 'background']);
export const endpointEffectSchema = z.enum(['read', 'write', 'destructive']);
export const endpointConfirmationSchema = z.enum(['never', 'always']);
export const endpointResultKindSchema = z.enum(['text', 'json', 'file']);

const identifierSchema = z.string().min(1).max(160);
const turnTokenSchema = z.string().min(32).max(160).regex(/^[A-Za-z0-9_-]+$/);

export const turnOriginSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('endpoint'), endpointId: identifierSchema }),
  z.strictObject({ type: z.literal('channel'), channel: z.string().min(1).max(64) }),
  z.strictObject({
    type: z.literal('system'),
    source: z.enum(['cli', 'automation', 'heartbeat', 'workflow', 'internal']),
  }),
]);

export const endpointTurnOriginSchema = turnOriginSchema.options[0];
export const endpointTurnClaimSchema = endpointTurnOriginSchema.extend({ token: turnTokenSchema });

const messageIdSchema = z.uuid();
const timestampSchema = z.number().int().nonnegative();
const jsonObjectSchema = z.record(z.string(), z.unknown());

export const endpointToolDescriptorSchema = z.strictObject({
  name: z.string().regex(/^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)+$/).max(120),
  title: z.string().min(1).max(120),
  description: z.string().min(1).max(2_000),
  inputSchema: jsonObjectSchema,
  effect: endpointEffectSchema,
  confirmation: endpointConfirmationSchema,
  requiresForeground: z.boolean(),
  requiredPermissions: z.array(z.string().min(1).max(120)).max(20),
  timeoutMs: z.number().int().min(1_000).max(300_000),
  maxConcurrency: z.number().int().min(1).max(4),
  supportsCancellation: z.boolean(),
  idempotent: z.boolean(),
  resultKinds: z.array(endpointResultKindSchema).min(1).max(3),
});

export const endpointPrincipalRegistrationSchema = z.strictObject({
  principalId: identifierSchema,
  displayName: z.string().min(1).max(120),
  kind: endpointKindSchema,
  platform: z.string().min(1).max(80),
  publicKey: z.string().min(32).max(2_048),
});

export const endpointHelloPayloadSchema = z.strictObject({
  principalId: identifierSchema,
  endpointId: identifierSchema,
  connectionInstanceId: z.uuid(),
  displayName: z.string().min(1).max(120),
  kind: endpointKindSchema,
  platform: z.string().min(1).max(80),
  appVersion: z.string().min(1).max(80),
  availability: endpointAvailabilitySchema,
  nonce: identifierSchema,
  signedAt: timestampSchema,
  signature: z.string().min(16).max(1_024),
  tools: z.array(endpointToolDescriptorSchema).max(100),
});

export const endpointReadyPayloadSchema = z.strictObject({
  connectionId: z.uuid(),
  turnToken: turnTokenSchema,
  heartbeatIntervalMs: z.literal(ENDPOINT_HEARTBEAT_INTERVAL_MS),
  heartbeatTimeoutMs: z.literal(ENDPOINT_HEARTBEAT_TIMEOUT_MS),
  maxConcurrentInvocations: z.literal(ENDPOINT_MAX_CONCURRENT_INVOCATIONS),
});

export const toolInvokePayloadSchema = z.strictObject({
  invocationId: z.uuid(),
  toolCallId: identifierSchema,
  toolName: endpointToolDescriptorSchema.shape.name,
  arguments: jsonObjectSchema,
  descriptorRevision: z.string().min(1).max(128),
  confirmationRequired: z.boolean(),
  deadlineAt: timestampSchema,
  uploadGrant: z.strictObject({
    path: z.string().startsWith('/').max(500),
    token: identifierSchema,
    maxBytes: z.number().int().positive(),
    maxFiles: z.number().int().min(1).max(20),
    expiresAt: timestampSchema,
  }).optional(),
});

export const toolCancelPayloadSchema = z.strictObject({
  invocationId: z.uuid(),
  reason: z.string().min(1).max(500),
});

const invocationPayloadSchema = z.strictObject({ invocationId: z.uuid() });

export const endpointToolContentSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('text'), text: z.string().max(256 * 1024) }),
  z.strictObject({ type: z.literal('json'), value: z.unknown() }),
  z.strictObject({
    type: z.literal('file'),
    fileId: identifierSchema,
    name: z.string().min(1).max(255),
    mimeType: z.string().min(1).max(255),
    size: z.number().int().nonnegative(),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
  }),
]);

export const endpointToolErrorCodeSchema = z.enum([
  'ENDPOINT_OFFLINE',
  'ENDPOINT_NOT_FOREGROUND',
  'ENDPOINT_DISCONNECTED',
  'TOOL_NOT_FOUND',
  'TOOL_REVISION_MISMATCH',
  'INVALID_ARGUMENTS',
  'PERMISSION_DENIED',
  'USER_DENIED',
  'TOOL_BUSY',
  'TOOL_TIMEOUT',
  'TOOL_CANCELLED',
  'RESULT_TOO_LARGE',
  'PROTOCOL_ERROR',
]);

const envelope = <TType extends string, TPayload extends z.ZodType>(
  type: TType,
  payload: TPayload,
) => z.strictObject({
  protocolVersion: z.literal(ENDPOINT_PROTOCOL_VERSION),
  messageId: messageIdSchema,
  type: z.literal(type),
  sentAt: timestampSchema,
  payload,
});

export const clientEndpointMessageSchema = z.discriminatedUnion('type', [
  envelope('endpoint.hello', endpointHelloPayloadSchema),
  envelope('endpoint.heartbeat', z.strictObject({ availability: endpointAvailabilitySchema })),
  envelope('endpoint.availability_changed', z.strictObject({ availability: endpointAvailabilitySchema })),
  envelope('tool.received', invocationPayloadSchema),
  envelope('tool.progress', z.strictObject({
    invocationId: z.uuid(),
    message: z.string().max(500).optional(),
    percent: z.number().min(0).max(100).optional(),
  })),
  envelope('tool.result', z.strictObject({
    invocationId: z.uuid(),
    content: z.array(endpointToolContentSchema).min(1).max(20),
    details: jsonObjectSchema.optional(),
  })),
  envelope('tool.error', z.strictObject({
    invocationId: z.uuid(),
    code: endpointToolErrorCodeSchema,
    message: z.string().min(1).max(2_000),
  })),
  envelope('tool.cancelled', invocationPayloadSchema),
]);

export const serverEndpointMessageSchema = z.discriminatedUnion('type', [
  envelope('endpoint.ready', endpointReadyPayloadSchema),
  envelope('tool.invoke', toolInvokePayloadSchema),
  envelope('tool.cancel', toolCancelPayloadSchema),
]);

export type EndpointKind = z.infer<typeof endpointKindSchema>;
export type EndpointAvailability = z.infer<typeof endpointAvailabilitySchema>;
export type EndpointEffect = z.infer<typeof endpointEffectSchema>;
export type EndpointToolDescriptor = z.infer<typeof endpointToolDescriptorSchema>;
export type EndpointPrincipalRegistration = z.infer<typeof endpointPrincipalRegistrationSchema>;
export type EndpointHelloPayload = z.infer<typeof endpointHelloPayloadSchema>;
export type ClientEndpointMessage = z.infer<typeof clientEndpointMessageSchema>;
export type ServerEndpointMessage = z.infer<typeof serverEndpointMessageSchema>;
export type EndpointToolContent = z.infer<typeof endpointToolContentSchema>;
export type EndpointToolErrorCode = z.infer<typeof endpointToolErrorCodeSchema>;
export type TurnOrigin = z.infer<typeof turnOriginSchema>;
export type EndpointTurnOrigin = z.infer<typeof endpointTurnOriginSchema>;
export type EndpointTurnClaim = z.infer<typeof endpointTurnClaimSchema>;

export function parseClientEndpointMessage(value: unknown): ClientEndpointMessage {
  return clientEndpointMessageSchema.parse(value);
}

export function parseServerEndpointMessage(value: unknown): ServerEndpointMessage {
  return serverEndpointMessageSchema.parse(value);
}

export function parseJsonFrame(text: string): unknown {
  const bytes = new TextEncoder().encode(text).byteLength;
  if (bytes > ENDPOINT_MAX_JSON_FRAME_BYTES) {
    throw new Error(`Endpoint frame exceeds ${ENDPOINT_MAX_JSON_FRAME_BYTES} bytes`);
  }
  return JSON.parse(text) as unknown;
}

export function canonicalJson(value: unknown): string {
  if (value === null) return 'null';
  if (typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('Canonical JSON only supports finite numbers');
    return JSON.stringify(value);
  }
  if (typeof value !== 'object') throw new Error(`Canonical JSON does not support ${typeof value}`);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new Error('Canonical JSON only supports plain objects');
  }
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    .join(',')}}`;
}

export function endpointHelloSigningPayload(payload: EndpointHelloPayload): string {
  const { signature: _signature, ...unsigned } = payload;
  return canonicalJson(unsigned);
}
