import type { ImageGenerationArtifact, ImageJobErrorCode } from '@xopcai/gateway-contract';

import { generateImage } from '../agent/image/generation/runtime.js';
import type { ImageGenerationSourceImage } from '../agent/image/generation/types.js';
import { resolveImageGenerationModelConfigForTool } from '../agent/tools/image-generate-tool.js';
import type { Config } from '../config/schema.js';
import { isFailoverError } from '../agent/failover-error.js';
import { readMediaBuffer } from '../media/store.js';
import { tryParseMediaUri } from '../media/uri.js';
import { createLogger } from '../utils/logger.js';
import { deleteImageArtifacts, saveImageArtifact } from './artifact.js';
import {
  claimImageJob,
  getImageJob,
  parseImageJobArtifacts,
  parseImageJobOptions,
  updateImageJob,
} from './repository.js';

const log = createLogger('ImageGeneration');
const lifetimeMs = 30 * 60_000;

async function loadSourceImageFromUri(uri: string): Promise<ImageGenerationSourceImage | undefined> {
  const parsed = tryParseMediaUri(uri);
  if (!parsed) return undefined;
  const loaded = await readMediaBuffer(parsed.id, parsed.bucket).catch(() => null);
  if (!loaded) return undefined;
  return {
    buffer: loaded.buffer,
    mimeType: loaded.mimeType || 'image/png',
    fileName: parsed.id,
  };
}

function classifyImageError(err: unknown): { code: ImageJobErrorCode; message: string } {
  const message = err instanceof Error ? err.message : String(err);
  if (isFailoverError(err)) {
    if (err.reason === 'rate_limit') return { code: 'provider_rate_limited', message };
    if (err.reason === 'auth') return { code: 'credentials_missing', message };
  }
  const lower = message.toLowerCase();
  if (lower.includes('rate limit') || lower.includes('429')) {
    return { code: 'provider_rate_limited', message };
  }
  if (lower.includes('api key') || lower.includes('credential') || lower.includes('unauthorized')) {
    return { code: 'credentials_missing', message };
  }
  if (lower.includes('no image generation model')) {
    return { code: 'not_configured', message };
  }
  if (lower.includes('reject') || lower.includes('content policy') || lower.includes('safety')) {
    return { code: 'provider_rejected', message };
  }
  return { code: 'provider_failed', message };
}

export class ImageGenerationWorker {
  private timer?: ReturnType<typeof setInterval>;
  private work?: Promise<void>;

  constructor(private readonly getConfig: () => Config | undefined) {}

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.tick(), 1_000);
    this.timer.unref();
    this.tick();
  }

  async stop(): Promise<void> {
    clearInterval(this.timer);
    this.timer = undefined;
    await this.work;
  }

  private tick(): void {
    if (this.work) return;
    this.work = this.runNext()
      .catch(err => log.error({ err }, 'Image generation worker iteration failed'))
      .finally(() => { this.work = undefined; });
  }

  private async runNext(): Promise<void> {
    const claimed = claimImageJob();
    if (!claimed) return;
    const { row, token } = claimed;
    const { id } = row;

    if (Date.now() - row.created_at >= lifetimeMs) {
      updateImageJob(id, token, 'failed', {
        error: 'The image generation request expired before starting.',
        errorCode: 'expired',
      });
      return;
    }

    if (!updateImageJob(id, token, 'running', { keepLease: true })) return;

    const cfg = this.getConfig();
    const options = parseImageJobOptions(row.options_json);
    const modelConfig = resolveImageGenerationModelConfigForTool({ cfg, agentId: options.agentId });
    if (!modelConfig && !row.model_ref) {
      updateImageJob(id, token, 'failed', {
        error: 'Image generation model is not configured.',
        errorCode: 'not_configured',
      });
      return;
    }

    const inputImages: ImageGenerationSourceImage[] = [];
    if (options.imageUri) {
      const ref = await loadSourceImageFromUri(options.imageUri);
      if (ref) inputImages.push(ref);
    } else if (row.parent_id) {
      const parent = getImageJob(row.conversation_id, row.parent_id);
      const parentArtifacts = parent ? parseImageJobArtifacts(parent.artifacts_json) : [];
      if (parentArtifacts[0]?.mediaUri) {
        const ref = await loadSourceImageFromUri(parentArtifacts[0].mediaUri);
        if (ref) inputImages.push(ref);
      }
    }

    try {
      const result = await generateImage({
        cfg,
        agentId: options.agentId,
        modelConfig: modelConfig ?? undefined,
        modelOverride: row.model_ref ?? undefined,
        prompt: row.prompt,
        count: options.count,
        aspectRatio: options.aspectRatio,
        resolution: options.resolution,
        quality: options.quality,
        outputFormat: options.outputFormat,
        background: options.background,
        ...(inputImages.length > 0 ? { inputImages } : {}),
        autoProviderFallback: true,
      });

      if (!updateImageJob(id, token, 'saving', {
        modelRef: `${result.provider}/${result.model}`,
        keepLease: true,
      })) {
        return;
      }

      const artifacts: ImageGenerationArtifact[] = [];
      for (let index = 0; index < result.images.length; index++) {
        const asset = result.images[index]!;
        const mediaUri = await saveImageArtifact(id, index, asset.buffer, asset.mimeType);
        artifacts.push({
          index,
          mediaUri,
          mimeType: asset.mimeType,
        });
      }

      const ok = updateImageJob(id, token, 'completed', {
        modelRef: `${result.provider}/${result.model}`,
        artifacts,
      });
      if (!ok || !getImageJob(row.conversation_id, id)) {
        await deleteImageArtifacts(artifacts.map(item => item.mediaUri));
      }
    } catch (err) {
      const classified = classifyImageError(err);
      log.warn({ jobId: id, errorCode: classified.code, errorMessage: classified.message }, `Image generation failed: ${classified.message}`);
      updateImageJob(id, token, 'failed', {
        error: classified.message,
        errorCode: classified.code,
      });
    }
  }
}
