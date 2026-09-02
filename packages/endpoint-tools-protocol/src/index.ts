import { z } from 'zod';

export const ENDPOINT_PROTOCOL_VERSION = 2 as const;
export const ENDPOINT_MAX_FILE_BYTES = 25 * 1024 * 1024;
export const ENDPOINT_INVOCATION_RECEIPT_TIMEOUT_MS = 3_000;
export const ENDPOINT_MAX_CONCURRENT_INVOCATIONS = 4;

export const endpointKindSchema = z.enum(['web', 'desktop', 'mobile']);
export const endpointAvailabilitySchema = z.enum(['foreground', 'background']);
export const endpointEffectSchema = z.enum(['read', 'write', 'destructive']);
export const endpointConfirmationSchema = z.enum(['never', 'always']);
export const endpointResultKindSchema = z.enum(['text', 'json', 'file']);
export const endpointSensitivitySchema = z.enum(['public', 'personal']);

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
  outputSchema: jsonObjectSchema,
  policyId: z.string().regex(/^[a-z][a-z0-9_.-]+$/).max(120),
  sensitivity: endpointSensitivitySchema,
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

export const endpointSessionBindingRequestSchema = z.strictObject({
  endpointId: identifierSchema,
});

const backgroundCapabilitySchema = z.string()
  .regex(/^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)+$/)
  .max(120);

export const endpointDeviceJobRequestSchema = z.strictObject({
  jobId: z.uuid(),
  endpointId: identifierSchema,
  capability: backgroundCapabilitySchema,
  input: jsonObjectSchema,
  idempotencyKey: identifierSchema,
  consentGrantId: identifierSchema,
  createdAt: timestampSchema,
  expiresAt: timestampSchema,
});

export const endpointDeviceJobStatusSchema = z.strictObject({
  jobId: z.uuid(),
  status: z.enum(['queued', 'running', 'succeeded', 'failed', 'cancelled']),
  updatedAt: timestampSchema,
  output: jsonObjectSchema.optional(),
  error: z.strictObject({
    code: identifierSchema,
    message: z.string().min(1).max(2_000),
  }).optional(),
});

export const endpointDeviceEventSchema = z.strictObject({
  eventId: z.uuid(),
  endpointId: identifierSchema,
  subscriptionId: identifierSchema,
  eventType: backgroundCapabilitySchema,
  data: jsonObjectSchema,
  occurredAt: timestampSchema,
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
  envelope('tool.invoke', toolInvokePayloadSchema),
  envelope('tool.cancel', toolCancelPayloadSchema),
]);

export type EndpointKind = z.infer<typeof endpointKindSchema>;
export type EndpointAvailability = z.infer<typeof endpointAvailabilitySchema>;
export type EndpointEffect = z.infer<typeof endpointEffectSchema>;
export type EndpointResultKind = z.infer<typeof endpointResultKindSchema>;
export type EndpointSensitivity = z.infer<typeof endpointSensitivitySchema>;
export type EndpointToolDescriptor = z.infer<typeof endpointToolDescriptorSchema>;
export type EndpointPrincipalRegistration = z.infer<typeof endpointPrincipalRegistrationSchema>;
export type EndpointSessionBindingRequest = z.infer<typeof endpointSessionBindingRequestSchema>;
export type EndpointDeviceJobRequest = z.infer<typeof endpointDeviceJobRequestSchema>;
export type EndpointDeviceJobStatus = z.infer<typeof endpointDeviceJobStatusSchema>;
export type EndpointDeviceEvent = z.infer<typeof endpointDeviceEventSchema>;
export type EndpointHelloPayload = z.infer<typeof endpointHelloPayloadSchema>;
export type ClientEndpointMessage = z.infer<typeof clientEndpointMessageSchema>;
export type ServerEndpointMessage = z.infer<typeof serverEndpointMessageSchema>;
export type EndpointToolContent = z.infer<typeof endpointToolContentSchema>;
export type EndpointToolErrorCode = z.infer<typeof endpointToolErrorCodeSchema>;
export type TurnOrigin = z.infer<typeof turnOriginSchema>;
export type EndpointTurnOrigin = z.infer<typeof endpointTurnOriginSchema>;
export type EndpointTurnClaim = z.infer<typeof endpointTurnClaimSchema>;

export const ENDPOINT_TEXT_OUTPUT_SCHEMA = {
  type: 'array',
  minItems: 1,
  maxItems: 20,
  items: {
    type: 'object',
    additionalProperties: false,
    required: ['type', 'text'],
    properties: {
      type: { const: 'text' },
      text: { type: 'string', maxLength: 256 * 1024 },
    },
  },
} as const;

export const ENDPOINT_FILE_OUTPUT_SCHEMA = {
  type: 'array',
  minItems: 1,
  maxItems: 20,
  items: {
    type: 'object',
    additionalProperties: false,
    required: ['type', 'fileId', 'name', 'mimeType', 'size', 'sha256'],
    properties: {
      type: { const: 'file' },
      fileId: { type: 'string', minLength: 1, maxLength: 160 },
      name: { type: 'string', minLength: 1, maxLength: 255 },
      mimeType: { type: 'string', minLength: 1, maxLength: 255 },
      size: { type: 'integer', minimum: 0 },
      sha256: { type: 'string', pattern: '^[a-f0-9]{64}$' },
    },
  },
} as const;

export const ENDPOINT_CONTACT_RECORD_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'name', 'phones', 'emails'],
  properties: {
    id: { type: 'string', minLength: 1, maxLength: 512 },
    name: { type: 'string', minLength: 1, maxLength: 500 },
    phones: { type: 'array', maxItems: 20, items: { type: 'string', maxLength: 100 } },
    emails: { type: 'array', maxItems: 20, items: { type: 'string', maxLength: 320 } },
  },
} as const;

function contactOutputSchema(multiple: boolean) {
  return {
    type: 'array',
    minItems: 1,
    maxItems: 1,
    items: {
      type: 'object',
      additionalProperties: false,
      required: ['type', 'value'],
      properties: {
        type: { const: 'json' },
        value: multiple
          ? { type: 'array', maxItems: 20, items: ENDPOINT_CONTACT_RECORD_SCHEMA }
          : ENDPOINT_CONTACT_RECORD_SCHEMA,
      },
    },
  } as const;
}

export const ENDPOINT_CONTACT_OUTPUT_SCHEMA = contactOutputSchema(false);
export const ENDPOINT_CONTACT_LIST_OUTPUT_SCHEMA = contactOutputSchema(true);

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
