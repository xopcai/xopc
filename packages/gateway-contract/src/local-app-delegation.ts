import { z } from 'zod';

/** One bounded inference; resource references are resolved by the host, never by the model. */
export const LocalAppDelegateInputSchema = z.strictObject({
  instruction: z.string().trim().min(1).max(8000),
  context: z.string().max(16000).default(''),
  responseFormat: z.enum(['text', 'json']).default('text'),
  maxOutputTokens: z.number().int().min(128).max(4096).default(1024),
  sources: z.array(z.strictObject({ capabilityId: z.enum(['xopc.notes.get', 'xopc.tasks.get']),
    id: z.string().trim().min(1).max(512) })).max(3).default([]),
});
export const LocalAppDelegateOutputSchema = z.strictObject({
  operationId: z.uuid(), text: z.string().min(1).max(32768), json: z.json().optional(),
  finishReason: z.enum(['completed', 'length']),
});
export type LocalAppDelegateInput = z.infer<typeof LocalAppDelegateInputSchema>;
