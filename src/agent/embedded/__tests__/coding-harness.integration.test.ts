import { execFileSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
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
import { createApplyPatchTool } from '../../tools/apply-patch.js';
import { createExecCommandTool } from '../../tools/exec-command.js';
import { createReviewWorkspaceTool } from '../../tools/review-workspace.js';
import { createReadFileTool } from '../../tools/read.js';
import { createDataBatchTool } from '../../tools/dataBatch.js';
import { createAgentTurnPolicy } from '../../orchestration/agent-turn-policy.js';

it('delivers batch evidence through the real session and tool-result guard in two model rounds', async () => {
  const root = await mkdtemp(join(tmpdir(), 'data-harness-'));
  const conversationId = crypto.randomUUID();
  let round = 0;
  try {
    await writeFile(join(root, 'a.md'), 'Alice: accessibility review');
    await writeFile(join(root, 'b.md'), 'Bob: Friday migration');
    scripted.stream.mockImplementation((_model, context) => {
      const first = round++ === 0;
      if (!first) {
        const toolResult = context.messages.findLast((message: any) => message.role === 'toolResult' && message.toolName === 'data_batch');
        expect(toolResult.content[0].text).toContain('Alice');
        expect(toolResult.content[0].text).toContain('Friday');
        expect(JSON.parse(toolResult.content[0].text).operations).toHaveLength(2);
      }
      const message = { role: 'assistant', api: 'openai-completions', provider: 'openai', model: 'gpt-4.1',
        content: first ? [{ type: 'toolCall', id: 'batch', name: 'data_batch', arguments: { operations: [
          { id: 'a', kind: 'file_read', path: 'a.md' }, { id: 'b', kind: 'file_read', path: 'b.md' },
        ] } }] : [{ type: 'text', text: 'Alice reviews accessibility; Bob migrates on Friday.' }],
        stopReason: first ? 'toolUse' : 'stop', timestamp: Date.now(),
        usage: { input: 10, output: 10, cacheRead: 0, cacheWrite: 0, totalTokens: 20, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
      } as AssistantMessage;
      const stream = createAssistantMessageEventStream();
      stream.push({ type: 'done', reason: message.stopReason as 'stop' | 'toolUse', message });
      return stream;
    });
    const result = await runXopcEmbeddedTurn({ conversationId, runId: 'data-test', workspaceDir: root,
      transcriptRuntime: new InMemoryTranscriptRuntime({ runtimeId: conversationId, cwd: root }),
      userMessage: { role: 'user', content: 'Summarize both notes.', timestamp: Date.now() },
      systemPrompt: 'Use the notes and cite their decisions.', modelRef: 'openai/gpt-4.1', timeoutMs: 10000,
      model: { id: 'gpt-4.1', name: 'Test', provider: 'openai', api: 'openai-completions', baseUrl: 'https://example.invalid', reasoning: false, input: ['text'], contextWindow: 128000, maxTokens: 4096, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } },
      tools: [createReadFileTool(root), createDataBatchTool(root, () => new Set(['read_file']))],
      turnPolicy: createAgentTurnPolicy({ maxTurns: 3 }),
    });
    expect(result).toMatchObject({ ok: true, lastAssistantText: 'Alice reviews accessibility; Bob migrates on Friday.' });
    expect(round).toBe(2);
  } finally { evictEmbeddedSessionRunner(conversationId); await rm(root, { recursive: true, force: true }); }
}, 15000);

it('runs a real AgentSession through edit, early completion, bounded repair and final evidence', async () => {
  const root = await mkdtemp(join(tmpdir(), 'coding-harness-'));
  const conversationId = crypto.randomUUID();
  const runtime = new InMemoryTranscriptRuntime({ runtimeId: conversationId, cwd: root });
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
    scripted.stream.mockImplementation((_model, context) => {
      if (responses.length === 3) {
        const edited = context.messages.findLast((message: any) => message.role === 'toolResult' && message.toolName === 'apply_patch');
        expect(edited.content).toContainEqual({ type: 'text', text: expect.stringContaining('standalone assertion test, review_workspace') });
      }
      if (responses.length === 1) {
        const checked = context.messages.findLast((message: any) => message.role === 'toolResult' && message.toolName === 'exec_command');
        expect(checked.content).toContainEqual({ type: 'text', text: 'Verification pending for current files: none.' });
        expect(getCurrentSystemPrompt(context.messages)).toContain('give the final answer now');
      }
      if (responses.length === 4) expect(getCurrentSystemPrompt(context.messages)).toContain('Read the inputs named by the current request directly');
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
    const result = await runXopcEmbeddedTurn({ verifyChanges: true,
      conversationId, runId: 'test-run', userMessage: { role: 'user', content: 'Fix answer.', timestamp: Date.now() },
      model: { id: 'gpt-4.1', name: 'Test', provider: 'openai', api: 'openai-completions', baseUrl: 'https://example.invalid', reasoning: false, input: ['text'], contextWindow: 128000, maxTokens: 4096, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }, modelRef: 'openai/gpt-4.1', systemPrompt: 'Fix and verify the code.',
      tools: [createApplyPatchTool(root), createExecCommandTool(root), createReviewWorkspaceTool(root)],
      workspaceDir: root, transcriptRuntime: runtime, timeoutMs: 10_000,
      turnPolicy: createAgentTurnPolicy({ maxTurns: 5 }), onAgentEvent: event => events.push(event.type),
    });
    expect(result, JSON.stringify(result)).toMatchObject({ ok: true, lastAssistantText: 'Verified the change.' });
    expect(responses).toHaveLength(0);
    expect(events).toContain('turn_end'); expect(events).toContain('tool_execution_end');
    const receipt = runtime.openSessionManager(root).getBranch().findLast(entry => entry.type === 'custom' && entry.customType === 'coding_verification');
    expect(JSON.stringify(runtime.openSessionManager(root).getBranch())).not.toContain('xopc.execution-focus');
    expect(receipt).toMatchObject({ data: { changed: true, evidence: expect.arrayContaining([
      expect.objectContaining({ kind: 'check', command: 'node --test test.mjs', status: 'passed' }),
      expect.objectContaining({ kind: 'diff-review', status: 'passed' }),
    ]) } });
  } finally { evictEmbeddedSessionRunner(conversationId); await rm(root, { recursive: true, force: true }); }
}, 20_000);

it('shares repeated reads and reviews in model context without rewriting their durable receipts', async () => {
  const root = await mkdtemp(join(tmpdir(), 'evidence-harness-'));
  const conversationId = crypto.randomUUID();
  const runtime = new InMemoryTranscriptRuntime({ runtimeId: conversationId, cwd: root });
  const note = 'Relevant evidence kept in full.\n'.repeat(150);
  try {
    await writeFile(join(root, 'answer.mjs'), 'export const answer = 0;\n');
    await writeFile(join(root, 'test.mjs'), 'import { answer } from "./answer.mjs"; import assert from "node:assert/strict"; assert.equal(answer, 42);');
    execFileSync('git', ['init', '-q'], { cwd: root }); execFileSync('git', ['add', '.'], { cwd: root });
    execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@xopc.local', 'commit', '-qm', 'fixture'], { cwd: root });
    await writeFile(join(root, 'notes.md'), note);
    const calls = [
      { id: 'read-first', name: 'read_file', arguments: { path: 'notes.md' } },
      { id: 'read-latest', name: 'read_file', arguments: { path: 'notes.md' } },
      { id: 'edit', name: 'apply_patch', arguments: { patch: '*** Begin Patch\n*** Update File: answer.mjs\n@@\n-export const answer = 0;\n+export const answer = 42;\n*** End Patch' } },
      { id: 'review-first', name: 'review_workspace', arguments: {} },
      { id: 'review-latest', name: 'review_workspace', arguments: {} },
      { id: 'check', name: 'exec_command', arguments: { cmd: 'node --test test.mjs' } },
    ];
    let request = 0;
    scripted.stream.mockImplementation((_model, context) => {
      if (request === 2) expect(JSON.stringify(context.messages)).toContain('Repeated tool calls are producing no new evidence');
      if (request === 6) {
        const readResults = context.messages.filter((message: any) => message.role === 'toolResult' && message.toolName === 'read_file');
        const [firstRead, latestRead] = readResults;
        const firstReview = context.messages.find((message: any) => message.role === 'toolResult' && message.toolName === 'review_workspace');
        expect(JSON.stringify(firstRead.content)).toContain('later retained read_file result');
        expect(latestRead.content[0].text).toBe(note);
        expect(JSON.stringify(firstReview.content)).toContain('last complete review in this user turn');
        expect(getCurrentSystemPrompt(context.messages)).toContain('give the final answer now');
      }
      const call = calls[request++];
      const message = { role: 'assistant', api: 'openai-completions', provider: 'openai', model: 'gpt-4.1',
        content: call ? [{ type: 'toolCall', ...call }] : [{ type: 'text', text: 'Verified.' }],
        stopReason: call ? 'toolUse' : 'stop', timestamp: Date.now(),
        usage: { input: 10, output: 10, cacheRead: 0, cacheWrite: 0, totalTokens: 20, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
      } as AssistantMessage;
      const stream = createAssistantMessageEventStream();
      stream.push({ type: 'done', reason: message.stopReason as 'stop' | 'toolUse', message });
      return stream;
    });
    const result = await runXopcEmbeddedTurn({ conversationId, runId: 'evidence-test', workspaceDir: root, transcriptRuntime: runtime,
      userMessage: { role: 'user', content: 'Inspect the notes and fix answer.', timestamp: Date.now() },
      systemPrompt: 'Fix and verify the code.', modelRef: 'openai/gpt-4.1', verifyChanges: true, timeoutMs: 15000,
      model: { id: 'gpt-4.1', name: 'Test', provider: 'openai', api: 'openai-completions', baseUrl: 'https://example.invalid', reasoning: false, input: ['text'], contextWindow: 128000, maxTokens: 4096, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } },
      tools: [createReadFileTool(root), createApplyPatchTool(root), createExecCommandTool(root), createReviewWorkspaceTool(root)],
      turnPolicy: createAgentTurnPolicy({ maxTurns: 9 }),
    });
    expect(result, JSON.stringify(result)).toMatchObject({ ok: true, lastAssistantText: 'Verified.' });
    expect(request).toBe(7);
    const transcript = JSON.stringify(runtime.openSessionManager(root).getBranch());
    expect(transcript).not.toContain('context sharing');
    expect(transcript).not.toContain('Identical successful read');
    expect(transcript).not.toContain('xopc.execution-focus');
  } finally { evictEmbeddedSessionRunner(conversationId); await rm(root, { recursive: true, force: true }); }
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

it('saves structured research in a real child session and carries it into a fresh continuation', async () => {
  const { Type } = await import('@sinclair/typebox');
  const { createDelegateChildHandle } = await import('../../child-agent-factory.js');
  const { mergeResearchCheckpoint, researchResumeContext } = await import('../../orchestration/research-checkpoint.js');
  const root = await mkdtemp(join(tmpdir(), 'research-harness-'));
  let checkpoint: import('../../orchestration/research-checkpoint.js').ResearchCheckpoint = { findings: [], evidence: [], nextSteps: ['Check price'] };
  const sink = { read: () => checkpoint,
    save: (update: any) => checkpoint = mergeResearchCheckpoint(checkpoint, update),
    recordEvidence: (evidence: any) => { checkpoint.evidence.push(evidence); },
  };
  const model = { id: 'gpt-4.1', name: 'Test', provider: 'openai', api: 'openai-completions', baseUrl: 'https://example.invalid', reasoning: false, input: ['text'], contextWindow: 128000, maxTokens: 4096, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } } as const;
  const responses: AssistantMessage['content'][] = [
    [{ type: 'toolCall', id: 'source', name: 'web_fetch', arguments: {} }],
    [{ type: 'toolCall', id: 'save', name: 'research_checkpoint', arguments: { findings: [{ id: 'price', subject: 'Vendor', field: 'price', status: 'not_disclosed', conclusion: 'Contact sales', sources: [{ url: 'https://example.com/pricing', title: 'Pricing' }] }], nextSteps: ['Check concurrency'] } }],
    [{ type: 'text', text: 'Pricing is not disclosed; concurrency remains.' }],
    [{ type: 'toolCall', id: 'save-next', name: 'research_checkpoint', arguments: { findings: [{ id: 'concurrency', subject: 'Vendor', field: 'concurrency', status: 'confirmed', conclusion: '10 sessions', sources: [{ url: 'https://example.com/limits', title: 'Limits' }] }], nextSteps: [] } }],
    [{ type: 'text', text: 'Pricing requires sales; concurrency is 10 sessions.' }],
  ];
  scripted.stream.mockImplementation((_model, context) => {
    const content = responses.shift();
    if (!content) throw new Error('Unexpected extra research request');
    if (content.some(block => block.type === 'toolCall' && block.id === 'save-next')) {
      expect(JSON.stringify(context.messages.filter((message: any) => message.role === 'system'))).toContain('Contact sales');
      expect(JSON.stringify(context.messages.filter((message: any) => message.role === 'system'))).toContain('Check concurrency');
    }
    const message = { role: 'assistant', api: 'openai-completions', provider: 'openai', model: 'gpt-4.1', content,
      stopReason: content.some(block => block.type === 'toolCall') ? 'toolUse' : 'stop', timestamp: Date.now(),
      usage: { input: 10, output: 10, cacheRead: 0, cacheWrite: 0, totalTokens: 20, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
    } as AssistantMessage;
    const stream = createAssistantMessageEventStream(); stream.push({ type: 'done', reason: message.stopReason as 'stop' | 'toolUse', message }); return stream;
  });
  const fetch = vi.fn(async () => ({ content: [{ type: 'text' as const, text: 'Official pricing: contact sales.' }], details: {} }));
  const options = { workspace: root, goal: 'Check pricing and concurrency', model: model as any, bus: {} as any,
    getConfig: () => undefined, allowedToolNames: ['web_fetch'], maxIterations: 10, researchCheckpoint: sink,
    buildChildTools: () => [{ name: 'web_fetch', label: 'Fetch', description: 'Fetch official pricing', parameters: Type.Object({}), execute: fetch }],
  };
  try {
    expect((await createDelegateChildHandle(options).run()).status).toBe('success');
    expect(checkpoint.findings).toHaveLength(1);
    expect(checkpoint.evidence[0]?.excerpt).toContain('contact sales');
    const resumed = await createDelegateChildHandle({ ...options, context: researchResumeContext(checkpoint) }).run();
    expect(resumed.status, resumed.summary).toBe('success');
    expect(checkpoint.findings).toHaveLength(2);
    expect(checkpoint.nextSteps).toEqual([]);
    expect(fetch).toHaveBeenCalledOnce();
    expect(responses).toHaveLength(0);
  } finally { await rm(root, { recursive: true, force: true }); }
}, 20_000);

it('hands off saved research after aborting a real long model request at the research deadline', async () => {
  const { Type } = await import('@sinclair/typebox');
  const { createDelegateChildHandle } = await import('../../child-agent-factory.js');
  const { mergeResearchCheckpoint } = await import('../../orchestration/research-checkpoint.js');
  const root = await mkdtemp(join(tmpdir(), 'research-deadline-'));
  let checkpoint: import('../../orchestration/research-checkpoint.js').ResearchCheckpoint = { findings: [], evidence: [], nextSteps: ['Check price'] };
  let round = 0;
  let longRequestAborted = false;
  scripted.stream.mockImplementation((_model, _context, options) => {
    const attempt = round++;
    const content: AssistantMessage['content'] = attempt === 0
      ? [{ type: 'toolCall', id: 'source', name: 'web_fetch', arguments: {} }]
      : attempt === 1
        ? [{ type: 'toolCall', id: 'checkpoint', name: 'research_checkpoint', arguments: { findings: [{ id: 'price', subject: 'Vendor', field: 'price', status: 'not_disclosed', conclusion: 'Contact sales', sources: [] }], nextSteps: ['Check concurrency'] } }]
        : [{ type: 'text', text: 'Pricing requires sales; concurrency remains to be checked.' }];
    const message = { role: 'assistant', api: 'openai-completions', provider: 'openai', model: 'gpt-4.1', content,
      stopReason: attempt < 2 ? 'toolUse' : 'stop', timestamp: Date.now(),
      usage: { input: 10, output: 10, cacheRead: 0, cacheWrite: 0, totalTokens: 20, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
    } as AssistantMessage;
    const stream = createAssistantMessageEventStream();
    if (attempt === 2) {
      const abort = () => {
        longRequestAborted = true;
        stream.push({ type: 'error', reason: 'aborted', error: { ...message, content: [], stopReason: 'aborted', errorMessage: 'Request was aborted' } });
      };
      if (options.signal.aborted) abort();
      else options.signal.addEventListener('abort', abort, { once: true });
    } else {
      if (attempt > 3) throw new Error('Unexpected extra handoff attempt');
      stream.push({ type: 'done', reason: message.stopReason as 'stop' | 'toolUse', message });
    }
    return stream;
  });
  try {
    const result = await createDelegateChildHandle({ workspace: root, goal: 'Check pricing and concurrency', timeoutMs: 2000,
      allowedToolNames: ['web_fetch'], maxIterations: 10, getConfig: () => undefined, bus: {} as any,
      model: { id: 'gpt-4.1', name: 'Test', provider: 'openai', api: 'openai-completions', baseUrl: 'https://example.invalid', reasoning: false, input: ['text'], contextWindow: 128000, maxTokens: 4096, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } },
      researchCheckpoint: { read: () => checkpoint,
        save: update => checkpoint = mergeResearchCheckpoint(checkpoint, update),
        recordEvidence: evidence => { checkpoint.evidence.push(evidence); },
      },
      buildChildTools: () => [{ name: 'web_fetch', label: 'Fetch', description: 'Fetch', parameters: Type.Object({}),
        execute: async () => ({ content: [{ type: 'text', text: 'Public price: contact sales' }], details: {} }) }],
    }).run();
    expect(result, result.summary).toMatchObject({ status: 'partial', stopReason: 'deadline_exceeded', handoff: { completed: true } });
    expect(longRequestAborted).toBe(true);
    expect(round).toBe(4);
    expect(checkpoint.findings[0]?.conclusion).toBe('Contact sales');
    expect(checkpoint.nextSteps).toEqual(['Check concurrency']);
  } finally { await rm(root, { recursive: true, force: true }); }
}, 15_000);
