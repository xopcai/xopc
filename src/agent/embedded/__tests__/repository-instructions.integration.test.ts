import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createAssistantMessageEventStream, getCurrentSystemPrompt, type AssistantMessage } from '@earendil-works/pi-ai';
import { expect, it, vi } from 'vitest';

const scripted = vi.hoisted(() => ({ stream: vi.fn() }));
vi.mock('../xopc-stream-bridge.js', () => ({ wrapStreamFnForXopcExtensions: () => scripted.stream }));
vi.mock('../model-runtime.js', async () => {
  const { ModelRuntime } = await import('@earendil-works/pi-coding-agent');
  const { InMemoryModelsStore, InMemoryCredentialStore } = await import('@earendil-works/pi-ai');
  return {
    resolveEmbeddedProviderApiKeySync: () => 'test',
    createEmbeddedModelRuntime: async () => {
      const runtime = await ModelRuntime.create({ credentials: new InMemoryCredentialStore(), modelsStore: new InMemoryModelsStore(), modelsPath: null, refreshOnCreate: false });
      await runtime.setRuntimeApiKey('openai', 'test');
      return runtime;
    },
  };
});

import { runXopcEmbeddedTurn } from '../run-turn.js';
import { InMemoryTranscriptRuntime } from '../transcript-runtime.js';
import { evictEmbeddedSessionRunner } from '../session-runner.js';
import { createReadFileTool } from '../../tools/read.js';
import { ProjectTrustStore } from '../../../project-trust/trust-store.js';
import { SystemPromptBuilder } from '../../prompt/service-prompt-builder.js';

it('applies one trusted repository instruction source and removes it after trust is revoked', async () => {
  const root = await mkdtemp(join(tmpdir(), 'embedded-instructions-'));
  const conversationId = crypto.randomUUID();
  const trustStore = new ProjectTrustStore();
  const transcriptRuntime = new InMemoryTranscriptRuntime({ runtimeId: conversationId, cwd: root });
  const prompts: string[] = [];
  let round = 0;
  scripted.stream.mockReset().mockImplementation((_model, context) => {
    prompts.push(getCurrentSystemPrompt(context.messages));
    const first = round++ % 2 === 0;
    const message = { role: 'assistant', api: 'openai-completions', provider: 'openai', model: 'gpt-4.1',
      content: first ? [{ type: 'toolCall', id: `read-${round}`, name: 'read_file', arguments: { path: 'src/note.md' } }]
        : [{ type: 'text', text: 'Verified result.' }],
      stopReason: first ? 'toolUse' : 'stop', timestamp: Date.now(),
      usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
    } as AssistantMessage;
    const stream = createAssistantMessageEventStream();
    stream.push({ type: 'done', reason: message.stopReason as 'stop' | 'toolUse', message });
    return stream;
  });
  try {
    await mkdir(join(root, 'src'));
    await writeFile(join(root, 'AGENTS.md'), 'UNIQUE_ROOT_RULE');
    await writeFile(join(root, 'src/AGENTS.md'), 'UNIQUE_NESTED_RULE');
    await writeFile(join(root, 'src/note.md'), 'Evidence');
    const builder = new SystemPromptBuilder({ workspace: root, config: {} as never,
      skillManager: { getPromptForSkillAllowlist: () => '' } as never });
    const params = { conversationId, workspaceDir: root, transcriptRuntime,
      userMessage: { role: 'user' as const, content: 'Read src/note.md.', timestamp: Date.now() },
      systemPrompt: builder.build([{ path: 'profile/AGENTS.md', content: 'UNIQUE_PROFILE_RULE' }], {
        registeredToolNames: ['read_file'],
      }),
      modelRef: 'openai/gpt-4.1', timeoutMs: 10000,
      model: { id: 'gpt-4.1', name: 'Test', provider: 'openai', api: 'openai-completions' as const,
        baseUrl: 'https://example.invalid', reasoning: false, input: ['text' as const], contextWindow: 128000,
        maxTokens: 4096, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } },
      tools: [createReadFileTool(root)] };
    for (const [decision, temporary, included] of [
      [null, undefined, false],
      [null, true, true],
      [false, true, false],
      [true, undefined, true],
    ] as const) {
      trustStore.set(root, decision);
      const firstRequest = prompts.length;
      const result = await runXopcEmbeddedTurn({ ...params, runId: crypto.randomUUID(),
        isWorkspaceTrusted: temporary === undefined ? undefined : () => temporary });
      expect(result).toMatchObject({ ok: true, lastAssistantText: 'Verified result.' });
      expect(prompts.length - firstRequest).toBe(2);
      for (const prompt of prompts.slice(firstRequest)) {
        expect(prompt.match(/UNIQUE_PROFILE_RULE/g)).toHaveLength(1);
        expect(prompt.match(/UNIQUE_ROOT_RULE/g) ?? []).toHaveLength(included ? 1 : 0);
      }
      const rows = await transcriptRuntime.loadMessages();
      const lastRead = rows.filter(row => row.role === 'toolResult').at(-1);
      expect(JSON.stringify(lastRead)).toContain('Evidence');
      expect(JSON.stringify(lastRead).includes('UNIQUE_NESTED_RULE')).toBe(included);
    }
  } finally {
    evictEmbeddedSessionRunner(conversationId);
    trustStore.set(root, null);
    await rm(root, { recursive: true, force: true });
  }
}, 20000);
