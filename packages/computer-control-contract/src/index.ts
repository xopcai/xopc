import { z } from 'zod';

export const COMPUTER_CONTROL_TOOL = 'desktop.computer.control';
export const ComputerProfileSchema = z.enum(['gui-plus-2026-02-26', 'structured-tools-v1']);
export type ComputerProfile = z.infer<typeof ComputerProfileSchema>;
const Id = z.string().min(1).max(200);
const Point = z.object({ x: z.number().finite().min(0), y: z.number().finite().min(0) }).strict();
export const ComputerActionSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('click'), point: Point, button: z.enum(['left', 'right']), count: z.union([z.literal(1), z.literal(2)]) }).strict(),
  z.object({ kind: z.literal('setValue'), ref: Id, text: z.string().max(16_384) }).strict(),
  z.object({ kind: z.literal('typeText'), text: z.string().max(16_384), point: Point.optional() }).strict(),
  z.object({ kind: z.literal('pressKeys'), keys: z.array(z.string().regex(/^[a-zA-Z0-9_]+$/).max(40)).min(1).max(4) }).strict(),
  z.object({ kind: z.literal('scroll'), point: Point, deltaX: z.number().int().min(-2000).max(2000), deltaY: z.number().int().min(-2000).max(2000) }).strict(),
  z.object({ kind: z.literal('wait'), durationMs: z.number().int().min(0).max(2000) }).strict(),
]);
export type ComputerAction = z.infer<typeof ComputerActionSchema>;
export const ComputerTargetSchema = z.object({
  appId: Id, pid: z.number().int().positive(), processIdentity: Id, windowId: Id,
  width: z.number().int().positive().max(16384), height: z.number().int().positive().max(16384),
  geometryRevision: Id,
}).strict();
export type ComputerTarget = z.infer<typeof ComputerTargetSchema>;
export const ComputerObservationSchema = z.object({
  id: Id, sessionId: Id, brokerEpoch: Id, generation: z.number().int().nonnegative(),
  target: ComputerTargetSchema, capturedAt: z.number().int().positive(),
  imageWidth: z.number().int().positive(), imageHeight: z.number().int().positive(),
  summary: z.string().max(12_000), focusedEditableRef: Id.optional(),
  stateDigest: Id,
}).strict();
export type ComputerObservation = z.infer<typeof ComputerObservationSchema>;
export const ComputerModelBindingSchema = z.object({
  modelRef: Id, profile: ComputerProfileSchema, origin: z.string().url(),
  runtimeLocation: z.enum(['local', 'remote', 'unknown']),
  upstreamOrigin: z.string().url().optional(),
}).strict();
export type ComputerModelBinding = z.infer<typeof ComputerModelBindingSchema>;
export const ActionEnvelopeSchema = z.object({
  actionId: Id, sessionId: Id, observationId: Id, brokerEpoch: Id,
  generation: z.number().int().nonnegative(), grantId: Id,
  deadlineAt: z.number().int().positive(), action: ComputerActionSchema,
}).strict();
export type ActionEnvelope = z.infer<typeof ActionEnvelopeSchema>;
export interface ComputerReceipt {
  actionId: string;
  dispatch: 'notStarted' | 'started' | 'completed' | 'unknown';
  outcome: 'applied' | 'notApplied' | 'unknown';
  verification: 'semantic' | 'artifact' | 'visual' | 'none';
  errorCode?: string;
}
export const ComputerAppSchema = z.object({ appRef: Id, name: z.string().max(300), running: z.boolean() }).strict();
export const ComputerWindowSchema = z.object({ windowRef: Id, title: z.string().max(300), visible: z.boolean() }).strict();
export type ComputerApp = z.infer<typeof ComputerAppSchema>;
export type ComputerWindow = z.infer<typeof ComputerWindowSchema>;
export const ComputerCommandSchema = z.discriminatedUnion('op', [
  z.object({ op: z.literal('discover'), sessionId: Id, owner: Id, query: z.string().max(200) }).strict(),
  z.object({ op: z.literal('open'), sessionId: Id, owner: Id, appRef: Id, windowRef: Id.optional(),
    mode: z.enum(['observe', 'control']), prepare: z.boolean(), model: ComputerModelBindingSchema }).strict(),
  z.object({ op: z.literal('status'), sessionId: Id, owner: Id }).strict(),
  z.object({ op: z.literal('observe'), sessionId: Id, owner: Id }).strict(),
  z.object({ op: z.literal('act'), sessionId: Id, owner: Id, envelope: ActionEnvelopeSchema }).strict(),
  z.object({ op: z.literal('release'), sessionId: Id, owner: Id }).strict(),
]);
export type ComputerCommand = z.infer<typeof ComputerCommandSchema>;
export const COMPUTER_INPUT_SCHEMA = z.toJSONSchema(ComputerCommandSchema);
export const COMPUTER_OUTPUT_SCHEMA = {
  type: 'array', minItems: 1, maxItems: 2,
  items: { oneOf: [
    { type: 'object', additionalProperties: false, required: ['type', 'value'], properties: { type: { const: 'json' }, value: { type: 'object' } } },
    { type: 'object', additionalProperties: false, required: ['type', 'fileId', 'name', 'mimeType', 'size', 'sha256'], properties: {
      type: { const: 'file' }, fileId: { type: 'string' }, name: { type: 'string' }, mimeType: { enum: ['image/png', 'image/jpeg'] },
      size: { type: 'integer', minimum: 1, maximum: 5242880 }, sha256: { type: 'string' },
    } },
  ] },
} as const;
export const COMPUTER_DESCRIPTOR = {
  name: COMPUTER_CONTROL_TOOL, title: 'Computer control transport',
  description: 'Private session-authorized desktop transport. Use computer_use instead.',
  inputSchema: COMPUTER_INPUT_SCHEMA, outputSchema: COMPUTER_OUTPUT_SCHEMA,
  policyId: 'computer.session-scoped', sensitivity: 'personal', effect: 'write',
  confirmation: 'never', requiresForeground: false, requiredPermissions: ['computer-control'],
  timeoutMs: 30_000, maxConcurrency: 1, supportsCancellation: true, idempotent: false,
  resultKinds: ['json', 'file'],
} as const;
