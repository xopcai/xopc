import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { saveImageArtifact, readImageArtifact } from '../artifact.js';
import {
  claimImageJob,
  enqueueImageJob,
  getImageJob,
  listImageJobs,
  updateImageJob,
} from '../repository.js';
import { createImageGenerationTool } from '../../agent/tools/image-generation-tool.js';
import { closeXopcDatabase, openXopcDatabase, resetXopcDatabaseSingletonForTest } from '../../storage/sqlite/index.js';
import { createConversation } from '../../storage/sqlite/conversation-repository.js';

describe('image_generation repository & tool', () => {
  let dir: string;
  let conversationId: string;
  let transcriptId: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'xopc-image-gen-'));
    vi.stubEnv('XOPC_STATE_DIR', dir);
    vi.stubEnv('XOPC_LOG_FILE', 'false');
    resetXopcDatabaseSingletonForTest();
    openXopcDatabase({ path: join(dir, 'xopc.db') });
    const conversation = createConversation({ agentId: 'main', sourceChannel: 'webchat' }, dir);
    conversationId = conversation.key;
    transcriptId = conversation.transcriptId!;
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    closeXopcDatabase();
    resetXopcDatabaseSingletonForTest();
    rmSync(dir, { recursive: true, force: true });
  });

  it('enqueues idempotently, claims, completes with saved artifact, and supports parentId revision', async () => {
    const first = enqueueImageJob(conversationId, transcriptId, 'call-1', {
      title: 'Sunset Cat',
      prompt: 'A cat sitting on a balcony at sunset',
      model: 'openai/gpt-image-1',
    });
    expect(first.job).toBeDefined();
    expect(first.job?.state).toBe('queued');
    expect(first.job?.versionNumber).toBe(1);

    const replay = enqueueImageJob(conversationId, transcriptId, 'call-1', {
      title: 'Sunset Cat',
      prompt: 'A cat sitting on a balcony at sunset',
      model: 'openai/gpt-image-1',
    });
    expect(replay.job?.id).toBe(first.job?.id);

    const claimed = claimImageJob();
    expect(claimed?.row.id).toBe(first.job?.id);
    expect(updateImageJob(claimed!.row.id, claimed!.token, 'running', { keepLease: true })).toBe(true);

    const pngBytes = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');
    const mediaUri = await saveImageArtifact(claimed!.row.id, 0, pngBytes, 'image/png');
    expect(updateImageJob(claimed!.row.id, claimed!.token, 'completed', {
      artifacts: [{ index: 0, mediaUri, mimeType: 'image/png' }],
    })).toBe(true);

    const response = await readImageArtifact(mediaUri, 'image/png');
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('image/png');

    const revision = enqueueImageJob(conversationId, transcriptId, 'call-2', {
      parentId: first.job!.id,
      prompt: 'Same cat at sunset, watercolor style',
      model: 'openai/gpt-image-1',
    });
    expect(revision.job?.parentId).toBe(first.job!.id);
    expect(revision.job?.workId).toBe(first.job!.workId);
    expect(revision.job?.versionNumber).toBe(2);

    const jobs = listImageJobs(conversationId, transcriptId);
    expect(jobs).toHaveLength(2);
    expect(getImageJob(conversationId, first.job!.id)?.state).toBe('completed');
  });

  it('exposes inspect and generate via image_generation tool', async () => {
    const tool = createImageGenerationTool({
      getConversationId: () => conversationId,
      getConfig: () => undefined,
      getAgentId: () => 'main',
    });
    const inspect = await tool.execute('inspect-1', { action: 'inspect' });
    expect((inspect.details as { jobs: unknown[] }).jobs).toEqual([]);
  });
});
