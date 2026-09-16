import { z } from 'zod';

export const conversationIdSchema = z.uuid().transform(value => value.toLowerCase()).brand<'ConversationId'>();
// Existing transcript tokens remain opaque and unchanged; new records use UUIDs.
export const transcriptIdSchema = z.string().trim().regex(/^[a-z0-9][a-z0-9._-]{0,127}$/i).brand<'TranscriptId'>();

export type ConversationId = z.infer<typeof conversationIdSchema>;
export type TranscriptId = z.infer<typeof transcriptIdSchema>;

export function validateConversationId(value: string): ConversationId {
  return conversationIdSchema.parse(value);
}

export function validateTranscriptId(value: string): TranscriptId {
  return transcriptIdSchema.parse(value);
}
