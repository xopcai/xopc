import { createHash } from 'node:crypto';

import { isVideoDurationSupported, VIDEO_IMAGE_MAX_BYTES, VIDEO_MODEL_REFS, VIDEO_RESOLUTIONS, WAN_VIDEO_MODEL_REF } from '@xopcai/gateway-contract';
import type { Context, Hono } from 'hono';
import { z } from 'zod';

import { readMediaReference } from '../../../media/media-reference.js';
import { runSqliteWriteTransaction } from '../../../storage/sqlite/transaction.js';
import { readVideoArtifact } from '../../../video-generation/artifact.js';
import { getVideoDraft } from '../../../video-generation/drafts.js';
import { enqueueVideoJob, getVideoJob, listVideoJobs } from '../../../video-generation/repository.js';
import { getAvailableVideoModelRefs, getConfiguredVideoProviders, getVideoProvider } from '../../../video-generation/providers.js';
import { getVideoDefaults, getVideoModel, getVideoModelDefinition, setVideoDefaults, setVideoModel } from '../../../video-generation/settings.js';
import { resolveScopedMediaReference } from '../../media-access.js';
import type { AuthenticatedRouteDeps } from './deps.js';

const settingsPath = '/api/video-generation/settings';
const modelSchema = z.enum(VIDEO_MODEL_REFS);
const path = '/api/video-generation/sessions/:conversationId/jobs';
const confirmationSchema = z.object({ id: z.string().uuid(), revision: z.number().int().positive() });
const requestSchema = z.object({
  id: z.string().uuid(),
  modelRef: modelSchema.default(WAN_VIDEO_MODEL_REF),
  transcriptId: z.string().min(1).max(128),
  prompt: z.string().trim().min(1).max(1_000),
  duration: z.coerce.number().int(),
  ratio: z.enum(['16:9', '9:16', 'adaptive']),
  resolution: z.enum(VIDEO_RESOLUTIONS),
  imageUri: z.string().startsWith('media://').max(512).nullable(),
});

function imageMime(bytes: Buffer): string | undefined {
  if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'image/png';
  if (bytes.subarray(0, 3).equals(Buffer.from([255, 216, 255]))) return 'image/jpeg';
  if (bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  return undefined;
}

async function videoSettings() {
  const configured = await getConfiguredVideoProviders();
  const modelRef = getVideoModel();
  return { modelRef, defaults: getVideoDefaults(modelRef), configured, modelRefs: [...new Set([...getAvailableVideoModelRefs(), modelRef])],
    models: Object.fromEntries(getAvailableVideoModelRefs().map(ref => [ref, getVideoModelDefinition(ref)])) };
}

export function registerVideoGenerationRoutes(app: Hono, deps: AuthenticatedRouteDeps): void {
  app.get(settingsPath, async c => c.json(await videoSettings()));

  app.put(settingsPath, deps.strictRateLimitMiddleware, async c => {
    const parsed = z.object({ modelRef: modelSchema }).safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: 'Unknown video generation model' }, 400);
    if (!getAvailableVideoModelRefs().includes(parsed.data.modelRef)) {
      return c.json({ error: 'XOPC Cloud video model is unavailable' }, 400);
    }
    setVideoModel(parsed.data.modelRef);
    return c.json(await videoSettings());
  });

  app.patch(settingsPath, deps.strictRateLimitMiddleware, async c => {
    const parsed = z.object({
      modelRef: modelSchema, duration: z.number().int(), resolution: z.enum(VIDEO_RESOLUTIONS),
    }).safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: 'Invalid video defaults' }, 400);
    const { modelRef, duration, resolution } = parsed.data;
    const model = getVideoModelDefinition(modelRef);
    if (!isVideoDurationSupported(model, duration) || !model.resolutions.includes(resolution)) {
      return c.json({ error: 'The selected model does not support these video defaults' }, 400);
    }
    setVideoDefaults(modelRef, { duration, resolution });
    return c.json(await videoSettings());
  });

  app.get(path, async c => {
    const conversationId = c.req.param('conversationId');
    const session = await deps.service.sessionIndexInstance.getSessionMetadata(conversationId);
    if (!session?.transcriptId) return c.json({ error: 'Conversation not found' }, 404);
    const modelRef = getVideoModel();
    const configured = getAvailableVideoModelRefs().includes(modelRef) && Boolean(await getVideoProvider(modelRef).resolveKey().catch(() => undefined));
    const jobs = listVideoJobs(conversationId);
    const draft = getVideoDraft(conversationId, session.transcriptId);
    return c.json({ transcriptId: session.transcriptId, modelRef, configured, defaults: getVideoDefaults(modelRef), jobs,
      ...(draft && !jobs.some(job => job.id === draft.id) ? { draft } : {}),
    });
  });

  app.post(path, deps.strictRateLimitMiddleware, c => submit(c, false));
  app.post(`${path}/confirm-draft`, deps.strictRateLimitMiddleware, c => submit(c, true));

  async function submit(c: Context, confirming: boolean) {
    const conversationId = c.req.param('conversationId');
    const session = await deps.service.sessionIndexInstance.getSessionMetadata(conversationId);
    const transcriptId = session?.transcriptId;
    if (!transcriptId) return c.json({ error: 'Conversation not found' }, 404);
    const confirmation = confirming
      ? confirmationSchema.safeParse(await c.req.json().catch(() => null))
      : undefined;
    if (confirmation && !confirmation.success) return c.json({ error: 'Invalid draft confirmation' }, 400);
    const draft = confirmation?.success ? getVideoDraft(conversationId, transcriptId) : undefined;
    if (confirmation?.success && (draft?.id !== confirmation.data.id || draft.revision !== confirmation.data.revision)) {
      return c.json({ error: 'The video draft changed. Review the current version before generating.' }, 409);
    }
    const form = confirming ? null : await c.req.formData().catch(() => null);
    if (!draft && !form) return c.json({ error: 'Invalid video request' }, 400);
    const parsed = requestSchema.safeParse(draft ?? {
      id: form?.get('id'), modelRef: form?.get('modelRef') ?? undefined, transcriptId: form?.get('transcriptId'), prompt: form?.get('prompt'),
      duration: form?.get('duration'), ratio: form?.get('ratio'), resolution: form?.get('resolution'),
      imageUri: form?.get('imageUri'),
    });
    if (!parsed.success) return c.json({ error: 'Invalid video settings' }, 400);
    const { imageUri, modelRef, ...request } = parsed.data;
    const upload = form?.get('image') ?? null;
    if (upload !== null && (!(upload instanceof File) || imageUri || !upload.size || upload.size > VIDEO_IMAGE_MAX_BYTES)) {
      return c.json({ error: 'Provide one PNG, JPEG or WebP image up to 5 MiB' }, 400);
    }

    const model = getVideoModelDefinition(modelRef);
    const hasImage = Boolean(upload || imageUri);
    if (!isVideoDurationSupported(model, request.duration) || !model.resolutions.includes(request.resolution) || (hasImage && !model.imageRatios.includes(request.ratio))) {
      return c.json({ error: 'The selected model does not support these video settings' }, 400);
    }
    let bytes: Buffer | undefined;
    let imageName: string | null = null;
    if (upload instanceof File) {
      bytes = Buffer.from(await upload.arrayBuffer());
      imageName = upload.name.slice(0, 160);
    } else if (imageUri) {
      try {
        const media = await resolveScopedMediaReference(deps.service, imageUri, { conversationId });
        bytes = (await readMediaReference(media.uri, VIDEO_IMAGE_MAX_BYTES)).buffer;
        imageName = media.id;
      } catch {
        return c.json({ error: 'Reference image is unavailable in this conversation or exceeds 5 MiB' }, 400);
      }
    }
    const mime = bytes && imageMime(bytes);
    if (bytes && !mime) return c.json({ error: 'Reference image must be PNG, JPEG or WebP' }, 400);
    if (bytes && (model.provider === 'volcengine-ark' || modelRef.startsWith('xopc-cloud/video-seedance'))) {
      const { default: sharp } = await import('sharp');
      const size = await sharp(bytes, { limitInputPixels: 36_000_000 }).metadata().catch(() => undefined);
      const width = size?.autoOrient.width ?? 0;
      const height = size?.autoOrient.height ?? 0;
      if (width < 300 || height < 300 || width > 6_000 || height > 6_000 || width / height < 0.4 || width / height > 2.5) {
        return c.json({ error: 'Seedance requires a readable image with sides of 300–6000 px and an aspect ratio of 0.4–2.5' }, 400);
      }
    }
    if (!getAvailableVideoModelRefs().includes(modelRef)) return c.json({ error: 'XOPC Cloud video model is unavailable' }, 503);
    const provider = getVideoProvider(modelRef);
    if (!(await provider.resolveKey().catch(() => undefined))) return c.json({ error: `Connect ${provider.name} on the Gateway` }, 503);
    const hash = createHash('sha256').update(JSON.stringify({ ...request, imageName }));
    if (bytes) hash.update(bytes);

    const requestHash = hash.digest('hex');
    const result = runSqliteWriteTransaction(() => {
      if (draft) {
        const latest = getVideoDraft(conversationId, transcriptId);
        if (latest?.id !== draft.id || latest.revision !== draft.revision) return { error: 'draft_changed' } as const;
      }
      return enqueueVideoJob(conversationId, { ...request, modelRef, imageName }, requestHash,
        bytes && mime ? { bytes, mime } : undefined, draft);
    });
    if (result.error === 'draft_changed') return c.json({ error: 'The video draft changed. Review the current version before generating.' }, 409);
    if (result.error === 'budget_exhausted') return c.json({ error: 'The Gateway video generation budget for today has been reached.' }, 429);
    if (result.error === 'queue_full') return c.json({ error: 'The video queue is full. Try again after a task completes.' }, 429);
    if (result.error === 'model_changed') return c.json({ error: 'The video model changed. Review the updated model before submitting.' }, 409);
    if (result.error) return c.json({ error: 'The conversation or video request changed. Review the current request and try again.' }, 409);
    return c.json(result.job, 202);
  }

  app.get(`${path}/:jobId/video`, async c => {
    const job = getVideoJob(c.req.param('conversationId'), c.req.param('jobId'));
    if (job?.state !== 'completed') return c.json({ error: 'Video not found' }, 404);
    return readVideoArtifact(job.id, c.req.header('Range'), c.req.query('download') === '1');
  });
}
