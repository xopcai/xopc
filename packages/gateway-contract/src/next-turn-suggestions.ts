import { z } from 'zod';

export const nextTurnSuggestionSchema = z.object({
  id: z.string().uuid(), conversationId: z.string(), transcriptId: z.string(), sourceRunId: z.string(),
  inputRevision: z.number().int().nonnegative(), transcriptCursor: z.number().int().nonnegative(),
  agentId: z.string(), locale: z.enum(['zh', 'en']), prompt: z.string().min(1).max(160), expiresAt: z.number(),
});
export type NextTurnSuggestion = z.infer<typeof nextTurnSuggestionSchema>;
export const nextTurnSuggestionResponseSchema = z.object({
  status: z.enum(['ready', 'pending', 'none']), suggestion: nextTurnSuggestionSchema.optional(),
});
export type NextTurnSuggestionResponse = z.infer<typeof nextTurnSuggestionResponseSchema>;
export const nextTurnSuggestionFeedbackSchema = z.object({
  suggestionId: z.string().uuid(), impressionId: z.string().uuid(),
  event: z.enum(['shown', 'accepted', 'dismissed', 'submitted']), edited: z.boolean().optional(),
}).strict();
export type NextTurnSuggestionFeedback = z.infer<typeof nextTurnSuggestionFeedbackSchema>;
