import { TENCENT_MPS_MUSIC_PROVIDER } from '@xopcai/gateway-contract';
import type { Hono } from 'hono';
import { z } from 'zod';

import { getCloudMediaModels } from '../../../providers/xopc-cloud-media.js';
import { readMusicArtifact } from '../../../music-generation/artifact.js';
import { configuredMusicModel, hasMusicProvider, readMusicModelSettings, resolveMusicModel } from '../../../music-generation/providers.js';
import { getMusicJob, listMusicJobs } from '../../../music-generation/repository.js';
import { musicCredentials, saveMusicDefaults, saveMusicModel } from '../../../music-generation/settings.js';
import { parseTencentMpsCredentials, tencentMpsCredentialsSchema } from '../../../music-generation/tencent-mps.js';
import type { AuthenticatedRouteDeps } from './deps.js';

export function registerMusicGenerationRoutes(app: Hono, deps: AuthenticatedRouteDeps): void {
  const settings = '/api/music-generation/settings';
  const path = '/api/music-generation/sessions/:conversationId/jobs';

  app.get(settings, async c => c.json(await readMusicModelSettings()));

  app.put(settings, deps.strictRateLimitMiddleware, async c => {
    const input = z.object({ modelRef: z.string().max(200) }).safeParse(await c.req.json().catch(() => null));
    if (!input.success || !resolveMusicModel(input.data.modelRef)) return c.json({ error: 'Unknown music model' }, 400);
    if (input.data.modelRef.startsWith('xopc-cloud/')
      && !getCloudMediaModels('music').some(model => `xopc-cloud/${model.id}` === input.data.modelRef)) {
      return c.json({ error: 'XOPC Cloud music model is unavailable' }, 400);
    }
    saveMusicModel(input.data.modelRef);
    return c.json(await readMusicModelSettings());
  });

  app.patch(settings, deps.strictRateLimitMiddleware, async c => {
    const input = z.object({ modelRef: z.string().max(200), mode: z.enum(['song', 'instrumental']) })
      .safeParse(await c.req.json().catch(() => null));
    if (!input.success) return c.json({ error: 'Invalid music defaults' }, 400);
    const { modelRef, mode } = input.data;
    const model = resolveMusicModel(modelRef);
    if (!model?.capabilities.modes.includes(mode)) return c.json({ error: 'The selected model does not support this music mode' }, 400);
    saveMusicDefaults(modelRef, { mode });
    return c.json(await readMusicModelSettings());
  });

  app.put(`${settings}/credentials/:providerId`, deps.strictRateLimitMiddleware, async c => {
    const providerId = c.req.param('providerId');
    if (!hasMusicProvider(providerId)) return c.json({ error: 'Unknown music provider' }, 400);
    const body = await c.req.json().catch(() => null);
    if (providerId === TENCENT_MPS_MUSIC_PROVIDER) {
      const input = tencentMpsCredentialsSchema.safeParse(body);
      if (!input.success) return c.json({ error: 'Enter a valid Tencent Cloud SecretId and SecretKey' }, 400);
      await musicCredentials().saveApiKey(providerId, JSON.stringify(input.data));
    } else {
      const input = z.object({ apiKey: z.string().trim().min(1).max(4096).regex(/^[!-~]+$/) }).safeParse(body);
      if (!input.success) return c.json({ error: 'Invalid music API key' }, 400);
      await musicCredentials().saveApiKey(providerId, input.data.apiKey);
    }
    return c.json(await readMusicModelSettings());
  });

  app.post(`${settings}/credentials/:providerId`, deps.strictRateLimitMiddleware, async c => {
    const providerId = c.req.param('providerId');
    if (providerId !== TENCENT_MPS_MUSIC_PROVIDER) return c.json({ error: 'Unknown music provider' }, 404);
    const input = z.object({ field: z.enum(['secretId', 'secretKey']) }).safeParse(await c.req.json().catch(() => null));
    if (!input.success) return c.json({ error: 'Unknown credential field' }, 400);
    const stored = parseTencentMpsCredentials(await musicCredentials().revealGatewayStoredApiKey(providerId));
    c.header('Cache-Control', 'no-store');
    return c.json({ value: stored?.[input.data.field] ?? null });
  });

  app.delete(`${settings}/credentials/:providerId`, deps.strictRateLimitMiddleware, async c => {
    const providerId = c.req.param('providerId');
    if (!hasMusicProvider(providerId)) return c.json({ error: 'Unknown music provider' }, 400);
    await musicCredentials().deleteProfile(`${providerId}:default`);
    return c.json(await readMusicModelSettings());
  });

  app.get(path, async c => {
    const conversationId = c.req.param('conversationId');
    const session = await deps.service.sessionIndexInstance.getSessionMetadata(conversationId);
    if (!session?.transcriptId || session.sourceChannel !== 'webchat' || session.sessionType !== 'chat') {
      return c.json({ error: 'Conversation not found' }, 404);
    }
    return c.json({ configured: Boolean(await configuredMusicModel()), jobs: listMusicJobs(conversationId, session.transcriptId) });
  });

  app.get(`${path}/:jobId/audio`, async c => {
    const conversationId = c.req.param('conversationId');
    const session = await deps.service.sessionIndexInstance.getSessionMetadata(conversationId);
    const job = getMusicJob(conversationId, c.req.param('jobId'));
    if (!session?.transcriptId || job?.transcript_id !== session.transcriptId || job.state !== 'completed') {
      return c.json({ error: 'Audio not found' }, 404);
    }
    return readMusicArtifact(job.id, c.req.header('Range'), c.req.query('download') === '1');
  });
}
