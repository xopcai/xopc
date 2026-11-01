import { z } from 'zod';

const digest = z.string().regex(/^[a-f0-9]{64}$/);
const timestamp = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);

// Keep this property order stable: installed journals hash the parsed intent.
export const desktopOperationIntentSchema = z.strictObject({
  operationId: z.uuid(), gatewayId: z.uuid(), deviceId: z.uuid(), workspaceId: z.uuid().optional(),
  tool: z.string().min(1).max(128).regex(/^[a-zA-Z0-9_.-]+$/), argumentHash: digest,
  toolRevision: digest, authorizationRevision: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  expiresAt: timestamp,
});

export const desktopOperationAttemptSchema = z.strictObject({ invocationId: z.uuid(), connectionInstanceId: z.uuid() });
export const desktopExecutionRequestSchema = z.strictObject({
  invocationId: z.uuid(), toolCallId: z.string().min(1).max(160),
  toolName: z.string().min(1).max(128), arguments: z.record(z.string(), z.unknown()),
  descriptorRevision: digest, confirmationRequired: z.literal(true), deadlineAt: timestamp,
  execution: desktopOperationIntentSchema,
}).superRefine((request, context) => {
  if (request.toolName !== request.execution.tool || request.descriptorRevision !== request.execution.toolRevision
    || request.deadlineAt !== request.execution.expiresAt) {
    context.addIssue({ code: 'custom', message: 'Transport attempt must preserve the stable operation intent' });
  }
});
export const desktopOperationStateSchema = z.enum(['recorded', 'running', 'cancel-requested', 'succeeded', 'failed', 'stopped', 'unknown']);
export const desktopOperationReceiptSchema = z.strictObject({
  operationId: z.uuid(), state: desktopOperationStateSchema, resultHash: digest.optional(), updatedAt: timestamp,
  invocationId: z.uuid().optional(), connectionInstanceId: z.uuid().optional(), executionStopped: z.boolean(),
}).superRefine((receipt, context) => {
  if (receipt.state !== 'unknown' && receipt.executionStopped !== ['succeeded', 'failed', 'stopped'].includes(receipt.state)) {
    context.addIssue({ code: 'custom', message: 'Operation outcome and executor stop confirmation disagree' });
  }
  if (Boolean(receipt.invocationId) !== Boolean(receipt.connectionInstanceId)) {
    context.addIssue({ code: 'custom', message: 'Operation attempt requires both invocation and connection identity' });
  }
});

/** Negotiated separately; merely importing these schemas grants no execution authority. */
export const desktopExecutionBindingSchema = z.strictObject({
  gatewayId: z.uuid(), deviceId: z.uuid(), clientId: z.string().min(1).max(160), connectionInstanceId: z.uuid(),
  authorizationRevision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
});
export const endpointDesktopExecutionAuthoritySchema = desktopExecutionBindingSchema.extend({ grantId: z.uuid(), expiresAt: timestamp });
export type EndpointDesktopExecutionAuthority = z.infer<typeof endpointDesktopExecutionAuthoritySchema>;
export const desktopDeviceFrameProofSchema = z.strictObject({
  signedPayload: z.string().min(1).max(512 * 1024).regex(/^[A-Za-z0-9_-]+$/),
  signature: z.string().length(86).regex(/^[A-Za-z0-9_-]+$/),
});

export type DesktopOperationIntent = z.infer<typeof desktopOperationIntentSchema>;
export type DesktopOperationAttempt = z.infer<typeof desktopOperationAttemptSchema>;
export type DesktopExecutionRequest = z.infer<typeof desktopExecutionRequestSchema>;
export type DesktopOperationState = z.infer<typeof desktopOperationStateSchema>;
export type DesktopOperationReceipt = z.infer<typeof desktopOperationReceiptSchema>;
export type DesktopExecutionBinding = z.infer<typeof desktopExecutionBindingSchema>;
