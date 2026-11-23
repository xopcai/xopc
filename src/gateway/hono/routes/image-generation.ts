import type { Hono } from 'hono';

import { readImageArtifact } from '../../../image-generation/artifact.js';
import {
  configuredImageGenerationModelRef,
  getImageJob,
  listImageJobs,
  parseImageJobArtifacts,
} from '../../../image-generation/repository.js';
import type { AuthenticatedRouteDeps } from './deps.js';

export function registerImageGenerationRoutes(app: Hono, deps: AuthenticatedRouteDeps): void {
  const path = '/api/image-generation/sessions/:conversationId/jobs';

  app.get(path, async c => {
    const conversationId = c.req.param('conversationId');
    const session = await deps.service.sessionIndexInstance.getSessionMetadata(conversationId);
    if (!session?.transcriptId || session.sourceChannel !== 'webchat' || session.sessionType !== 'chat') {
      return c.json({ error: 'Conversation not found' }, 404);
    }
    return c.json({
      transcriptId: session.transcriptId,
      configured: Boolean(configuredImageGenerationModelRef(deps.service.currentConfig, session.agentId)),
      jobs: listImageJobs(conversationId, session.transcriptId),
    });
  });

  app.get(`${path}/:jobId/images/:index`, async c => {
    const conversationId = c.req.param('conversationId');
    const session = await deps.service.sessionIndexInstance.getSessionMetadata(conversationId);
    const job = getImageJob(conversationId, c.req.param('jobId'));
    if (!session?.transcriptId || job?.transcript_id !== session.transcriptId || job.state !== 'completed') {
      return c.json({ error: 'Image not found' }, 404);
    }
    const index = Number(c.req.param('index'));
    if (!Number.isInteger(index) || index < 0) {
      return c.json({ error: 'Image not found' }, 404);
    }
    const artifacts = parseImageJobArtifacts(job.artifacts_json);
    const artifact = artifacts.find(item => item.index === index) ?? artifacts[index];
    if (!artifact) {
      return c.json({ error: 'Image not found' }, 404);
    }
    return readImageArtifact(
      artifact.mediaUri,
      artifact.mimeType,
      c.req.header('Range'),
      c.req.query('download') === '1',
      c.req.method === 'HEAD',
    );
  });
}
