import { z } from 'zod';

/** Stop-only attestation. This never grants execution, resolves business outcomes or acknowledges an unknown operation. */
export const desktopExecutionStopSchema = z.strictObject({ version: z.literal(1), stopId: z.uuid(), gatewayId: z.uuid(), deviceId: z.uuid(),
  grantId: z.uuid(), authorizationRevision: z.number().int().positive().max(Number.MAX_SAFE_INTEGER), leaseGeneration: z.uuid(), executionStopped: z.literal(true) });
export type DesktopExecutionStop = z.infer<typeof desktopExecutionStopSchema>;
export const signedDesktopExecutionStopSchema = z.strictObject({ receipt: desktopExecutionStopSchema,
  signature: z.string().regex(/^[A-Za-z0-9_-]{86}$/) });
export type SignedDesktopExecutionStop = z.infer<typeof signedDesktopExecutionStopSchema>;
export function desktopExecutionStopSigningPayload(input: DesktopExecutionStop): string {
  const value = desktopExecutionStopSchema.parse(input);
  return ['xopc-desktop-execution-stop-v1', value.stopId, value.gatewayId, value.deviceId, value.grantId,
    String(value.authorizationRevision), value.leaseGeneration, 'execution-stopped:true'].join('\n');
}
