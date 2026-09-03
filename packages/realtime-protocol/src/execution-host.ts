import { z } from 'zod';

export const EXECUTION_HOST_PROTOCOL_VERSION = 1 as const;
export const EXECUTION_HOST_MAX_COMMAND_DURATION_MS = 4 * 60 * 60_000;

const identifierSchema = z.string().min(1).max(160);
const signatureFields = {
  nonce: z.string().min(16).max(160),
  signedAt: z.number().int().nonnegative(),
  signature: z.string().min(32).max(512),
};

export const executionHostCapabilitiesSchema = z.strictObject({
  git: z.boolean(),
  shell: z.boolean(),
  search: z.boolean(),
  patch: z.boolean(),
  snapshots: z.boolean().default(false),
});

export const executionHostRegistrationSchema = z.strictObject({
  hostId: identifierSchema,
  displayName: z.string().min(1).max(160),
  platform: z.string().min(1).max(80),
  arch: z.string().min(1).max(80),
  appVersion: z.string().min(1).max(80),
  publicKey: z.string().min(32).max(4096),
  capabilities: executionHostCapabilitiesSchema,
  maxConcurrency: z.number().int().min(1).max(64),
});

export const executionHostTicketRequestSchema = z.strictObject({
  hostId: identifierSchema,
  ...signatureFields,
});

export const executionHostHelloPayloadSchema = z.strictObject({
  protocolVersion: z.literal(EXECUTION_HOST_PROTOCOL_VERSION),
  hostId: identifierSchema,
  platform: z.string().min(1).max(80),
  arch: z.string().min(1).max(80),
  appVersion: z.string().min(1).max(80),
  capabilities: executionHostCapabilitiesSchema,
  maxConcurrency: z.number().int().min(1).max(64),
  ...signatureFields,
});

export const executionCommandNameSchema = z.enum([
  'environment.provision',
  'environment.inspect',
  'environment.remove',
  'workspace.execute_tool',
  'environment.snapshot',
]);

export const executionCommandSchema = z.strictObject({
  operationId: z.uuid(),
  environmentId: z.string().min(1).max(160),
  bindingEpoch: z.number().int().nonnegative(),
  deadlineAt: z.number().int().positive(),
  idempotencyKey: z.string().min(1).max(200),
  command: executionCommandNameSchema,
  payload: z.unknown(),
});

export const clientExecutionHostMessageSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('execution.accepted'), operationId: z.uuid() }),
  z.strictObject({
    type: z.literal('execution.progress'),
    operationId: z.uuid(),
    sequence: z.number().int().positive(),
    payload: z.unknown(),
  }),
  z.strictObject({
    type: z.literal('execution.result'),
    operationId: z.uuid(),
    result: z.unknown(),
  }),
  z.strictObject({
    type: z.literal('execution.error'),
    operationId: z.uuid(),
    code: z.string().min(1).max(80),
    message: z.string().min(1).max(1000),
    retryable: z.boolean(),
  }),
]);

export const serverExecutionHostMessageSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('execution.command'), command: executionCommandSchema }),
  z.strictObject({
    type: z.literal('execution.cancel'),
    operationId: z.uuid(),
    reason: z.string().min(1).max(500),
  }),
]);

export type ExecutionHostCapabilities = z.infer<typeof executionHostCapabilitiesSchema>;
export type ExecutionHostRegistration = z.infer<typeof executionHostRegistrationSchema>;
export type ExecutionHostTicketRequest = z.infer<typeof executionHostTicketRequestSchema>;
export type ExecutionHostHelloPayload = z.infer<typeof executionHostHelloPayloadSchema>;
export type ExecutionCommand = z.infer<typeof executionCommandSchema>;
export type ClientExecutionHostMessage = z.infer<typeof clientExecutionHostMessageSchema>;
export type ServerExecutionHostMessage = z.infer<typeof serverExecutionHostMessageSchema>;

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, entry]) => [key, sortValue(entry)]),
  );
}

function canonical(value: Record<string, unknown>): string {
  return JSON.stringify(sortValue(value));
}

export function executionHostTicketSigningPayload(payload: ExecutionHostTicketRequest): string {
  return canonical({
    purpose: 'execution-host-ticket',
    hostId: payload.hostId,
    nonce: payload.nonce,
    signedAt: payload.signedAt,
  });
}

export function executionHostHelloSigningPayload(payload: ExecutionHostHelloPayload): string {
  return canonical({
    purpose: 'execution-host-hello',
    protocolVersion: payload.protocolVersion,
    hostId: payload.hostId,
    platform: payload.platform,
    arch: payload.arch,
    appVersion: payload.appVersion,
    capabilities: payload.capabilities,
    maxConcurrency: payload.maxConcurrency,
    nonce: payload.nonce,
    signedAt: payload.signedAt,
  });
}
