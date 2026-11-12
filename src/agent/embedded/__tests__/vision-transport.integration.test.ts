import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import sharp from 'sharp';
import { Type } from '@sinclair/typebox';
import { expect, it, vi } from 'vitest';

vi.mock('../model-runtime.js', async () => {
  const { ModelRuntime } = await import('@earendil-works/pi-coding-agent');
  const { InMemoryModelsStore, InMemoryCredentialStore } = await import('@earendil-works/pi-ai');
  return { resolveEmbeddedProviderApiKeySync: () => 'fixture', createEmbeddedModelRuntime: async () => {
    const runtime = await ModelRuntime.create({ credentials: new InMemoryCredentialStore(),
      modelsStore: new InMemoryModelsStore(), modelsPath: null, refreshOnCreate: false });
    await runtime.setRuntimeApiKey('deepseek', 'fixture');
    return runtime;
  } };
});

import { runXopcEmbeddedTurn } from '../run-turn.js';
import { createSqliteTranscriptRuntime, InMemoryTranscriptRuntime } from '../transcript-runtime.js';
import { evictEmbeddedSessionRunner } from '../session-runner.js';
import { initializeTestAgentCatalog } from '../../../agent-catalog/test-support.js';
import { createConversation } from '../../../storage/sqlite/conversation-repository.js';
import { claimNextSessionInput, finishSessionInputRun, getSessionInputById, insertSessionInput } from '../../../storage/sqlite/session-input-repository.js';
import { closeXopcDatabase } from '../../../storage/sqlite/connection.js';
import { SessionStore } from '../../../session/store.js';
import { onSessionTranscriptUpdate } from '../../../session/transcript-events.js';
import { ConfigSchema } from '../../../config/schema.js';
import { clearPendingTranscriptUserMessage, setPendingTranscriptUserMessage } from '../../inbound/attachment-pipeline.js';
import { persistInboundAttachments } from '../../../channels/attachments/inbound-persist.js';
import { TurnDispatcher, type TurnDispatcherConfig } from '../../inbound/turn-dispatcher.js';
import { injectSourceContextsIntoUserMessage } from '../../source-context/injector.js';
import { createLogger } from '../../../utils/logger.js';
import type { AgentSourceContext } from '../../source-context/types.js';

it('steers attachments and reference images through a live AgentSession and stores metadata only', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'xopc-rich-steer-'));
  initializeTestAgentCatalog();
  const conversationId = createConversation({ agentId: 'main' }).key;
  const runId = randomUUID();
  const origin = { type: 'endpoint' as const, endpointId: 'browser' };
  insertSessionInput({ id: randomUUID(), conversationId, clientMessageId: 'initial-input', content: 'Start work.',
    requestedDelivery: 'next', effectiveDelivery: 'next', status: 'queued', origin });
  claimNextSessionInput(conversationId, runId);
  const steeringInput = insertSessionInput({
    id: randomUUID(), conversationId, clientMessageId: 'steering-input', content: 'Change course',
    requestedDelivery: 'steer', effectiveDelivery: 'steer', status: 'injecting', origin, targetRunId: runId,
  });
  const config = ConfigSchema.parse({ userContext: { enabled: false } });
  const store = new SessionStore({ config });
  const unsubscribe = onSessionTranscriptUpdate(update => { void store.syncEmbeddedTranscriptUpdate(update); });
  const image = await sharp({ create: { width: 16, height: 16, channels: 3, background: '#ff0000' } }).png().toBuffer();
  const imagePart = { type: 'image' as const, data: image.toString('base64'), mimeType: 'image/png' };
  const contexts: AgentSourceContext[] = [{ kind: 'note', sourceId: 'fixture-note', version: 'v1',
    title: 'Frozen note', text: 'Use the revised design', images: [imagePart] }];
  const dispatcher = new TurnDispatcher({
    log: createLogger('SteeringTest'), requireConfig: () => config,
    agentManager: { getResolvedWorkspaceForSession: () => directory },
    modelManager: { getModelForSession: () => 'openai/gpt-4o' },
    prepareInboundAttachments: async (_id: string, attachments: Parameters<typeof persistInboundAttachments>[0]) => persistInboundAttachments(attachments),
  } as unknown as TurnDispatcherConfig);
  const requests: Array<{ messages: Array<{ role: string; content: unknown }> }> = [];
  const server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on('data', chunk => chunks.push(Buffer.from(chunk)));
    request.on('end', () => {
      requests.push(JSON.parse(Buffer.concat(chunks).toString()));
      const first = requests.length === 1;
      const delta = first ? { role: 'assistant', tool_calls: [{ index: 0, id: 'wait-call', type: 'function',
        function: { name: 'fixture_wait', arguments: '{}' } }] } : { role: 'assistant', content: 'Revised design received.' };
      response.writeHead(200, { 'content-type': 'text/event-stream' });
      response.end(`data: ${JSON.stringify({ id: 'fixture', object: 'chat.completion.chunk', model: 'deepseek-flash', choices: [{ index: 0, delta, finish_reason: null }] })}\n\n`
        + `data: ${JSON.stringify({ id: 'fixture', object: 'chat.completion.chunk', model: 'deepseek-flash', choices: [{ index: 0, delta: {}, finish_reason: first ? 'tool_calls' : 'stop' }] })}\n\ndata: [DONE]\n\n`);
    });
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const result = await runXopcEmbeddedTurn({ conversationId, runId, workspaceDir: directory,
      transcriptRuntime: await createSqliteTranscriptRuntime({ conversationId, sessionStore: store }),
      userMessage: { role: 'user', content: 'Start work.', timestamp: Date.now() },
      systemPrompt: 'Use fixture_wait once.', thinkingLevel: 'off', timeoutMs: 10000,
      modelRef: 'deepseek/deepseek-flash', model: { id: 'deepseek-flash', name: 'Fixture', provider: 'deepseek', api: 'openai-completions',
        baseUrl: `http://127.0.0.1:${(server.address() as { port: number }).port}/v1`, input: ['text', 'image'], reasoning: false,
        contextWindow: 128000, maxTokens: 1000, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } },
      tools: [{ name: 'fixture_wait', label: 'Wait', description: 'Accept a steering message.', parameters: Type.Object({}),
        execute: async () => {
          const enriched = injectSourceContextsIntoUserMessage({ role: 'user', content: 'Change course', timestamp: Date.now() }, contexts);
          const text = (enriched.content as Array<{ text: string }>)[0]!.text;
          expect(await dispatcher.steerWebchatSession(conversationId, text, runId, { sourceContexts: contexts,
            clientMessageId: steeringInput.clientMessageId,
            attachments: [{ type: 'image', name: 'design.png', mimeType: 'image/png', data: imagePart.data },
              { type: 'file', name: 'brief.txt', mimeType: 'text/plain', data: Buffer.from('Updated brief').toString('base64') }],
          })).toBe(true);
          expect(getSessionInputById(conversationId, steeringInput.id)?.status).toBe('injecting');
          return { content: [{ type: 'text' as const, text: 'Ready.' }], details: {} };
        } }],
    });
    expect(result, result.errorMessage).toMatchObject({ ok: true });
    expect(requests).toHaveLength(2);
    const wire = JSON.stringify(requests[1]);
    expect(wire).toContain('Use the revised design');
    expect(wire).toContain('brief.txt');
    expect(wire.match(/"type":"image_url"/g)).toHaveLength(2);
    const messages = await store.loadMessages(conversationId);
    const steered = messages.find(message => message.role === 'user' && JSON.stringify(message).includes('Change course'));
    expect(steered).toMatchObject({ media: [{ name: 'design.png' }, { name: 'brief.txt' }],
      metadata: { clientMessageId: steeringInput.clientMessageId, steered: true,
        sourceContexts: [{ sourceId: 'fixture-note', version: 'v1' }] } });
    expect(JSON.stringify(steered)).not.toContain(imagePart.data);
    finishSessionInputRun(conversationId, runId, 'cancelled');
    expect(getSessionInputById(conversationId, steeringInput.id)?.status).toBe('completed');
  } finally {
    unsubscribe(); evictEmbeddedSessionRunner(conversationId); server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
    closeXopcDatabase(); await rm(directory, { recursive: true, force: true });
  }
}, 15000);

it.each([false, true])('delivers a tool-produced image through AgentSession to HTTP (persistent=%s)', async persistent => {
  const directory = await mkdtemp(join(tmpdir(), 'xopc-tool-image-wire-'));
  initializeTestAgentCatalog();
  const conversationId = createConversation({ agentId: 'main' }).key;
  const image = await sharp(randomBytes(256 * 256 * 3), { raw: { width: 256, height: 256, channels: 3 } }).png().toBuffer();
  const store = new SessionStore({ config: ConfigSchema.parse({ userContext: { enabled: false } }) });
  const unsubscribe = onSessionTranscriptUpdate(update => { void store.syncEmbeddedTranscriptUpdate(update); });
  let receivedImage = false, calls = 0;
  const server = createServer((request, response) => {
    const chunks: Buffer[] = []; request.on('data', chunk => chunks.push(Buffer.from(chunk)));
    request.on('end', () => {
      const body = JSON.parse(Buffer.concat(chunks).toString()); calls++;
      receivedImage ||= (body.messages ?? []).some((message: any) => Array.isArray(message.content) && message.content.some((part: any) => part.type === 'image_url'));
      const delta = calls === 1 ? { role: 'assistant', tool_calls: [{ index: 0, id: 'fixture-call', type: 'function', function: { name: 'fixture_screenshot', arguments: '{}' } }] }
        : { role: 'assistant', content: 'Image inspected.' };
      response.writeHead(200, { 'content-type': 'text/event-stream' });
      response.end(`data: ${JSON.stringify({ id: 'fixture', object: 'chat.completion.chunk', model: 'deepseek-flash', choices: [{ index: 0, delta, finish_reason: null }] })}\n\n`
        + `data: ${JSON.stringify({ id: 'fixture', object: 'chat.completion.chunk', model: 'deepseek-flash', choices: [{ index: 0, delta: {}, finish_reason: calls === 1 ? 'tool_calls' : 'stop' }] })}\n\ndata: [DONE]\n\n`);
    });
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const result = await runXopcEmbeddedTurn({ conversationId, runId: randomUUID(), workspaceDir: directory,
      transcriptRuntime: persistent ? await createSqliteTranscriptRuntime({ conversationId, sessionStore: store }) : new InMemoryTranscriptRuntime({ runtimeId: conversationId, cwd: directory }),
      userMessage: { role: 'user', content: 'Capture the fixture image and inspect it.', timestamp: Date.now() },
      systemPrompt: 'Use the fixture screenshot tool once.', thinkingLevel: 'off', timeoutMs: 10000,
      modelRef: 'deepseek/deepseek-flash', model: { id: 'deepseek-flash', name: 'Fixture', provider: 'deepseek', api: 'openai-completions',
        baseUrl: `http://127.0.0.1:${(server.address() as { port: number }).port}/v1`, input: ['text', 'image'], reasoning: false,
        contextWindow: 128000, maxTokens: 1000, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } },
      tools: [{ name: 'fixture_screenshot', label: 'Fixture screenshot', description: 'Return a synthetic image.', parameters: Type.Object({}),
        execute: async () => ({ content: [{ type: 'image' as const, data: image.toString('base64'), mimeType: 'image/png' }], details: {} }) }],
    });
    expect(result, result.errorMessage).toMatchObject({ ok: true }); expect(calls).toBe(2); expect(receivedImage).toBe(true);
  } finally {
    unsubscribe(); evictEmbeddedSessionRunner(conversationId); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()));
    closeXopcDatabase(); await rm(directory, { recursive: true, force: true });
  }
});

it.each([false, true])('preserves alternating image bytes through the real AgentSession and HTTP adapter (persistent=%s)', async persistent => {
  const directory = await mkdtemp(join(tmpdir(), 'xopc-vision-wire-'));
  initializeTestAgentCatalog();
  const conversationId = createConversation({ agentId: 'main' }).key;
  const store = new SessionStore({ config: ConfigSchema.parse({ userContext: { enabled: false } }) });
  const unsubscribe = onSessionTranscriptUpdate(update => { void store.syncEmbeddedTranscriptUpdate(update); });
  const captures: Array<Array<{ hash: string; means: number[] }>> = [];
  const server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on('data', chunk => chunks.push(Buffer.from(chunk)));
    request.on('end', () => { void (async () => {
      const body = JSON.parse(Buffer.concat(chunks).toString());
      const images: Array<{ hash: string; means: number[] }> = [];
      for (const message of body.messages ?? body.input ?? []) {
        if (!Array.isArray(message.content)) continue;
        for (const block of message.content) {
          if (!['image_url', 'input_image'].includes(block.type)) continue;
          const url = typeof block.image_url === 'string' ? block.image_url : block.image_url.url;
          const data = Buffer.from(url.split(',')[1], 'base64');
          images.push({ hash: createHash('sha256').update(data).digest('hex'),
            means: (await sharp(data).stats()).channels.map(channel => channel.mean) });
        }
      }
      captures.push(images);
      response.writeHead(200, { 'content-type': 'text/event-stream' });
      if (request.url?.endsWith('/responses')) {
        response.end(`data: ${JSON.stringify({ type: 'response.completed', response: {
          id: 'fixture', status: 'completed', output: [], usage: { input_tokens: 10, output_tokens: 0, total_tokens: 10 },
        } })}\n\n`);
        return;
      }
      response.write(`data: ${JSON.stringify({ id: 'fixture', object: 'chat.completion.chunk', model: 'gpt-4.1',
        choices: [{ index: 0, delta: { role: 'assistant', content: 'Image received.' }, finish_reason: null }] })}\n\n`);
      response.end(`data: ${JSON.stringify({ id: 'fixture', object: 'chat.completion.chunk', model: 'gpt-4.1',
        choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
        usage: { prompt_tokens: 10, completion_tokens: 3, total_tokens: 13 } })}\n\ndata: [DONE]\n\n`);
    })().catch(error => { response.writeHead(500); response.end(String(error)); }); });
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as { port: number }).port;
  const runtime = persistent ? await createSqliteTranscriptRuntime({ conversationId, sessionStore: store })
    : new InMemoryTranscriptRuntime({ runtimeId: conversationId, cwd: directory });
  try {
    for (const color of ['#ff0000', '#0000ff', '#ff0000']) {
      const data = await sharp({ create: { width: 64, height: 64, channels: 3, background: color } }).png().toBuffer();
      const media = await persistInboundAttachments([{ type: 'image', name: 'fixture.png', mimeType: 'image/png', data: data.toString('base64') }]);
      const userMessage = { role: 'user' as const, content: 'Describe this image.', timestamp: Date.now(), media };
      if (persistent) setPendingTranscriptUserMessage(conversationId, userMessage);
      const result = await runXopcEmbeddedTurn({ conversationId, runId: randomUUID(), workspaceDir: directory,
        transcriptRuntime: runtime, userMessage,
        images: [{ type: 'image', data: data.toString('base64'), mimeType: 'image/png' }],
        systemPrompt: 'Describe the current image.', thinkingLevel: 'off', timeoutMs: 10_000,
        modelRef: 'deepseek/deepseek-flash', tools: [], model: { id: 'deepseek-flash', name: 'Fixture', provider: 'deepseek',
          api: 'openai-completions', baseUrl: `http://127.0.0.1:${port}/v1`, input: ['text', 'image'],
          reasoning: false, contextWindow: 128000, maxTokens: 1000,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } },
      });
      expect(result, result.errorMessage).toMatchObject({ ok: true });
      expect(captures.at(-1)?.at(-1)).toEqual({ hash: createHash('sha256').update(data).digest('hex'),
        means: color === '#ff0000' ? [255, 0, 0] : [0, 0, 255] });
      clearPendingTranscriptUserMessage(conversationId);
    }
    expect(captures).toHaveLength(3);
  } finally {
    evictEmbeddedSessionRunner(conversationId);
    unsubscribe();
    closeXopcDatabase();
    await new Promise<void>(resolve => server.close(() => resolve()));
    await rm(directory, { recursive: true, force: true });
  }
}, 30000);
