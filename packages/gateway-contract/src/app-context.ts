import { z } from 'zod';

export const AppContextResourceSchema = z.strictObject({
  kind: z.enum(['note', 'task', 'project', 'scene', 'local_app']),
  id: z.string().min(1).max(512),
  revision: z.string().min(1).max(128),
});

export const AppContextEnvelopeSchema = z.strictObject({
  version: z.literal(1),
  clientInstanceId: z.string().uuid(),
  tabId: z.string().uuid(),
  sequence: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  surface: z.enum(['web', 'electron', 'mobile']),
  resourceRefs: z.array(AppContextResourceSchema).max(20),
  selection: z.strictObject({ text: z.string().max(16000), draft: z.boolean().default(false) }).optional(),
  capturedAt: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
});
export type AppContextEnvelope = z.infer<typeof AppContextEnvelopeSchema>;

export const ResolvedAppContextSchema = z.object({
  snapshot: AppContextEnvelopeSchema,
  resources: z.array(z.object({
    reference: AppContextResourceSchema,
    title: z.string(), text: z.string().max(16000), truncated: z.boolean(),
  })).max(20),
  selectionTrust: z.literal('user-supplied'),
});
export type ResolvedAppContext = z.infer<typeof ResolvedAppContextSchema>;

/** Limits apply to UTF-8 bytes, not JavaScript string length. No silent clipping. */
export function parseAppContextEnvelope(input: unknown): AppContextEnvelope {
  const snapshot = AppContextEnvelopeSchema.parse(input);
  if (new TextEncoder().encode(JSON.stringify(snapshot)).byteLength > 65536) throw new Error('App context exceeds 64 KiB');
  const keys = snapshot.resourceRefs.map(ref => `${ref.kind}:${ref.id}`);
  if (new Set(keys).size !== keys.length) throw new Error('App context contains duplicate resources');
  return snapshot;
}
