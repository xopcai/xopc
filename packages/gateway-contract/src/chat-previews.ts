import { z } from 'zod';

export const CHAT_PREVIEW_MAX_SOURCE_SIZE = 256 * 1024;
export const CHAT_PREVIEW_RUNTIME_SOURCE = 'xopc-chat-preview' as const;
export const CHAT_PREVIEW_RUNTIME_VERSION = 1 as const;

export const ChatPreviewSourceHashSchema = z.string().regex(/^[a-f0-9]{64}$/);

export const ChatPreviewSourceSchema = z.strictObject({
  markup: z.string().max(128 * 1024),
  styles: z.string().max(128 * 1024).default(''),
  script: z.string().max(128 * 1024).default(''),
}).refine(
  source => source.markup.length + source.styles.length + source.script.length <= CHAT_PREVIEW_MAX_SOURCE_SIZE,
  'Preview source exceeds the 256 KiB limit',
).refine(
  source => !/<\/?(?:html|head|body|script|style)\b/i.test(source.markup),
  'Preview markup must be an HTML fragment; put CSS and JavaScript in their dedicated fields',
);

export const ChatPreviewRecordSchema = z.strictObject({
  id: z.string().uuid(),
  conversationId: z.string().uuid(),
  title: z.string().trim().min(1).max(120),
  preferredHeight: z.number().int().min(240).max(720),
  latestRevision: ChatPreviewSourceHashSchema,
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
});

export const ChatPreviewRevisionSchema = ChatPreviewSourceSchema.extend({
  previewId: z.string().uuid(),
  sourceHash: ChatPreviewSourceHashSchema,
  createdAt: z.number().int().nonnegative(),
});

export const ChatPreviewCreateInputSchema = ChatPreviewSourceSchema.extend({
  title: z.string().trim().min(1).max(120),
  preferredHeight: z.number().int().min(240).max(720).default(480),
});

export const ChatPreviewReviseInputSchema = ChatPreviewSourceSchema.extend({
  baseRevision: ChatPreviewSourceHashSchema,
  title: z.string().trim().min(1).max(120).optional(),
  preferredHeight: z.number().int().min(240).max(720).optional(),
});

export const ChatPreviewDiagnosticSchema = z.strictObject({
  kind: z.enum(['script_error', 'unhandled_rejection']),
  message: z.string().trim().min(1).max(500),
  filename: z.string().max(500).optional(),
  line: z.number().int().nonnegative().optional(),
  column: z.number().int().nonnegative().optional(),
});

export const ChatPreviewFixGuidanceInputSchema = z.strictObject({
  sourceHash: ChatPreviewSourceHashSchema,
  diagnostics: z.array(ChatPreviewDiagnosticSchema).min(1).max(20),
  locale: z.enum(['en', 'zh']).default('en'),
});

export const ChatPreviewFixGuidanceSchema = z.strictObject({
  previewId: z.string().uuid(),
  sourceHash: ChatPreviewSourceHashSchema,
  prompt: z.string().min(1),
});

const chatPreviewRuntimeEnvelope = z.strictObject({
  source: z.literal(CHAT_PREVIEW_RUNTIME_SOURCE),
  version: z.literal(CHAT_PREVIEW_RUNTIME_VERSION),
  channel: z.string().uuid(),
});

export const ChatPreviewRuntimeMessageSchema = z.discriminatedUnion('type', [
  chatPreviewRuntimeEnvelope.extend({ type: z.literal('ready') }),
  chatPreviewRuntimeEnvelope.extend({
    type: z.literal('resize'),
    height: z.number().finite().min(120).max(2_000),
  }),
  chatPreviewRuntimeEnvelope.extend({
    type: z.literal('error'),
    diagnostic: ChatPreviewDiagnosticSchema,
  }),
]);

export type ChatPreviewSource = z.infer<typeof ChatPreviewSourceSchema>;
export type ChatPreviewRecord = z.infer<typeof ChatPreviewRecordSchema>;
export type ChatPreviewRevision = z.infer<typeof ChatPreviewRevisionSchema>;
export type ChatPreviewCreateInput = z.infer<typeof ChatPreviewCreateInputSchema>;
export type ChatPreviewReviseInput = z.infer<typeof ChatPreviewReviseInputSchema>;
export type ChatPreviewDiagnostic = z.infer<typeof ChatPreviewDiagnosticSchema>;
export type ChatPreviewFixGuidanceInput = z.infer<typeof ChatPreviewFixGuidanceInputSchema>;
export type ChatPreviewFixGuidance = z.infer<typeof ChatPreviewFixGuidanceSchema>;
export type ChatPreviewRuntimeMessage = z.infer<typeof ChatPreviewRuntimeMessageSchema>;
