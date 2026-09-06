import { execFileSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createAssistantMessageEventStream, type AssistantMessage } from '@earendil-works/pi-ai';
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
import { createApplyPatchTool } from '../../tools/apply-patch.js';
import { createExecCommandTool } from '../../tools/exec-command.js';
import { createReviewWorkspaceTool } from '../../tools/review-workspace.js';
import { createAgentTurnPolicy } from '../../orchestration/agent-turn-policy.js';

it('runs a real AgentSession through edit, early completion, bounded repair and final evidence', async () => {
  const root = await mkdtemp(join(tmpdir(), 'coding-harness-'));
  const sessionKey = `agent:coder:internal:${Date.now()}`;
  const runtime = new InMemoryTranscriptRuntime({ runtimeId: sessionKey, cwd: root });
  try {
    await writeFile(join(root, 'answer.mjs'), 'export const answer = 0;\n');
    await writeFile(join(root, 'test.mjs'), 'import { answer } from "./answer.mjs"; import assert from "node:assert/strict"; assert.equal(answer, 42);');
    execFileSync('git', ['init', '-q'], { cwd: root }); execFileSync('git', ['add', '.'], { cwd: root });
    execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@xopc.local', 'commit', '-qm', 'fixture'], { cwd: root });
    const responses: AssistantMessage['content'][] = [
      [{ type: 'toolCall', id: 'edit', name: 'apply_patch', arguments: { patch: '*** Begin Patch\n*** Update File: answer.mjs\n@@\n-export const answer = 0;\n+export const answer = 42;\n*** End Patch' } }],
      [{ type: 'text', text: 'Done early.' }],
      [{ type: 'toolCall', id: 'review', name: 'review_workspace', arguments: {} },
        { type: 'toolCall', id: 'check', name: 'exec_command', arguments: { cmd: 'node --test test.mjs' } }],
      [{ type: 'text', text: 'Verified the change.' }],
    ];
    scripted.stream.mockImplementation(() => {
      const content = responses.shift();
      if (!content) throw new Error('Harness made an unexpected extra model request');
      const message = { role: 'assistant', content, api: 'openai-completions', provider: 'openai', model: 'gpt-4.1',
        stopReason: content.some(block => block.type === 'toolCall') ? 'toolUse' : 'stop', timestamp: Date.now(),
        usage: { input: 10, output: 10, cacheRead: 0, cacheWrite: 0, totalTokens: 20, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
      } as AssistantMessage;
      const stream = createAssistantMessageEventStream();
      stream.push({ type: 'start', partial: message }); stream.push({ type: 'done', reason: message.stopReason as 'stop' | 'toolUse', message });
      return stream;
    });
    const events: string[] = [];
    const result = await runXopcEmbeddedTurn({
      sessionKey, runId: 'test-run', userMessage: { role: 'user', content: 'Fix answer.', timestamp: Date.now() },
      model: { id: 'gpt-4.1', name: 'Test', provider: 'openai', api: 'openai-completions', baseUrl: 'https://example.invalid', reasoning: false, input: ['text'], contextWindow: 128000, maxTokens: 4096, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }, modelRef: 'openai/gpt-4.1', systemPrompt: 'Fix and verify the code.',
      tools: [createApplyPatchTool(root), createExecCommandTool(root), createReviewWorkspaceTool(root)],
      workspaceDir: root, transcriptRuntime: runtime, timeoutMs: 10_000,
      turnPolicy: createAgentTurnPolicy({ maxTurns: 5 }), onAgentEvent: event => events.push(event.type),
    });
    expect(result, JSON.stringify(result)).toMatchObject({ ok: true, lastAssistantText: 'Verified the change.' });
    expect(responses).toHaveLength(0);
    expect(events).toContain('turn_end'); expect(events).toContain('tool_execution_end');
    const receipt = runtime.openSessionManager(root).getBranch().findLast(entry => entry.type === 'custom' && entry.customType === 'coding_verification');
    expect(receipt).toMatchObject({ data: { changed: true, evidence: expect.arrayContaining([
      expect.objectContaining({ kind: 'check', command: 'node --test test.mjs', status: 'passed' }),
      expect.objectContaining({ kind: 'diff-review', status: 'passed' }),
    ]) } });
  } finally { evictEmbeddedSessionRunner(sessionKey); await rm(root, { recursive: true, force: true }); }
}, 20_000);

it('enforces a child tool budget inside one parallel batch without a second runtime loop', async () => {
  const { Type } = await import('@sinclair/typebox');
  const { createDelegateChildHandle } = await import('../../child-agent-factory.js');
  const root = await mkdtemp(join(tmpdir(), 'child-harness-'));
  const execute = vi.fn(async () => ({ content: [{ type: 'text' as const, text: 'read' }], details: {} }));
  try {
    scripted.stream.mockImplementation(() => {
      const message = { role: 'assistant', api: 'openai-completions', provider: 'openai', model: 'gpt-4.1',
        content: Array.from({ length: 5 }, (_, index) => ({ type: 'toolCall', id: `read-${index}`, name: 'read_file', arguments: { path: `file-${index}` } })),
        stopReason: 'toolUse', timestamp: Date.now(),
        usage: { input: 10, output: 10, cacheRead: 0, cacheWrite: 0, totalTokens: 20, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
      } as AssistantMessage;
      const stream = createAssistantMessageEventStream(); stream.push({ type: 'done', reason: 'toolUse', message }); return stream;
    });
    const child = createDelegateChildHandle({
      workspace: root, goal: 'Inspect files.', allowedToolNames: ['read_file'], maxIterations: 2, bus: {} as any, getConfig: () => undefined,
      model: { id: 'gpt-4.1', name: 'Test', provider: 'openai', api: 'openai-completions', baseUrl: 'https://example.invalid', reasoning: false, input: ['text'], contextWindow: 128000, maxTokens: 4096, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } },
      buildChildTools: () => [{ name: 'read_file', label: 'Read', description: 'Read', parameters: Type.Object({ path: Type.String() }), execute }],
    });
    const result = await child.run();
    expect(execute).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({ status: 'partial', toolIterations: 2 });
  } finally { await rm(root, { recursive: true, force: true }); }
}, 15_000);
