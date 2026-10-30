import { z } from 'zod';

/** Vendor adapters own their media transport; the runtime always owns the lease. */
export type PhoneMediaDescriptor =
  | { kind: 'scrcpy-h264'; protocolVersion: 1; continuousTouch: true; maxPointers: 1 }
  | { kind: 'hdc-h264'; protocolVersion: 1; continuousTouch: false; maxPointers: 1 }
  | { kind: 'vendor-sdk'; provider: string; sessionId: string; expiresAt: number; controlRevocation: 'confirmed' | 'ttl' }
  | { kind: 'snapshot'; continuousTouch: false };

export const PhonePointerSchema = z.object({
  type: z.literal('pointer'), phase: z.enum(['down', 'move', 'up', 'cancel']),
  durationMs: z.number().int().min(0).max(60_000).optional(),
  seq: z.number().int().positive(), epoch: z.number().int().positive(),
  geometry: z.number().int().positive(), x: z.number().finite().min(0).max(1000), y: z.number().finite().min(0).max(1000),
}).strict();
export type PhonePointer = z.infer<typeof PhonePointerSchema>;
export type PhoneVideoPacket = { data: Buffer; config: boolean; key: boolean; pts: number; geometry?: PhoneVideoGeometry };
export type PhoneVideoGeometry = { width: number; height: number; version: number; codec: string };

export interface PhoneInteractiveProvider {
  readonly descriptor: PhoneMediaDescriptor;
  readonly geometry: PhoneVideoGeometry;
  foreground(signal: AbortSignal): Promise<string>;
  start(): Promise<void>;
  subscribe(packet: (packet: PhoneVideoPacket) => void): () => void;
  pointer(input: PhonePointer): Promise<void>;
  refresh(): void;
  /** Must resolve only after the transport has released all accepted touches. */
  revoke(): Promise<void>;
  close(): Promise<void>;
}
