import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { closeXopcDatabase, openXopcDatabase } from '../../storage/sqlite/connection.js';
import { createConversation } from '../../storage/sqlite/conversation-repository.js';
import { readMusicArtifact } from '../artifact.js';
import { enqueueMusicJob, getMusicJob, listMusicJobs } from '../repository.js';
import { MusicGenerationWorker } from '../worker.js';

vi.mock('../../media-shared/http/ssrf-guard.js', () => ({ assertSafeUrl: vi.fn() }));

let directory: string;
let database: string;
let conversationId: string;
let transcriptId: string;
const song = { title: 'Friday', mode: 'song' as const, prompt: 'Warm pop', lyrics: '  First line\nSecond line  ' };

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'xopc-music-'));
  database = join(directory, 'xopc.db');
  vi.stubEnv('XOPC_STATE_DIR', directory);
  vi.stubEnv('MUREKA_API_KEY', 'test-key');
  vi.stubEnv('XOPC_MUSIC_MODEL', '');
  vi.stubEnv('XOPC_MUSIC_DAILY_LIMIT', '');
  openXopcDatabase({ path: database });
  const conversation = createConversation({ agentId: 'main' }, directory);
  conversationId = conversation.key;
  transcriptId = conversation.transcriptId!;
});

it('submits Tencent songs and instrumentals and resumes both using saved task IDs', async () => {
  vi.stubEnv('XOPC_MUSIC_MODEL', 'tencent-mps/minimax-music-3.0');
  vi.stubEnv('TENCENTCLOUD_SECRET_ID', 'fixture-id');
  vi.stubEnv('TENCENTCLOUD_SECRET_KEY', 'fixture-key');
  const audio = Buffer.from('fffb9064' + '00'.repeat(414), 'hex');
  const remote = vi.fn(async (url: string | URL, init?: RequestInit) => {
    if (String(url) === 'https://track-123456.cos.ap-guangzhou.myqcloud.com/music.mp3') {
      expect(init?.headers).toBeUndefined();
      return new Response(audio);
    }
    expect(url).toBe('https://mps.tencentcloudapi.com/');
    const headers = new Headers(init?.headers);
    expect(headers.get('Authorization')).toMatch(/^TC3-HMAC-SHA256 Credential=fixture-id\/.*\/mps\/tc3_request,/);
    const body = JSON.parse(String(init?.body));
    if (headers.get('X-TC-Action') === 'CreateAigcAudioTask') {
      expect(body).toMatchObject({
        ModelName: 'MiniMaxMusic', ModelVersion: '3.0', SceneType: 'music', ExtraParameters: { OutputAudioFormat: 'mp3' },
      });
      const input = JSON.parse(body.AdditionalParameters);
      if (body.Prompt === song.prompt) {
        expect(input).toEqual({ lyrics: '沿着海风向前走\n把今天写进歌里' });
        return Response.json({ Response: { TaskId: 'song-task' } });
      }
      expect(input).toEqual({ is_instrumental: true });
      return Response.json({ Response: { TaskId: 'instrumental-task' } });
    }
    expect(headers.get('X-TC-Action')).toBe('DescribeAigcAudioTask');
    expect(['song-task', 'instrumental-task']).toContain(body.TaskId);
    return Response.json({ Response: {
      Status: 'DONE', AudioInfos: [{ Url: 'https://track-123456.cos.ap-guangzhou.myqcloud.com/music.mp3', Duration: 45 }],
    } });
  });
  vi.stubGlobal('fetch', remote);
  const first = (await enqueueMusicJob(conversationId, transcriptId, 'tencent-song', {
    ...song, lyrics: '沿着海风向前走\n把今天写进歌里',
  })).job!;
  const second = (await enqueueMusicJob(conversationId, transcriptId, 'tencent-instrumental', {
    title: 'Quiet morning', mode: 'instrumental', prompt: 'Acoustic guitar',
  })).job!;
  await tick();
  await tick();
  expect(getMusicJob(conversationId, first.id)).toMatchObject({ state: 'submitted', provider_task_id: 'song-task' });
  expect(getMusicJob(conversationId, second.id)).toMatchObject({ state: 'submitted', provider_task_id: 'instrumental-task' });
  closeXopcDatabase();
  openXopcDatabase({ path: database });
  vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 9_000);
  await tick();
  await tick();
  expect(listMusicJobs(conversationId, transcriptId)).toMatchObject([
    { id: second.id, state: 'completed', durationMs: 45_000 },
    { id: first.id, state: 'completed', durationMs: 45_000 },
  ]);
  const actions = remote.mock.calls.map(([, init]) => new Headers(init?.headers).get('X-TC-Action')).filter(Boolean);
  expect(actions).toEqual(['CreateAigcAudioTask', 'CreateAigcAudioTask', 'DescribeAigcAudioTask', 'DescribeAigcAudioTask']);
});

afterEach(() => {
  closeXopcDatabase();
  rmSync(directory, { recursive: true, force: true });
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function tick() {
  const worker = new MusicGenerationWorker();
  worker.start();
  await worker.stop();
}

it('reuses a tool receipt, resumes a paid Mureka task across restart, and keeps exact lyrics in a revision', async () => {
  const audio = Buffer.from('fffb9064' + '00'.repeat(414), 'hex');
  const remote = vi.fn()
    .mockResolvedValueOnce(Response.json({ id: 'task-1', status: 'preparing' }))
    .mockResolvedValueOnce(Response.json({ status: 'succeeded', choices: [{ url: 'https://cdn.mureka.cn/result.mp3', duration: 94000 }] }))
    .mockResolvedValueOnce(new Response(null, { status: 503 }))
    .mockResolvedValueOnce(Response.json({ status: 'succeeded', choices: [{ url: 'https://cdn.mureka.cn/result.mp3', duration: 94000 }] }))
    .mockResolvedValueOnce(new Response(audio));
  vi.stubGlobal('fetch', remote);

  const first = (await enqueueMusicJob(conversationId, transcriptId, 'call-1', song)).job!;
  expect((await enqueueMusicJob(conversationId, transcriptId, 'call-1', song)).job?.id).toBe(first.id);
  expect((await enqueueMusicJob(conversationId, transcriptId, 'call-1', { ...song, title: 'Changed' })).error).toMatch(/different input/);
  await tick();
  expect(remote.mock.calls[0][0].href).toBe('https://api.mureka.cn/v1/song/generate');
  expect(JSON.parse(remote.mock.calls[0][1].body)).toEqual({
    model: 'mureka-9.5', n: 1, prompt: song.prompt, lyrics: song.lyrics,
  });

  closeXopcDatabase();
  openXopcDatabase({ path: database });
  const now = Date.now();
  const clock = vi.spyOn(Date, 'now').mockReturnValue(now + 9_000);
  await tick();
  expect(listMusicJobs(conversationId, transcriptId)[0]).toMatchObject({ state: 'saving', errorCode: 'audio_retrying' });
  clock.mockReturnValue(now + 30_000);
  await tick();
  expect(getMusicJob(conversationId, first.id)).toMatchObject({ state: 'completed', duration_ms: 94000 });
  expect(listMusicJobs(conversationId, transcriptId)[0].errorCode).toBeNull();
  expect(remote.mock.calls.map(([url]) => url.pathname)).toEqual([
    '/v1/song/generate', '/v1/song/query/task-1', '/result.mp3', '/v1/song/query/task-1', '/result.mp3',
  ]);
  expect(remote.mock.calls[4][1].headers).toBeUndefined();

  const response = await readMusicArtifact(first.id, 'bytes=0-3');
  expect(response.status).toBe(206);
  expect(Buffer.from(await response.arrayBuffer()).toString('hex')).toBe('fffb9064');
  const revision = (await enqueueMusicJob(conversationId, transcriptId, 'call-2', { parentId: first.id, prompt: 'Slower' })).job;
  expect(revision).toMatchObject({ workId: first.workId, parentId: first.id, lyrics: song.lyrics, versionNumber: 2 });
});

it('uses the configured international endpoint and does not retry an ambiguous instrumental submission', async () => {
  vi.stubEnv('XOPC_MUSIC_MODEL', 'mureka-global/mureka-9.5');
  const remote = vi.fn().mockRejectedValue(new Error('connection lost'));
  vi.stubGlobal('fetch', remote);
  const input = { title: 'Travel', mode: 'instrumental' as const, prompt: 'Acoustic' };
  const job = (await enqueueMusicJob(conversationId, transcriptId, 'call-1', input)).job!;
  await tick();
  vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 180_000);
  await tick();
  expect(listMusicJobs(conversationId, transcriptId)[0]).toMatchObject({
    id: job.id, state: 'submission_unknown', errorCode: null,
  });
  expect(remote).toHaveBeenCalledTimes(1);
  expect(remote.mock.calls[0][0].href).toBe('https://api.mureka.ai/v1/instrumental/generate');
  expect(JSON.parse(remote.mock.calls[0][1].body)).not.toHaveProperty('lyrics');
});

it('persists a rejected HTTP 429 as a known provider failure', async () => {
  const remote = vi.fn().mockResolvedValue(new Response(null, { status: 429 }));
  vi.stubGlobal('fetch', remote);
  const { job } = await enqueueMusicJob(conversationId, transcriptId, 'rate-limited', song);
  await tick();
  closeXopcDatabase();
  openXopcDatabase({ path: database });
  await tick();
  expect(listMusicJobs(conversationId, transcriptId)[0]).toMatchObject({
    id: job?.id, state: 'failed', errorCode: 'provider_rate_limited',
  });
  expect(remote).toHaveBeenCalledTimes(1);
});
