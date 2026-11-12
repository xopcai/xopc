import { z } from 'zod';

export const cloudMediaManifestSchema = z.object({
  schemaVersion: z.literal(1),
  models: z.array(z.object({
    id: z.string().regex(/^[a-z0-9.-]{1,64}$/),
    kind: z.enum(['music', 'video']),
    name: z.string().min(1).max(128),
    sourceRef: z.string().min(1).max(128),
    prices: z.partialRecord(z.enum(['track', '480P', '720P', '1080P']), z.number().int().positive().max(100_000_000)),
  })).max(32),
  defaults: z.object({ music: z.string().optional(), video: z.string().optional() }),
});

export type CloudMediaManifest = z.infer<typeof cloudMediaManifestSchema>;
