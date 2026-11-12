import type { Hono } from 'hono';
import { z } from 'zod';

import { readMusicArtifact } from '../../../music-generation/artifact.js';
import { configuredMusicModel, hasMusicProvider, readMusicModelSettings, resolveMusicModel } from '../../../music-generation/providers.js';
import { getMusicJob, listMusicJobs } from '../../../music-generation/repository.js';
import { musicCredentials, saveMusicDefaults, saveMusicModel } from '../../../music-generation/settings.js';
import type { AuthenticatedRouteDeps } from './deps.js';

export function registerMusicGenerationRoutes(app: Hono, deps: AuthenticatedRouteDeps): void {
  const settings = '/api/music-generation/settings';
  const path = '/api/music-generation/sessions/:conversationId/jobs';

  app.get(settings, async c => c.json(await readMusicModelSettings()));

  app.put(settings, deps.strictRateLimitMiddleware, async c => {
    const input = z.object({ modelRef: z.string().max(200) }).safeParse(await c.req.json().catch(() => null));
    if (!input.success || !resolveMusicModel(input.data.modelRef)) return c.json({ error: 'Unknown music model' }, 400);
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
    const input = z.object({ apiKey: z.string().trim().min(1).max(4096).regex(/^[!-~]+$/) }).safeParse(await c.req.json().catch(() => null));
    if (!hasMusicProvider(providerId) || !input.success) return c.json({ error: 'Invalid music provider or API key' }, 400);
    await musicCredentials().saveApiKey(providerId, input.data.apiKey);
    return c.json(await readMusicModelSettings());
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
