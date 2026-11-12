import { once } from 'node:events';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { serve } from '@hono/node-server';
import { expect, it, vi } from 'vitest';

import { createMusicGenerationTool } from '../../agent/tools/music-generation-tool.js';
import { ConfigSchema } from '../../config/schema.js';
import { resolveMediaBufferPath } from '../../media/store.js';
import { configuredMusicModel, resolveMusicKey } from '../../music-generation/providers.js';
import { listMusicJobs } from '../../music-generation/repository.js';
import { closeXopcDatabase, openXopcDatabase, resetXopcDatabaseSingletonForTest } from '../../storage/sqlite/connection.js';
import { createConversation } from '../../storage/sqlite/conversation-repository.js';
import { getSessionMetadata, resetSessionRecord } from '../../storage/sqlite/session-repository.js';
import { getSqliteDatabase } from '../../storage/sqlite/transaction.js';
import { createHonoApp } from '../hono/app.js';
import type { GatewayService } from '../service.js';

it('serves jobs created by the Agent and scoped audio through the authenticated Gateway', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'xopc-music-http-'));
  vi.stubEnv('XOPC_STATE_DIR', dir);
  vi.stubEnv('XOPC_CREDENTIALS_DIR', join(dir, 'credentials'));
  vi.stubEnv('MUREKA_API_KEY', 'test-key');
  vi.stubEnv('MUREKA_CN_API_KEY', '');
  vi.stubEnv('MUREKA_GLOBAL_API_KEY', '');
  vi.stubEnv('XOPC_MUSIC_MODEL', '');
  vi.stubEnv('XOPC_MUSIC_DAILY_LIMIT', '');
  resetXopcDatabaseSingletonForTest();
  openXopcDatabase({ path: join(dir, 'xopc.db') });
  const token = 'music-generation-test-token';
  const app = createHonoApp({ service: {
    currentConfig: ConfigSchema.parse({ gateway: { auth: { mode: 'token', token } } }),
    getResolvedAuth: () => ({ mode: 'token', token }),
    getAuthToken: () => token,
    isGatewayReady: () => true,
    getExtensionLoader: () => null,
    getModelCatalogSync: () => ({}),
    sessionIndexInstance: { getSessionMetadata },
  } as unknown as GatewayService });
  const server = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: 0 });
  try {
    if (!server.listening) await once(server, 'listening');
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing test Gateway address');
    const base = `http://127.0.0.1:${address.port}/api/music-generation`;
    const settings = `${base}/settings`;
    const credentials = `${settings}/credentials/mureka-global`;
    const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
    expect((await fetch(settings)).status).toBe(401);
    expect(await (await fetch(settings, { headers })).json()).toMatchObject({
      modelRef: 'mureka-cn/mureka-9.5', credentials: { 'mureka-cn': 'environment' },
    });
    const selected = await fetch(settings, {
      method: 'PUT', headers, body: JSON.stringify({ modelRef: 'mureka-global/mureka-9.5' }),
    });
    expect(selected.status).toBe(200);
    expect(await selected.json()).toMatchObject({ modelRef: 'mureka-global/mureka-9.5' });
    const defaults = await fetch(settings, {
      method: 'PATCH', headers, body: JSON.stringify({ modelRef: 'mureka-global/mureka-9.5', mode: 'instrumental' }),
    });
    expect(defaults.status).toBe(200);
    expect(await defaults.json()).toMatchObject({ defaults: { mode: 'instrumental' } });
    const saved = await fetch(credentials, {
      method: 'PUT', headers, body: JSON.stringify({ apiKey: 'gateway-music-test-key' }),
    });
    expect(saved.status).toBe(200);
    const savedBody = await saved.text();
    expect(savedBody).not.toContain('gateway-music-test-key');
    expect(JSON.parse(savedBody)).toMatchObject({ credentials: { 'mureka-global': 'saved', 'mureka-cn': 'environment' } });
    const reveal = `http://127.0.0.1:${address.port}/api/providers/mureka-global/reveal-api-key`;
    expect((await fetch(reveal, { method: 'POST' })).status).toBe(401);
    expect(await (await fetch(reveal, { method: 'POST', headers })).json()).toMatchObject({
      payload: { apiKey: 'gateway-music-test-key', source: 'credential' },
    });
    const route = await configuredMusicModel();
    expect(route?.ref).toBe('mureka-global/mureka-9.5');
    expect(await resolveMusicKey(route!.provider)).toBe('gateway-music-test-key');
    const session = createConversation({ agentId: 'main', sourceChannel: 'webchat', sessionType: 'chat' });
    const other = createConversation({ agentId: 'main', sourceChannel: 'webchat', sessionType: 'chat' });
    const tool = createMusicGenerationTool(() => session.key);
    await tool.execute('compose-one', { action: 'generate', title: 'Rain', prompt: 'Gentle piano' });
    const [job] = listMusicJobs(session.key, session.transcriptId!);
    expect(job).toMatchObject({ modelRef: 'mureka-global/mureka-9.5', mode: 'instrumental' });
    const removed = await fetch(credentials, { method: 'DELETE', headers });
    expect(removed.status).toBe(200);
    expect(await removed.json()).toMatchObject({ credentials: { 'mureka-global': 'environment' } });
    expect(await resolveMusicKey(route!.provider)).toBe('test-key');
    expect(await (await fetch(reveal, { method: 'POST', headers })).json()).toMatchObject({
      payload: { apiKey: null, source: 'none' },
    });
    const jobs = `${base}/sessions/${session.key}/jobs`;
    const audio = `${jobs}/${job.id}/audio`;

    expect((await fetch(jobs)).status).toBe(401);
    expect(await (await fetch(jobs, { headers })).json()).toMatchObject({ configured: true, jobs: [{ id: job.id, state: 'queued' }] });
    expect((await fetch(audio, { headers })).status).toBe(404);
    getSqliteDatabase().prepare("UPDATE music_generation_jobs SET state = 'completed' WHERE id = ?").run(job.id);
    const path = resolveMediaBufferPath(`music-${job.id}.mp3`, 'outbound');
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, '0123456789');
    expect((await fetch(`${base}/sessions/${other.key}/jobs/${job.id}/audio`, { headers })).status).toBe(404);
    const range = await fetch(audio, { headers: { ...headers, range: 'bytes=2-5' } });
    expect(range.status).toBe(206);
    expect(range.headers.get('content-type')).toBe('audio/mpeg');
    expect(await range.text()).toBe('2345');
    const download = await fetch(`${audio}?download=1`, { headers });
    expect(download.headers.get('content-disposition')).toContain('attachment');
    expect(await download.text()).toBe('0123456789');

    const tencent = `${settings}/credentials/tencent-mps`;
    const pair = { secretId: 'fixture-tencent-id', secretKey: 'fixture-tencent-key' };
    const revealRequest = { method: 'POST', body: JSON.stringify({ field: 'secretId' }) };
    expect((await fetch(tencent, revealRequest)).status).toBe(401);
    expect((await fetch(tencent, { method: 'PUT', headers, body: JSON.stringify({ secretId: pair.secretId }) })).status).toBe(400);
    const savedTencent = await fetch(tencent, { method: 'PUT', headers, body: JSON.stringify(pair) });
    expect(savedTencent.status).toBe(200);
    const tencentBody = await savedTencent.text();
    expect(tencentBody).not.toContain(pair.secretId);
    expect(tencentBody).not.toContain(pair.secretKey);
    expect(JSON.parse(tencentBody)).toMatchObject({ credentials: { 'tencent-mps': 'saved' } });
    const selectedTencent = await fetch(settings, {
      method: 'PUT', headers, body: JSON.stringify({ modelRef: 'tencent-mps/minimax-music-3.0' }),
    });
    expect(await selectedTencent.json()).toMatchObject({ modelRef: 'tencent-mps/minimax-music-3.0' });
    const revealedTencent = await fetch(tencent, { ...revealRequest, headers });
    expect(revealedTencent.headers.get('cache-control')).toBe('no-store');
    expect(await revealedTencent.json()).toEqual({ value: pair.secretId });
    const genericReveal = `http://127.0.0.1:${address.port}/api/providers/tencent-mps/reveal-api-key`;
    expect((await fetch(genericReveal, { method: 'POST', headers })).status).toBe(403);
    expect((await fetch(tencent, { method: 'DELETE', headers })).status).toBe(200);
    expect(await (await fetch(tencent, { ...revealRequest, headers })).json()).toEqual({ value: null });

    resetSessionRecord(session.key, dir);
    expect(await (await fetch(jobs, { headers })).json()).toMatchObject({ jobs: [] });
    expect((await fetch(audio, { headers })).status).toBe(404);
  } finally {
    if (server.listening) await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    closeXopcDatabase();
    resetXopcDatabaseSingletonForTest();
    vi.unstubAllEnvs();
    rmSync(dir, { recursive: true, force: true });
  }
}, 30_000);
