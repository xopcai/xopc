import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import sharp from 'sharp';
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
import { closeXopcDatabase } from '../../../storage/sqlite/connection.js';
import { SessionStore } from '../../../session/store.js';
import { onSessionTranscriptUpdate } from '../../../session/transcript-events.js';
import { ConfigSchema } from '../../../config/schema.js';
import { clearPendingTranscriptUserMessage, setPendingTranscriptUserMessage } from '../../inbound/attachment-pipeline.js';
import { persistInboundAttachments } from '../../../channels/attachments/inbound-persist.js';

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
