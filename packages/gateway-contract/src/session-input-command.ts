import { z } from 'zod';

import { AppContextEnvelopeSchema } from './app-context.js';
import { browserPageContextsInputSchema } from './browser-page-context.js';

export const sessionCreationSchema = z.strictObject({
  agentId: z.string().trim().min(1),
  projectId: z.string().trim().min(1).nullable(),
  execution: z.strictObject({
    mode: z.enum(['local_checkout', 'managed_worktree']),
    baseRef: z.string().trim().min(1).optional(),
  }).nullable(),
  temporary: z.boolean(),
  model: z.string().trim().min(1),
  thinkingLevel: z.string().min(1),
}).refine(value => value.projectId !== null || value.execution === null, {
  message: 'An execution environment requires a project', path: ['execution'],
});

const attachmentSchema = z.strictObject({
  id: z.string().optional(), type: z.string().min(1), mimeType: z.string().optional(),
  data: z.string().optional(), uri: z.string().optional(), name: z.string().optional(),
  size: z.number().nonnegative().optional(), workspaceRelativePath: z.string().optional(),
  durationSeconds: z.number().nonnegative().optional(),
});

export const sessionInputContentSchema = z.strictObject({
  content: z.string(),
  attachments: z.array(attachmentSchema).optional(),
  contextRefs: z.array(z.strictObject({
    kind: z.enum(['note', 'task', 'file', 'session', 'browser_tab', 'mcp_resource', 'user_assertion']),
    sourceId: z.string().trim().min(1), refId: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/).optional(),
    expectedVersion: z.string().optional(),
  })).max(5).optional(),
  browserContexts: browserPageContextsInputSchema.optional(),
  appContext: AppContextEnvelopeSchema.optional(),
});

const originSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('endpoint'), endpointId: z.string().min(1), token: z.string().min(1) }),
  z.strictObject({ type: z.literal('system'), source: z.literal('cli') }),
]);

export const sessionInputCommandSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('start'), clientMessageId: z.string().min(1).max(128),
    creation: sessionCreationSchema, input: sessionInputContentSchema, origin: originSchema,
  }),
  z.strictObject({
    kind: z.literal('append'), clientMessageId: z.string().min(1).max(128),
    expectedTranscriptId: z.string().min(1).max(128), configVersion: z.number().int().nonnegative(),
    delivery: z.enum(['next', 'steer']), input: sessionInputContentSchema, origin: originSchema,
  }),
]);

export const sessionMaterializeCommandSchema = z.strictObject({
  commandId: z.string().min(1).max(128), creation: sessionCreationSchema,
  purpose: z.enum(['voice', 'session_resources']),
});

export type SessionCreation = z.infer<typeof sessionCreationSchema>;
export type SessionInputCommand = z.infer<typeof sessionInputCommandSchema>;
export type SessionInputContent = z.infer<typeof sessionInputContentSchema>;
export type SessionMaterializeCommand = z.infer<typeof sessionMaterializeCommandSchema>;
export type SessionPreparationState = 'preparing' | 'ready' | 'preparation_failed';
export const sessionPreparationViewSchema = z.object({
  operationId: z.string(), revision: z.number().int(),
  state: z.enum(['preparing', 'ready', 'preparation_failed']), lastError: z.string().nullable(),
});
export type SessionPreparationView = z.infer<typeof sessionPreparationViewSchema>;

/** Stable JSON representation; object insertion order and transport credentials are not identities. */
export function canonicalSessionCommand(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(canonicalSessionCommand).join(',')}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object).filter(key => object[key] !== undefined).sort()
    .map(key => `${JSON.stringify(key)}:${canonicalSessionCommand(object[key])}`).join(',')}}`;
}

export function sessionCommandIdentity(command: SessionInputCommand | SessionMaterializeCommand): string {
  if ('origin' in command) {
    const { origin: _origin, ...identity } = command;
    return canonicalSessionCommand(identity);
  }
  return canonicalSessionCommand(command);
}
