import { z } from 'zod';

export const voiceModeCapabilitySchema = z.enum(['transcription', 'transcription.stream', 'speech', 'speech.stream', 'conversation']);
export const voiceManifestSchema = z.strictObject({
  protocolVersion: z.literal(1),
  serviceVersion: z.number().int().positive(),
  modes: z.array(voiceModeCapabilitySchema),
  transport: z.literal('websocket-pcm'),
  inputFormat: z.strictObject({ encoding: z.literal('pcm_s16le'), sampleRate: z.literal(16000), channels: z.literal(1) }),
  outputFormat: z.strictObject({ encoding: z.literal('pcm_s16le'), sampleRate: z.literal(24000), channels: z.literal(1) }),
  turnDetection: z.array(z.literal('server_vad')),
  bargeIn: z.boolean(), tools: z.boolean(), resumable: z.literal(false),
  voices: z.array(z.strictObject({ id: z.string().min(1), name: z.string(), languages: z.array(z.string()) })),
  defaultVoice: z.string().min(1).optional(),
  limits: z.strictObject({ maxFrameBytes: z.number().int().positive().max(65536), maxSessionSeconds: z.number().int().positive() }),
});
export type VoiceManifest = z.infer<typeof voiceManifestSchema>;
export type VoiceModeCapability = z.infer<typeof voiceModeCapabilitySchema>;

export const voiceSelectionSchema = z.strictObject({
  mode: voiceModeCapabilitySchema,
  model: z.string().min(1).max(200),
  voice: z.string().min(1).max(200).optional(),
});
export const voiceSettingsCatalogSchema = z.strictObject({
  revision: z.string().min(1),
  catalogVersion: z.string().nullable(),
  selections: z.array(voiceSelectionSchema),
  models: z.array(z.strictObject({ id: z.string(), name: z.string(), voice: voiceManifestSchema })),
});
export type VoiceSettingsCatalog = z.infer<typeof voiceSettingsCatalogSchema>;
export type VoiceSelection = z.infer<typeof voiceSelectionSchema>;
