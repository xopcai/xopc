import { providerOperationIntentSchema, providerOperationReceiptSchema, providerOperationQuerySchema, providerOperationStatusSchema } from './provider-execution.js';
export * from './provider-execution.js';
import { z } from 'zod';

import { DEVICE_EMPTY_INPUT_SCHEMA } from './shared-schemas.js';
import { desktopOperationIntentSchema, desktopOperationReceiptSchema } from './execution.js';
import { desktopTerminalCommandSchema, desktopTerminalEventSchema } from './terminal.js';
import { providerCatalogSchema, providerStateSchema } from './providers.js';
export * from './providers.js';
export * from './execution.js';
export { ENDPOINT_FILE_OUTPUT_SCHEMA, ENDPOINT_CONTACT_RECORD_SCHEMA, ENDPOINT_CONTACT_OUTPUT_SCHEMA, ENDPOINT_CONTACT_LIST_OUTPUT_SCHEMA, DEVICE_EMPTY_INPUT_SCHEMA } from './shared-schemas.js';

export const ENDPOINT_PROTOCOL_VERSION = 3 as const;
export const ENDPOINT_MAX_FILE_BYTES = 25 * 1024 * 1024;
export const ENDPOINT_MAX_ARTIFACT_BYTES = 8 * 1024 * 1024;
export const ENDPOINT_INVOCATION_RECEIPT_TIMEOUT_MS = 3_000;
export const ENDPOINT_MAX_CONCURRENT_INVOCATIONS = 4;

export const endpointKindSchema = z.enum(['web', 'desktop', 'mobile', 'browser', 'bridge']);
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
    source: z.enum(['cli', 'automation', 'heartbeat', 'task', 'internal', 'task_update']),
  }),
]);

export const endpointTurnOriginSchema = turnOriginSchema.options[0];
export const endpointTurnClaimSchema = endpointTurnOriginSchema.extend({ token: turnTokenSchema });

const messageIdSchema = z.uuid();
const timestampSchema = z.number().int().nonnegative();
const jsonObjectSchema = z.record(z.string(), z.unknown());

export const endpointToolDescriptorSchema = z.strictObject({
  name: z.string().regex(/^[A-Za-z0-9_.-]{1,202}$/),
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

export const endpointTaskTargetRequestSchema = z.strictObject({
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
  deviceFrames: z.strictObject({ version: z.literal(1), authorizationRevision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER) }).optional(),
  execution: z.strictObject({ version: z.literal(1), grantId: z.uuid(), authorizationRevision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER), expiresAt: timestampSchema }).optional(),
  terminal: z.strictObject({ version: z.literal(1) }).optional(),
}).superRefine((hello, context) => {
  if (hello.terminal && (hello.kind !== 'desktop' || !hello.execution || !hello.deviceFrames)) {
    context.addIssue({ code: 'custom', path: ['terminal'], message: 'Terminal negotiation requires an independently authenticated durable desktop connection' });
  }
});

export const toolInvokePayloadSchema = z.strictObject({
  invocationId: z.uuid(),
  toolCallId: identifierSchema,
  toolName: endpointToolDescriptorSchema.shape.name,
  arguments: jsonObjectSchema,
  descriptorRevision: z.string().min(1).max(128),
  confirmationRequired: z.boolean(),
  deadlineAt: timestampSchema,
  execution: desktopOperationIntentSchema.optional(),
  operationQuery: desktopOperationIntentSchema.optional(),
  providerExecution: providerOperationIntentSchema.optional(),
  interactionAllowed: z.literal(true).optional(),
  interactionRecoverable: z.literal(true).optional(),
  artifact: z.strictObject({
    token: z.uuid(),
    size: z.number().int().min(0).max(ENDPOINT_MAX_ARTIFACT_BYTES),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
  }).optional(),
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

export const durableEndpointResultSchema = z.strictObject({
  content: z.array(endpointToolContentSchema).min(1).max(20), details: jsonObjectSchema.optional(),
});

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
  'OUTCOME_UNKNOWN',
  'EXECUTION_STOP_UNCONFIRMED',
  'TOOL_EXECUTION_FAILED',
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
  envelope('provider.interaction.request', z.strictObject({ invocationId: z.uuid(), requestId: z.uuid(),
    message: z.string().trim().min(1).max(1000), inputSchema: jsonObjectSchema })),
  envelope('provider.catalog.replace', providerCatalogSchema),
  envelope('provider.state.changed', providerStateSchema),
  envelope('provider.operation.status', providerOperationStatusSchema),
  envelope('terminal.event', z.strictObject({ invocationId: z.uuid(), event: desktopTerminalEventSchema })),
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
    operationReceipt: desktopOperationReceiptSchema.optional(),
    providerReceipt: providerOperationReceiptSchema.optional(),
  })),
  envelope('tool.error', z.strictObject({
    invocationId: z.uuid(),
    code: endpointToolErrorCodeSchema,
    message: z.string().min(1).max(2_000),
    operationReceipt: desktopOperationReceiptSchema.optional(),
    providerReceipt: providerOperationReceiptSchema.optional(),
    operationResult: durableEndpointResultSchema.optional(),
  })),
  envelope('tool.cancelled', invocationPayloadSchema.extend({ operationReceipt: desktopOperationReceiptSchema.optional(), providerReceipt: providerOperationReceiptSchema.optional() })),
]);

export const serverEndpointMessageSchema = z.discriminatedUnion('type', [
  envelope('provider.interaction.response', z.strictObject({ invocationId: z.uuid(), requestId: z.uuid(),
    action: z.enum(['accept', 'decline', 'cancel']), content: jsonObjectSchema.optional() })),
  envelope('provider.catalog.ack', z.discriminatedUnion('accepted', [
    z.strictObject({ revision: z.number().int().nonnegative(), accepted: z.literal(true) }),
    z.strictObject({ revision: z.number().int().nonnegative(), accepted: z.literal(false), code: z.enum([
      'PROVIDER_CATALOG_RATE_LIMITED', 'PROVIDER_CATALOG_REVISION_CONFLICT', 'PROVIDER_CONNECTION_CONFLICT', 'PROVIDER_CATALOG_REJECTED',
    ]) }),
  ])),
  envelope('provider.operation.query', providerOperationQuerySchema),
  envelope('terminal.command', z.strictObject({ invocationId: z.uuid(), command: desktopTerminalCommandSchema })),
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
export type EndpointTaskTargetRequest = z.infer<typeof endpointTaskTargetRequestSchema>;
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

export const DEVICE_STATE_OUTPUT_SCHEMA = {
  type: 'array', minItems: 1, maxItems: 1,
  items: { type: 'object', additionalProperties: false, required: ['type', 'value'], properties: {
    type: { const: 'json' },
    value: { type: 'object', additionalProperties: false, required: ['capturedAt', 'platform', 'systemVersion', 'locale', 'timezone'],
      properties: {
        capturedAt: { type: 'integer', minimum: 0 }, platform: { type: 'string', minLength: 1, maxLength: 40 },
        systemVersion: { type: 'string', maxLength: 80 }, locale: { type: 'string', maxLength: 80 },
        timezone: { type: 'string', maxLength: 80 }, online: { type: 'boolean' },
      } },
  } },
} as const;

export const DEVICE_POWER_OUTPUT_SCHEMA = {
  type: 'array', minItems: 1, maxItems: 1,
  items: { type: 'object', additionalProperties: false, required: ['type', 'value'], properties: {
    type: { const: 'json' },
    value: { type: 'object', additionalProperties: false, required: ['capturedAt', 'levelPercent', 'charging'],
      properties: { capturedAt: { type: 'integer', minimum: 0 },
        levelPercent: { type: ['number', 'null'], minimum: 0, maximum: 100 },
        charging: { type: ['boolean', 'null'] } },
    },
  } },
} as const;

/** Fixed bounded contracts shared by Gateway and native adapters. */
export function deviceStateDescriptor(kind: EndpointKind, capability: 'state' | 'power'): EndpointToolDescriptor {
  return {
    name: `${kind}.device.get_${capability}`,
    title: capability === 'power' ? 'Read this device’s battery' : 'Read this device’s environment',
    description: capability === 'power'
      ? 'Read a fresh battery sample from the device that sent this user message. Unknown readings are null.'
      : 'Read bounded platform, system version, language and timezone from the device that sent this user message. No files, page content, network addresses or identifiers are collected.',
    inputSchema: DEVICE_EMPTY_INPUT_SCHEMA,
    outputSchema: capability === 'power' ? DEVICE_POWER_OUTPUT_SCHEMA : DEVICE_STATE_OUTPUT_SCHEMA,
    policyId: 'public.background-read', sensitivity: 'public', effect: 'read', confirmation: 'never',
    requiresForeground: false, requiredPermissions: [], timeoutMs: 10_000, maxConcurrency: 1,
    supportsCancellation: true, idempotent: true, resultKinds: ['json'],
  };
}

export { locationDescriptor, locationRequestSchema, locationSampleSchema, LOCATION_INPUT_SCHEMA, LOCATION_OUTPUT_SCHEMA, type LocationRequest, type LocationSample } from './location.js';

export { personalDescriptor, PERSONAL_TOOL_NAMES, CONTACT_PICK_INPUT_SCHEMA, CALENDAR_INPUT_SCHEMA, CALENDAR_OUTPUT_SCHEMA, type PersonalToolName } from './personal.js';
export * from './context.js';
export * from './location-sharing.js';
export * from './screen.js';

export * from './operation-status.js';
export * from './workspace.js';
export * from './command.js';
export * from './terminal.js';
