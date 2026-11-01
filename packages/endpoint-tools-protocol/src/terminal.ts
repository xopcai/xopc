import { z } from 'zod';

export const DESKTOP_TERMINAL_OUTPUT_BYTES = 16384;
export const DESKTOP_TERMINAL_INPUT_BYTES = 4096;
const sequence = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const binding = { sessionId: z.uuid(), generation: z.uuid(), connectionInstanceId: z.uuid() };
const bytes = (maximum: number) => z.string().min(4).max(4 * Math.ceil(maximum / 3))
  .regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/)
  .refine(value => value.length * 3 / 4 - (value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0) <= maximum);

/** Negotiated separately from ordinary tool progress; these schemas alone do not enable a terminal. */
export const desktopTerminalBindingSchema = z.strictObject(binding);
export const desktopTerminalOutputSchema = z.strictObject({ ...binding, sequence, bytes: bytes(DESKTOP_TERMINAL_OUTPUT_BYTES) });
export const desktopTerminalOutputAckSchema = z.strictObject({ ...binding, throughSequence: sequence.or(z.literal(0)) });
export const desktopTerminalInputSchema = z.strictObject({ ...binding, inputId: z.uuid(), sequence, bytes: bytes(DESKTOP_TERMINAL_INPUT_BYTES) });
export type DesktopTerminalBinding = z.infer<typeof desktopTerminalBindingSchema>;
export type DesktopTerminalOutput = z.infer<typeof desktopTerminalOutputSchema>;
export type DesktopTerminalInput = z.infer<typeof desktopTerminalInputSchema>;
export type DesktopTerminalDispatch = 'pending' | 'accepted' | 'notStarted' | 'unknown';

export const desktopTerminalCommandSchema = z.discriminatedUnion('action', [
  desktopTerminalInputSchema.extend({ action: z.literal('input') }),
  desktopTerminalOutputAckSchema.extend({ action: z.literal('ack') }),
  desktopTerminalBindingSchema.extend({ action: z.literal('resize'), columns: z.number().int().min(20).max(500), rows: z.number().int().min(2).max(500) }),
  desktopTerminalBindingSchema.extend({ action: z.literal('close') }),
]);
export const desktopTerminalEventSchema = z.discriminatedUnion('event', [
  desktopTerminalBindingSchema.extend({ event: z.literal('opened'), operationId: z.uuid(), state: z.literal('running'), executionStopped: z.literal(false) }),
  desktopTerminalOutputSchema.extend({ event: z.literal('output') }),
  desktopTerminalBindingSchema.extend({ event: z.literal('input-ack'), inputId: z.uuid(), sequence,
    dispatch: z.enum(['accepted', 'notStarted', 'unknown']) }),
  // A stream ending is observation, never executor-stop evidence. The root operation still needs its signed receipt.
  desktopTerminalBindingSchema.extend({ event: z.literal('stream-ended'), reason: z.enum(['eof', 'disconnected', 'unknown']) }),
]);
export type DesktopTerminalCommand = z.infer<typeof desktopTerminalCommandSchema>;
export type DesktopTerminalEvent = z.infer<typeof desktopTerminalEventSchema>;
