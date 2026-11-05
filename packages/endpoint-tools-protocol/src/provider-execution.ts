import { z } from 'zod';

const digest = z.string().regex(/^[a-f0-9]{64}$/);
export const providerOperationIntentSchema = z.strictObject({ operationId: z.uuid(), providerDigest: digest,
  toolRevision: digest, argumentsDigest: digest });
export const providerOperationReceiptSchema = z.strictObject({ intent: providerOperationIntentSchema,
  state: z.enum(['running', 'succeeded', 'unknown']), resultDigest: digest.optional(), updatedAt: z.number().int().positive() })
  .refine(receipt => (receipt.state === 'succeeded') === Boolean(receipt.resultDigest), 'Only completed results carry a result digest');
export const providerOperationQuerySchema = z.strictObject({ requestId: z.uuid(), operationId: z.uuid(), providerDigest: digest });
export const providerOperationStatusSchema = providerOperationQuerySchema.extend({ receipt: providerOperationReceiptSchema.optional() });

export type ProviderOperationIntent = z.infer<typeof providerOperationIntentSchema>;
export type ProviderOperationReceipt = z.infer<typeof providerOperationReceiptSchema>;
