import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { GatewayRealtimeBackend } from '../gateway-realtime-backend.js';

let directory: string;
it('unfreezes explicitly rejected commands but retains ambiguous failures', async () => {
  const request = vi.fn(); vi.stubGlobal('fetch', request);
  const backend = new GatewayRealtimeBackend({ url: 'http://127.0.0.1:1' });
  (backend as unknown as { draftDirectory: string }).draftDirectory = directory;
  const id = await backend.createConversation('writer');
  await backend.patchSession(id, { model: 'test/model' });
  request.mockResolvedValueOnce(new Response(JSON.stringify({ error: { code: 'BAD_REQUEST', message: 'Invalid thinking' } }), { status: 400 }));
  await expect(backend.sendChat({ conversationId: id, message: 'hello' })).rejects.toThrow('Invalid thinking');
  await expect(backend.patchSession(id, { thinkingLevel: 'off' })).resolves.toBeUndefined();
  expect(JSON.parse(await readFile(join(directory, `${id}.json`), 'utf8')).command).toBeUndefined();
  request.mockRejectedValueOnce(new Error('network lost'));
  await expect(backend.sendChat({ conversationId: id, message: 'changed' })).rejects.toThrow('network lost');
  await expect(backend.patchSession(id, { thinkingLevel: 'high' })).rejects.toThrow('awaiting confirmation');
});

it('binds a draft working directory and uses draft resource contexts', async () => {
  const request = vi.fn(); vi.stubGlobal('fetch', request);
  const backend = new GatewayRealtimeBackend({ url: 'http://127.0.0.1:1' });
  (backend as unknown as { draftDirectory: string }).draftDirectory = directory;
  const id = await backend.createConversation('writer');
  request.mockResolvedValueOnce(new Response(JSON.stringify({ project: { id: 'p' } })));
  await backend.patchSession(id, { workingDirectory: '/work/project' });
  expect(JSON.parse(await readFile(join(directory, `${id}.json`), 'utf8')).creation.projectId).toBe('p');
  request.mockResolvedValueOnce(new Response(JSON.stringify({ payload: {} })));
  await backend.getStartupResources(id);
  expect(String(request.mock.calls[1][0])).toContain('agentId=writer');
  request.mockResolvedValueOnce(new Response(JSON.stringify({ space: { id: 'space' } })));
  request.mockResolvedValueOnce(new Response(JSON.stringify({ items: [] })));
  await backend.searchWorkspaceFiles(id, 'readme');
  expect(String(request.mock.calls[2][0])).toContain('/contexts/project/p');
  request.mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, payload: {} })));
  await backend.getReviewContext(id);
  expect(String(request.mock.calls[4][0])).toContain('agentId=writer&projectId=p');
});
beforeEach(async () => { directory = await mkdtemp(join(tmpdir(), 'xopc-tui-draft-')); });
afterEach(async () => { vi.unstubAllGlobals(); await rm(directory, { recursive: true, force: true }); });

it('opens and edits a durable final UUID without fetching the Gateway', async () => {
  const request = vi.fn(); vi.stubGlobal('fetch', request);
  const backend = new GatewayRealtimeBackend({ url: 'http://127.0.0.1:1' });
  (backend as unknown as { draftDirectory: string }).draftDirectory = directory;
  const id = await backend.createConversation('writer');
  await backend.patchSession(id, { model: 'test/model', thinkingLevel: 'off' });
  expect(await backend.loadHistory({ conversationId: id })).toEqual({ messages: [] });
  expect(await backend.getSessionInfo(id)).toMatchObject({ agentId: 'writer', model: 'test/model' });
  expect(JSON.parse(await readFile(join(directory, `${id}.json`), 'utf8')).creation.model).toBe('test/model');
  expect(request).not.toHaveBeenCalled();
});

it('retains the frozen first command after an ambiguous acknowledgement and reuses its identity', async () => {
  const request = vi.fn(); vi.stubGlobal('fetch', request);
  const backend = new GatewayRealtimeBackend({ url: 'http://127.0.0.1:1' });
  (backend as unknown as { draftDirectory: string }).draftDirectory = directory;
  const id = await backend.createConversation('writer');
  await backend.patchSession(id, { model: 'test/model', thinkingLevel: 'off' });
  request.mockResolvedValueOnce(new Response('{}', { status: 202 }));
  await expect(backend.sendChat({ conversationId: id, message: 'hello' })).rejects.toThrow('Invalid input receipt');
  const first = JSON.parse(String(request.mock.calls[0][1].body));
  request.mockResolvedValueOnce(new Response(JSON.stringify({ payload: {
    receipt: { conversationId: id, clientMessageId: first.clientMessageId }, session: { transcriptId: 'transcript' }, inputState: { inputs: [] },
  } }), { status: 202 }));
  await backend.sendChat({ conversationId: id, message: 'hello' });
  expect(JSON.parse(String(request.mock.calls[1][1].body))).toEqual(first);
  await expect(readFile(join(directory, `${id}.json`), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
});
