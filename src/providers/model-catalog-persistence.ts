import { readFileSync, rmSync } from 'node:fs';
import { rm } from 'node:fs/promises';

import { z } from 'zod';

import { resolveXopcCloudCatalogCachePath } from '../config/paths-state.js';
import { writeTextAtomic } from '../infra/write-file-atomic.js';
import type { CatalogModel, CatalogSource } from './model-catalog-store.js';

const MAX_CATALOG_BYTES = 4 * 1024 * 1024;

const imageGenerationSchema = z.object({
  maxCount: z.number().int().positive(),
  sizes: z.array(z.string()),
  aspectRatios: z.array(z.string()).optional(),
  qualities: z.array(z.enum(['low', 'medium', 'high', 'auto'])),
  formats: z.array(z.enum(['png', 'jpeg', 'webp'])),
  backgrounds: z.array(z.enum(['transparent', 'opaque', 'auto'])),
  maxInputImages: z.number().int().nonnegative(),
}).strict();

const sttSchema = z.object({
  inputFormats: z.array(z.string()),
  maxBytes: z.number().int().nonnegative(),
  maxDurationSeconds: z.number().int().nonnegative(),
  languages: z.array(z.string()),
  languageHint: z.boolean(),
  prompt: z.boolean(),
  timestamps: z.array(z.enum(['segment', 'word'])),
  diarization: z.boolean(),
}).strict();

const ttsSchema = z.object({
  maxCharacters: z.number().int().nonnegative(),
  languages: z.array(z.string()),
  outputFormats: z.array(z.enum(['mp3', 'opus', 'aac', 'flac', 'wav', 'pcm'])),
  streaming: z.boolean(),
  speed: z.boolean(),
  pitch: z.boolean(),
  instructions: z.boolean(),
  defaultVoice: z.string().optional(),
}).strict();

const catalogModelSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  availability: z.enum(['available', 'unavailable']),
  kind: z.enum(['language', 'image', 'stt', 'tts']),
  input: z.array(z.enum(['text', 'image', 'audio'])),
  output: z.array(z.enum(['text', 'image', 'audio'])),
  operations: z.array(z.enum([
    'chat.completions',
    'responses',
    'images.generate',
    'images.edit',
    'audio.transcription',
    'audio.speech',
  ])),
  reasoning: z.boolean(),
  contextWindow: z.number().int().positive(),
  maxOutputTokens: z.number().int().positive().nullable(),
  stability: z.enum(['stable', 'preview', 'deprecated']).optional(),
  priority: z.number().optional(),
  tier: z.string().optional(),
  bestEffort: z.boolean().optional(),
  imageGeneration: imageGenerationSchema.optional(),
  stt: sttSchema.optional(),
  tts: ttsSchema.optional(),
}).strict();

const persistedCatalogSchema = z.object({
  schemaVersion: z.literal(1),
  providerId: z.literal('xopc-cloud'),
  catalogVersion: z.string().nullable(),
  fetchedAt: z.number().int().nonnegative(),
  baseUrl: z.string().url(),
  api: z.enum(['openai-completions', 'openai-responses']),
  recommendedModel: z.string().nullable(),
  recommended: z.record(
    z.enum(['vision', 'image-generation', 'stt', 'tts']),
    z.string(),
  ).optional(),
  models: z.array(catalogModelSchema),
}).strict();

export class ModelCatalogPersistence {
  constructor(private readonly path = resolveXopcCloudCatalogCachePath()) {}

  loadSync(): CatalogSource | undefined {
    try {
      const raw = readFileSync(this.path, 'utf8');
      if (Buffer.byteLength(raw) > MAX_CATALOG_BYTES) return undefined;
      const parsed = persistedCatalogSchema.safeParse(JSON.parse(raw));
      if (!parsed.success) return undefined;
      return {
        providerId: parsed.data.providerId,
        baseUrl: parsed.data.baseUrl,
        api: parsed.data.api,
        etag: parsed.data.catalogVersion,
        recommendedModel: parsed.data.recommendedModel,
        recommended: parsed.data.recommended,
        lastSuccessAt: parsed.data.fetchedAt,
        models: parsed.data.models as CatalogModel[],
      };
    } catch {
      return undefined;
    }
  }

  async save(source: CatalogSource): Promise<void> {
    if (source.providerId !== 'xopc-cloud') {
      throw new Error(`Cannot persist catalog for provider ${source.providerId}`);
    }
    const payload = persistedCatalogSchema.parse({
      schemaVersion: 1,
      providerId: source.providerId,
      catalogVersion: source.etag,
      fetchedAt: source.lastSuccessAt,
      baseUrl: source.baseUrl,
      api: source.api,
      recommendedModel: source.recommendedModel,
      recommended: source.recommended,
      models: source.models,
    });
    const serialized = `${JSON.stringify(payload, null, 2)}\n`;
    if (Buffer.byteLength(serialized) > MAX_CATALOG_BYTES) {
      throw new Error('XOPC Cloud model catalog exceeds the 4 MiB cache limit');
    }
    await writeTextAtomic(this.path, serialized, { mode: 0o600 });
  }

  async clear(): Promise<void> {
    await rm(this.path, { force: true });
  }

  clearSync(): void {
    rmSync(this.path, { force: true });
  }
}
