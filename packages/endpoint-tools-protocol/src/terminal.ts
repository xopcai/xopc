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
