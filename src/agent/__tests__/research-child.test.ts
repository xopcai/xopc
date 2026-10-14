import { Type } from '@sinclair/typebox';
import { afterEach, describe, expect, it, vi } from 'vitest';

const embedded = vi.hoisted(() => ({ run: vi.fn() }));
vi.mock('../embedded/run-turn.js', () => ({ runXopcEmbeddedTurn: embedded.run }));
vi.mock('../embedded/session-runner.js', () => ({ evictEmbeddedSessionRunner: vi.fn() }));
vi.mock('../prompt/response-language.js', () => ({ resolveResponseLanguageForSession: () => 'en' }));

import { createDelegateChildHandle } from '../child-agent-factory.js';
import { mergeResearchCheckpoint, type ResearchCheckpoint } from '../orchestration/research-checkpoint.js';

function setup() {
  let checkpoint: ResearchCheckpoint = { findings: [], evidence: [], nextSteps: ['Check price'] };
  const sink = {
    read: () => checkpoint,
    save: (update: any) => checkpoint = mergeResearchCheckpoint(checkpoint, update),
    recordEvidence: (evidence: any) => { checkpoint.evidence.push(evidence); },
  };
  const parentPolicy = vi.fn(async () => undefined);
  const options = { workspace: '/tmp/research', goal: 'Research pricing', allowedToolNames: ['web_fetch'], maxIterations: 10,
    timeoutMs: 1000, model: { id: 'test', provider: 'openai' } as any, bus: {} as any, getConfig: () => undefined,
    researchCheckpoint: sink, authorizeToolCall: parentPolicy,
    buildChildTools: () => [{ name: 'web_fetch', label: 'Fetch', description: 'Fetch', parameters: Type.Object({}),
      execute: vi.fn(async () => ({ content: [{ type: 'text' as const, text: 'Pricing unavailable' }], details: {} })) }],
  };
  return { sink, options, parentPolicy };
}

describe('research child deadlines and checkpoint tool', () => {
  afterEach(() => { vi.useRealTimers(); embedded.run.mockReset(); });
  it('persists findings through its scoped internal tool without asking for external write access', async () => {
    const { options, sink, parentPolicy } = setup();
    embedded.run.mockImplementationOnce(async params => {
      const tool = params.tools.find((tool: any) => tool.name === 'research_checkpoint');
      const context = { toolCall: { id: 'save', name: tool.name, arguments: {} }, args: {} };
      expect(await params.turnPolicy.beforeToolCall(context)).toBeUndefined();
      await tool.execute('save', { findings: [{ id: 'price', subject: 'Vendor', field: 'price', status: 'not_disclosed', conclusion: 'Contact sales', sources: [] }], nextSteps: [] });
      params.onEvent({ type: 'tool_execution_end', toolCallId: 'fetch', toolName: 'web_fetch', isError: false,
        result: { content: [{ type: 'text', text: 'Official pricing page' }] } });
      return { ok: true, lastAssistantText: 'Price is not disclosed.' };
    });
    const result = await createDelegateChildHandle(options).run();
    expect(result.status).toBe('success');
    expect(sink.read().findings).toHaveLength(1);
    expect(sink.read().evidence[0]?.excerpt).toBe('Official pricing page');
    expect(parentPolicy).not.toHaveBeenCalled();
  });
  it('reserves time for one tool-free summary after a settled long model request', async () => {
    vi.useFakeTimers();
    const { options } = setup();
    embedded.run.mockImplementationOnce(async params => {
      expect(params.timeoutMs).toBe(800);
      await vi.advanceTimersByTimeAsync(810);
      return { ok: false, terminationReason: 'deadline_exceeded', errorMessage: 'Agent turn timed out after 0.8s' };
    }).mockImplementationOnce(async params => {
      expect(params.tools).toEqual([]);
      expect(params.timeoutMs).toBe(190);
      expect(params.turnPolicy.beforeModelRequest()).toBeUndefined();
      params.onEvent({ type: 'message_end', message: { role: 'assistant', stopReason: 'stop', content: [{ type: 'text', text: 'Still need price' }] } });
      expect(params.turnPolicy.shouldStopAfterTurn({ toolResults: [] })).toBe(true);
      return { ok: false, stopReason: 'policy_limit', lastAssistantText: 'Still need price' };
    });
    const result = await createDelegateChildHandle(options).run();
    expect(result).toMatchObject({ status: 'partial', stopReason: 'deadline_exceeded', handoff: { completed: true } });
    expect(embedded.run).toHaveBeenCalledTimes(2);
  });
  it('does not start a summary when the aborted request has not settled', async () => {
    const { options } = setup();
    embedded.run.mockResolvedValueOnce({ ok: false, errorMessage: 'Agent turn timed out after 0.8s and did not settle within 5s' });
    const result = await createDelegateChildHandle(options).run();
    expect(result).toMatchObject({ status: 'failed', stopReason: 'deadline_exceeded' });
    expect(embedded.run).toHaveBeenCalledTimes(1);
  });
  it('distinguishes provider failure from runtime failure', async () => {
    embedded.run.mockResolvedValueOnce({ ok: false, terminationReason: 'provider_error', errorMessage: 'Provider unavailable' });
    expect(await createDelegateChildHandle(setup().options).run()).toMatchObject({ status: 'failed', stopReason: 'provider_error' });
  });
  it.each(['user_cancelled', 'parent_cancelled'] as const)('preserves %s without starting a handoff', async reason => {
    const handle = createDelegateChildHandle(setup().options);
    embedded.run.mockImplementationOnce(async () => { handle.abort(reason); return { ok: false, errorMessage: 'aborted' }; });
    expect(await handle.run()).toMatchObject({ status: 'cancelled', stopReason: reason });
    expect(embedded.run).toHaveBeenCalledTimes(1);
  });
});

it('confines an inherited batch executor to the child tool subset even when called directly', async () => {
  const { createDataBatchTool } = await import('../tools/dataBatch.js');
  const execute = vi.fn(async () => ({ content: [{ type: 'text' as const, text: 'must remain inaccessible' }], details: {} }));
  const parentSearch = { name: 'web_search', label: 'Search', description: 'Search', parameters: Type.Object({}), execute };
  const inheritedBatch = createDataBatchTool('/tmp', () => new Set(['web_search']), { getTools: () => [parentSearch] });
  const { options } = setup();
  embedded.run.mockImplementationOnce(async params => {
    const batch = params.tools.find((tool: any) => tool.name === 'data_batch');
    const result = await batch.execute('read', { operations: [{ id: 'web', kind: 'web_search', query: 'Forbidden to this child' }] });
    expect(result.details).toMatchObject({ status: 'failed', sourceRequests: 0 });
    expect(JSON.parse(result.content[0].text).operations[0].status).toBe('denied');
    return { ok: true, lastAssistantText: 'Denied as expected' };
  });
  await createDelegateChildHandle({ ...options, researchCheckpoint: undefined, allowedToolNames: ['data_batch', 'read_file'],
    buildChildTools: () => [inheritedBatch, parentSearch] }).run();
  expect(execute).not.toHaveBeenCalled();
  embedded.run.mockReset();
});
