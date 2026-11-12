import { SEEDANCE_VIDEO_MODEL_REF, WAN_VIDEO_MODEL_REF } from '@xopcai/gateway-contract';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { closeXopcDatabase, openXopcDatabase } from '../../storage/sqlite/connection.js';
import { createConversation } from '../../storage/sqlite/conversation-repository.js';
import { readVideoArtifact } from '../artifact.js';
import { beginVideoSubmission, claimVideoJob, enqueueVideoJob, getVideoJob } from '../repository.js';
import { queryWanVideo, submitWanVideo } from '../wan.js';
import { fetchProviderVideo } from '../providers.js';
import { querySeedanceVideo, submitSeedanceVideo } from '../seedance.js';
import { setVideoModel } from '../settings.js';
import { VideoGenerationWorker } from '../worker.js';

vi.mock('../wan.js', async importOriginal => ({
  ...await importOriginal<typeof import('../wan.js')>(),
  resolveWanKey: vi.fn(async () => 'test-key'),
  submitWanVideo: vi.fn(async () => 'wan-task'),
  queryWanVideo: vi.fn(),
}));

vi.mock('../providers.js', async importOriginal => ({
  ...await importOriginal<typeof import('../providers.js')>(),
  fetchProviderVideo: vi.fn(),
}));

vi.mock('../seedance.js', () => ({
  resolveSeedanceKey: vi.fn(async () => 'ark-test-key'),
  submitSeedanceVideo: vi.fn(async () => 'ark-task'),
  querySeedanceVideo: vi.fn(),
}));

let directory: string;
let database: string;
let conversationId: string;
let transcriptId: string;
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'xopc-wan-test-'));
  database = join(directory, 'xopc.db');
  vi.stubEnv('XOPC_STATE_DIR', directory);
  vi.stubEnv('XOPC_WAN_DAILY_BUDGET_CNY', '30');
  openXopcDatabase({ path: database });
  const conversation = createConversation({ agentId: 'main' }, directory);
  conversationId = conversation.key;
  transcriptId = conversation.transcriptId!;
});
afterEach(() => {
  closeXopcDatabase();
  rmSync(directory, { recursive: true, force: true });
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

function request() {
  return {
    id: randomUUID(), transcriptId, modelRef: WAN_VIDEO_MODEL_REF, prompt: 'Paper boat', duration: 2,
    ratio: '16:9' as const, resolution: '480P' as const, imageName: null,
  };
}

async function runOneWorkerIteration() {
  const worker = new VideoGenerationWorker();
  worker.start();
  await worker.stop();
}

describe('video generation recovery', () => {
  it('deduplicates a confirmed request and resumes a known provider task after reopening SQLite', async () => {
    const input = request();
    expect(enqueueVideoJob(conversationId, input, 'hash').job?.state).toBe('queued');
    expect(enqueueVideoJob(conversationId, input, 'hash').job?.id).toBe(input.id);
    expect(enqueueVideoJob(conversationId, input, 'changed').error).toBe('idempotency_conflict');
    await runOneWorkerIteration();
    expect(submitWanVideo).toHaveBeenCalledTimes(1);
    expect(getVideoJob(conversationId, input.id)?.provider_task_id).toBe('wan-task');

    closeXopcDatabase();
    openXopcDatabase({ path: database });
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 16_000);
    vi.mocked(queryWanVideo).mockResolvedValue({ task_status: 'SUCCEEDED', video_url: 'https://example.com/output.mp4' });
    const mp4Header = Buffer.from('000000186674797069736f6d', 'hex');
    vi.mocked(fetchProviderVideo).mockResolvedValue(new Response(mp4Header));
    await runOneWorkerIteration();
    expect(submitWanVideo).toHaveBeenCalledTimes(1);
    expect(getVideoJob(conversationId, input.id)).toMatchObject({ state: 'completed', transcript_id: transcriptId });
    expect(getVideoJob(randomUUID(), input.id)).toBeUndefined();
    const result = await readVideoArtifact(input.id, 'bytes=4-7');
    expect(result.status).toBe(206);
    expect(await result.text()).toBe('ftyp');
  });

  it('keeps a Seedance job pinned to Ark after switching the default back to Wan', async () => {
    setVideoModel(SEEDANCE_VIDEO_MODEL_REF);
    const input = { ...request(), modelRef: SEEDANCE_VIDEO_MODEL_REF, duration: 4 };
    expect(enqueueVideoJob(conversationId, input, 'ark').job?.modelRef).toBe(SEEDANCE_VIDEO_MODEL_REF);
    await runOneWorkerIteration();
    expect(submitSeedanceVideo).toHaveBeenCalledTimes(1);
    setVideoModel(WAN_VIDEO_MODEL_REF);
    expect(enqueueVideoJob(conversationId, input, 'ark').job?.state).toBe('submitted');
    expect(enqueueVideoJob(conversationId, { ...input, id: randomUUID() }, 'stale').error).toBe('model_changed');

    closeXopcDatabase();
    openXopcDatabase({ path: database });
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 16_000);
    vi.mocked(querySeedanceVideo).mockResolvedValue({ state: 'completed', url: 'https://example.com/output.mp4' });
    vi.mocked(fetchProviderVideo).mockResolvedValue(new Response(Buffer.from('000000186674797069736f6d', 'hex')));
    await runOneWorkerIteration();
    expect(querySeedanceVideo).toHaveBeenCalledWith('ark-test-key', 'ark-task');
    expect(submitWanVideo).not.toHaveBeenCalled();
    expect(getVideoJob(conversationId, input.id)?.state).toBe('completed');
  });

  it('preserves an ambiguous submission without sending a second paid request', async () => {
    const input = request();
    enqueueVideoJob(conversationId, input, 'hash');
    const lease = claimVideoJob()!;
    expect(beginVideoSubmission(input.id, lease.token)).toBe(true);
    closeXopcDatabase();
    openXopcDatabase({ path: database });

    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 61_000);
    await runOneWorkerIteration();
    expect(getVideoJob(conversationId, input.id)?.state).toBe('submission_unknown');
    expect(submitWanVideo).not.toHaveBeenCalled();
  });

  it('accepts full production specifications without an explicit daily budget', () => {
    vi.stubEnv('XOPC_WAN_DAILY_BUDGET_CNY', undefined);
    const input = { ...request(), duration: 30, resolution: '1080P' as const };
    expect(enqueueVideoJob(conversationId, input, 'production').job).toMatchObject({
      duration: 30, resolution: '1080P', state: 'queued',
    });
  });

  it('reserves the daily budget only once per confirmed request', () => {
    vi.stubEnv('XOPC_WAN_DAILY_BUDGET_CNY', '0.60');
    const input = request();
    expect(enqueueVideoJob(conversationId, input, 'hash').job?.state).toBe('queued');
    expect(enqueueVideoJob(conversationId, input, 'hash').job?.id).toBe(input.id);
    expect(enqueueVideoJob(conversationId, request(), 'second').error).toBe('budget_exhausted');

    setVideoModel(SEEDANCE_VIDEO_MODEL_REF);
    vi.stubEnv('XOPC_SEEDANCE_DAILY_BUDGET_CNY', '30');
    const ark = { ...request(), modelRef: SEEDANCE_VIDEO_MODEL_REF, duration: 4 };
    expect(enqueueVideoJob(conversationId, ark, 'ark').job?.state).toBe('queued');
  });
});
