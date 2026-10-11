import { z } from 'zod';

export const creditMicroSchema = z.string().regex(/^(0|[1-9]\d{0,15})$/)
  .refine(value => BigInt(value) <= BigInt(Number.MAX_SAFE_INTEGER), 'Credit amount exceeds supported range');
export const creditUnitSchema = z.object({
  unit: z.literal('credit'), microPerCredit: z.literal('10000'), version: z.literal('credit-v1'),
  standardCreditsPerYuan: z.string().regex(/^\d+$/),
});
export const cloudAccountSummarySchema = z.object({
  schemaVersion: z.literal(2), creditUnit: creditUnitSchema,
  balance: z.object({
    availableCreditMicro: creditMicroSchema, purchasedCreditMicro: creditMicroSchema,
    grantedCreditMicro: creditMicroSchema, usageReservedCreditMicro: creditMicroSchema,
    refundReservedCreditMicro: creditMicroSchema,
    expiring: z.array(z.object({ id: z.string(), creditMicro: creditMicroSchema, expiresAt: z.number().int().nonnegative() })),
    updatedAt: z.string().datetime(),
  }),
  usage: z.object({
    days: z.union([z.literal(1), z.literal(7), z.literal(30)]),
    requests: z.number().int().nonnegative(), inputTokens: z.number().int().nonnegative(),
    outputTokens: z.number().int().nonnegative(), totalTokens: z.number().int().nonnegative(),
    errors: z.number().int().nonnegative(), averageLatencyMs: z.number().nonnegative(),
    chargedCreditMicro: creditMicroSchema,
  }),
  links: z.object({ details: z.string().url(), purchase: z.string().url() }),
});
export const cloudCreditBudgetSchema = z.object({
  id: z.string().uuid(), limitCreditMicro: creditMicroSchema, reservedCreditMicro: creditMicroSchema,
  chargedCreditMicro: creditMicroSchema, remainingCreditMicro: creditMicroSchema,
  revision: z.number().int().positive(), createdAt: z.number().int().nonnegative(),
});
export type CloudAccountSummary = z.infer<typeof cloudAccountSummarySchema>;
export type CloudCreditBudget = z.infer<typeof cloudCreditBudgetSchema>;
export const cloudBillingReceiptSchema = z.object({
  requestId: z.string(), model: z.string(), state: z.string(),
  reservedCreditMicro: creditMicroSchema, chargedCreditMicro: creditMicroSchema.nullable(),
  releasedCreditMicro: creditMicroSchema, ratedCreditMicro: creditMicroSchema.nullable(),
  absorbedCreditMicro: creditMicroSchema.nullable(), priceSnapshot: z.unknown().nullable(),
  createdAt: z.number().int().nonnegative(), settledAt: z.number().int().nonnegative().nullable(),
});
export type CloudBillingReceipt = z.infer<typeof cloudBillingReceiptSchema>;

/** Format integers exactly, including quantities too large for decimal Number arithmetic. */
export function creditDecimal(micro: string): string {
  creditMicroSchema.parse(micro);
  const value = BigInt(micro);
  const fraction = String(value % 10000n).padStart(4, '0').replace(/0+$/, '');
  return `${value / 10000n}${fraction ? `.${fraction}` : ''}`;
}

export function parseCreditDecimal(credits: string): string {
  if (!/^\d{1,12}(\.\d{1,4})?$/.test(credits)) throw new Error('Enter Credits with up to four decimal places');
  const [whole, fraction = ''] = credits.split('.');
  return creditMicroSchema.parse(String(BigInt(whole) * 10000n + BigInt(fraction.padEnd(4, '0'))));
}
