import { afterEach, describe, expect, it, vi } from 'vitest';
import { ComputerBroker } from '../broker.js';
import { ComputerRuntime, ComputerUseInputSchema } from '../runtime.js';
import { isComputerControlActive } from '../control-guard.js';
import { ComputerConfigSchema } from '../config.js';
import { canonicalJson } from '@xopcai/endpoint-tools-protocol';
import { resolveEffectiveAgentConfigForSession } from '../../config/agent-profile.js';
import { computerDiagnostic } from '../errors.js';
import { resolveModel } from '../../providers/index.js';
import { ComputerFlowSchema, type ComputerFlowRepository } from '../flows.js';

vi.mock('../../config/agent-profile.js', () => ({ resolveEffectiveAgentConfigForSession: vi.fn(() => ({ config: { id: 'main', models: { computerUse: { primary: 'ali/gui' } } } })) }));
vi.mock('../../providers/index.js', () => ({
  getApiKey: async (_provider: string, options: any) => {
    if (!options.agentId || !options.appConfig) throw new Error('Agent credentials require appConfig');
    return 'fixture-secret';
  },
  resolveModel: vi.fn(() => ({ id: 'gui-plus-2026-02-26', provider: 'ali', api: 'openai-completions', input: ['text', 'image'], baseUrl: 'https://model.test/v1', computerUse: { profile: 'gui-plus-2026-02-26' } })),
}));

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => { await Promise.all(cleanups.splice(0).map(fn => fn())); vi.unstubAllGlobals(); });
function fixture(autoApprove = true, flowStore?: ComputerFlowRepository) {
  const target = { appId: 'fixture', pid: 1, processIdentity: 'fixture:1', windowId: '1', width: 800, height: 600, geometryRevision: '1' };
  const images: Uint8Array[] = [];
  const driver = { discover: vi.fn(async () => [{ appId: 'fixture', name: '飞书', running: true }]),
    resolveTarget: vi.fn(async () => target), stop: vi.fn(async () => {}), perform: vi.fn(async () => {}),
    observe: vi.fn(async () => {
      const image = new Uint8Array([1, 2, 3]); images.push(image);
      return { target, summary: 'fixture', stateDigest: 'fixed', image, mimeType: 'image/png' as const, imageWidth: 800, imageHeight: 600 };
    }) };
  let approve!: (value: boolean) => void;
  const broker = new ComputerBroker(driver, { isVisible: () => true,
    requestApproval: () => autoApprove ? Promise.resolve(true) : new Promise(resolve => { approve = resolve; }) }, { enabled: true });
  const frames = new Map<string, Uint8Array>();
  const config = { computer: ComputerConfigSchema.parse({ enabled: true, maxActionsPerSession: 2 }) };
  const fetch = vi.fn(async () => Response.json({ choices: [{ finish_reason: 'stop', message: { content: '<tool_call>{"name":"computer_use","arguments":{"action":"left_click","coordinate":[500,500]}}</tool_call>' } }] }));
  vi.stubGlobal('fetch', fetch);
  const invoke = vi.fn(async ({ arguments: args }: any) => {
    canonicalJson(args);
    let response = await broker.command(args);
    if (autoApprove && response.status === 'pending_authorization') {
      await vi.waitFor(() => expect(broker.snapshot().status).not.toBe('pending_authorization'));
      response = await broker.command({ op: 'status', sessionId: args.sessionId, owner: args.owner });
    } else if (autoApprove && response.status === 'pending_action') {
      await Promise.resolve();
      response = await broker.command(args);
    }
    const { frame, ...value } = response;
    const content: any[] = [{ type: 'json', value }];
    if (frame) { frames.set('frame', frame.bytes); content.push({ type: 'file', fileId: 'frame', mimeType: frame.mimeType }); }
    return { content, invocationId: 'invoke' };
  });
  const endpointIdentity = { kind: 'desktop', endpointId: 'endpoint', principalId: undefined as string | undefined };
  const endpoint = { bindings: { get: () => undefined, resolve: () => undefined }, registry: {
    get: (id: string) => id === endpointIdentity.endpointId ? endpointIdentity : undefined, getTool: () => ({ revision: 'r1' }) },
    invocations: { invoke }, uploads: { takeComputerFrame: (id: string) => { const value = frames.get(id); frames.delete(id); return value; } } };
  const runtime = new ComputerRuntime(endpoint as any, () => config as any, () => endpointIdentity.endpointId, flowStore);
  cleanups.push(async () => { await runtime.shutdown(); await broker.dispose(); });
  return { runtime, broker, driver, frames, images, config, fetch, invoke, endpointIdentity, approve: (value = true) => approve(value),
    discover: async () => (await runtime.execute('owner', { op: 'discover', query: '飞书' })).apps![0].appRef,
    open: async (appRef: string, mode: 'observe' | 'control' = 'control') => runtime.execute('owner', { op: 'open', appRef, mode, prepare: false }) };
}
describe('agent to broker desktop lifecycle', () => {
  it.each(['openai-completions', 'openai-responses'])('runs a custom visual model with inferred function tools on %s', async api => {
    const f = fixture();
    vi.mocked(resolveModel).mockReturnValueOnce({ id: 'arbitrary-vision', provider: 'custom', api,
      input: ['text', 'image'], baseUrl: 'https://proxy.test/v1' } as any);
    const proposal = { kind: 'action', action: { kind: 'click', point: { x: 400, y: 300 }, button: 'left', count: 1 } };
    const args = JSON.stringify({ proposal });
    f.fetch.mockResolvedValueOnce(Response.json(api === 'openai-responses'
      ? { status: 'completed', output: [{ type: 'function_call', name: 'computer_proposal', arguments: args }] }
      : { choices: [{ message: { tool_calls: [{ function: { name: 'computer_proposal', arguments: args } }] } }] }));
    await f.open(await f.discover());
    await f.runtime.execute('owner', { op: 'step', goal: 'Click the button' });
    expect(f.driver.perform).toHaveBeenCalledTimes(1);
    expect(f.fetch.mock.calls[0][0]).toBe(`https://proxy.test/v1/${api === 'openai-responses' ? 'responses' : 'chat/completions'}`);
  });
  it('makes reports local, conversation-scoped and readable after release without reconnecting', async () => {
    const f = fixture(); await f.open(await f.discover());
    await f.runtime.execute('owner', { op: 'step', goal: 'Private task text' });
    const closed = await f.runtime.execute('owner', { op: 'close' });
    expect(closed.report).toMatchObject({ status: 'released', counters: { modelRequests: 1, predictionAttempts: 1,
      proposedInputs: 1, completedInputs: 1, unchangedInputs: 1, verifiedConditions: 0 } });
    const before = f.invoke.mock.calls.length;
    expect((await f.runtime.execute('owner', { op: 'report' })).report).toEqual(closed.report);
    expect((await f.runtime.execute('other', { op: 'report' })).status).toBe('no_report');
    expect(f.invoke).toHaveBeenCalledTimes(before);
    expect(JSON.stringify(closed.report)).not.toMatch(/Private task|fixture-secret|stateDigest|image|appRef|actionPreview/);
    expect(isComputerControlActive('owner')).toBe(false);
  });
  it('retains model-format failure attribution, both actual calls and zero dispatched inputs', async () => {
    const f = fixture(); await f.open(await f.discover());
    f.fetch.mockResolvedValue(Response.json({ choices: [{ message: { content: 'private malformed response' } }] }));
    await expect(f.runtime.execute('owner', { op: 'step', goal: 'Private goal' })).rejects.toThrow();
    const report = f.runtime.getReport('owner');
    expect(report).toMatchObject({ status: 'released', counters: { modelRequests: 2, predictionAttempts: 2, completedInputs: 0 },
      failure: { phase: 'model', category: 'model', dispatch: 'notStarted' } });
    expect(JSON.stringify(report)).not.toMatch(/private|Private/);
  });
  it('reports a lost act reply as uncertain and never retries it', async () => {
    const f = fixture(); await f.open(await f.discover());
    const invoke = f.invoke.getMockImplementation()!;
    f.invoke.mockImplementation(async (args: any) => {
      const result = await invoke(args);
      if (args.arguments.op === 'act') throw new Error('private socket error');
      return result;
    });
    await expect(f.runtime.execute('owner', { op: 'step', goal: 'Click' })).rejects.toThrow();
    expect(f.runtime.getReport('owner')).toMatchObject({ status: 'released', counters: { unknownDispatches: 1, completedInputs: 0 },
      failure: { category: 'transport', phase: 'dispatch', dispatch: 'unknown' } });
    expect(f.driver.perform).toHaveBeenCalledOnce();
  });
  it('retains setup failures and bounds completed reports by count and expiry', async () => {
    const f = fixture();
    const config = resolveEffectiveAgentConfigForSession as ReturnType<typeof vi.fn>;
    for (let i = 0; i < 33; i++) {
      config.mockReturnValueOnce({ config: { id: 'main', models: {} } });
      await expect(f.runtime.execute(`owner-${i}`, { op: 'open', appRef: 'unused', mode: 'observe', prepare: false })).rejects.toThrow('MODEL_REQUIRED');
    }
    expect(f.runtime.getReport('owner-0')).toBeUndefined();
    expect(f.runtime.getReport('owner-32')).toMatchObject({ failure: { phase: 'open', category: 'model' } });
    const now = Date.now(); const clock = vi.spyOn(Date, 'now').mockReturnValue(now + 31 * 60_000);
    try { expect(f.runtime.getReport('owner-32')).toBeUndefined(); } finally { clock.mockRestore(); }
  });
  it('grounds a coordinate model prediction before authorization and retains the actual semantic action in history', async () => {
    const f = fixture();
    const observe = f.driver.observe.getMockImplementation()!;
    f.driver.observe.mockImplementation(async () => ({ ...await observe(), summary: JSON.stringify({ elements: [
      { ref: 'e1', role: 'AXButton', semanticActions: ['activate'], bounds: { x: 350, y: 250, width: 100, height: 100 } },
    ] }) }));
    await f.open(await f.discover());
    const result = await f.runtime.execute('owner', { op: 'step', goal: 'Activate Continue' });
    expect(result.receipt).toMatchObject({ dispatch: 'completed', outcome: 'unknown' });
    const call = f.invoke.mock.calls.find(([input]) => input.arguments.op === 'act')![0];
    expect(call.arguments.envelope.action).toEqual({ kind: 'activate', ref: 'e1' });
    expect(f.driver.perform).toHaveBeenCalledWith(expect.anything(), { kind: 'activate', ref: 'e1' }, expect.any(AbortSignal));
    const closed = await f.runtime.execute('owner', { op: 'close' });
    expect(closed.handoff?.recentActions).toMatchObject([{ action: 'activate', dispatch: 'completed', outcome: 'unknown' }]);
  });
  it('selects the native Responses adapter for an explicitly compatible OpenAI model', async () => {
    const f = fixture();
    vi.mocked(resolveModel).mockReturnValueOnce({ id: 'gpt-5.6-sol', provider: 'openai', api: 'openai-responses', input: ['text', 'image'],
      maxTokens: 4096, baseUrl: 'https://api.openai.com/v1', computerUse: { profile: 'openai-responses-computer-v1' } } as any);
    f.fetch.mockResolvedValueOnce(Response.json({ id: 'resp_1', output: [{ type: 'computer_call', call_id: 'call_1', actions: [{ type: 'wait' }] }] }));
    await f.open(await f.discover());
    await f.runtime.execute('owner', { op: 'step', goal: 'Wait briefly' });
    expect(f.fetch.mock.calls[0][0]).toBe('https://api.openai.com/v1/responses');
    expect(JSON.parse((f.fetch.mock.calls as any)[0][1].body).tools).toEqual([{ type: 'computer' }]);
  });
  it('uses managed service ceilings without presenting them as account balances', async () => {
    const f = fixture();
    vi.mocked(resolveModel).mockReturnValueOnce({ id: 'computer', provider: 'xopc-cloud', api: 'openai-completions', input: ['text', 'image'], maxTokens: 4096,
      baseUrl: 'https://model.test/v1', computerUse: { profile: 'gui-plus-2026-02-26' } } as any);
    f.fetch.mockResolvedValueOnce(Response.json({ data: [{ id: 'computer', xopc: { computerDeployment: { revision: 'a'.repeat(64) },
      computerLimits: { maxOutputTokens: 512, requestsPerDay: 20, requestsPerMinute: 5 } } }] }));
    expect(await f.open(await f.discover())).toMatchObject({ budget: { serviceLimits: { maxOutputTokens: 512, requestsPerDay: 20 } } });
    await f.runtime.execute('owner', { op: 'step', goal: 'Click' });
    const request = (f.fetch.mock.calls as any)[1][1];
    expect(JSON.parse(request.body)).toMatchObject({model:'computer',max_tokens:512});
    expect(new Headers(request.headers).get('x-xopc-computer-deployment')).toBe('a'.repeat(64));
  });
  it('accepts an explicit absent-session acknowledgement after a desktop restart', async () => {
    const f = fixture(); await f.open(await f.discover());
    f.invoke.mockRejectedValueOnce(new Error('COMPUTER_SESSION_NOT_FOUND'));
    expect(await f.runtime.execute('owner', { op: 'close' })).toMatchObject({ status: 'stopped' });
    expect(isComputerControlActive('owner')).toBe(false);
  });
  it('keeps the tool gate closed until desktop release is acknowledged', async () => {
    const f = fixture(); await f.open(await f.discover());
    const invoke = f.invoke.getMockImplementation()!;
    f.invoke.mockImplementationOnce(async () => { throw new Error('disconnected'); });
    expect(await f.runtime.execute('owner', { op: 'close' })).toMatchObject({ status: 'stop_unconfirmed', errorCode: 'COMPUTER_RELEASE_UNCONFIRMED' });
    expect(isComputerControlActive('owner')).toBe(true);
    f.invoke.mockImplementation(invoke);
    expect(await f.runtime.execute('owner', { op: 'close' })).toMatchObject({ status: 'stopped' });
    expect(isComputerControlActive('owner')).toBe(false);
  });
  it('returns a bounded factual handoff only after releasing the desktop lease', async () => {
    const f = fixture(); await f.open(await f.discover());
    await f.runtime.execute('owner', { op: 'step', goal: 'Inspect task' });
    expect(await f.runtime.execute('owner', { op: 'close' })).toMatchObject({ status: 'stopped', handoff: {
      recentActions: [{ goal: 'Inspect task', action: 'click', dispatch: 'completed', outcome: 'unknown' }],
    } });
    expect(isComputerControlActive('owner')).toBe(false);
  });
  it('stops after two unstable predictions without dispatching input', async () => {
    const f = fixture(); const observe = f.driver.observe.getMockImplementation()!; let calls = 0;
    f.driver.observe.mockImplementation(async () => ({ ...await observe(), stateDigest: String(++calls) }));
    await f.open(await f.discover());
    await expect(f.runtime.execute('owner', { op: 'step', goal: 'Click' })).rejects.toThrow('COMPUTER_UI_UNSTABLE');
    expect(f.fetch).toHaveBeenCalledTimes(2); expect(f.driver.perform).not.toHaveBeenCalled();
    expect(isComputerControlActive('owner')).toBe(false);
  });
  it('carries bounded execution history to the next prediction and prevents no-progress loops', async () => {
    const f = fixture(); f.config.computer.maxActionsPerSession = 5;
    await f.open(await f.discover());
    await f.runtime.execute('owner', { op: 'step', goal: 'Find the task' });
    await f.runtime.execute('owner', { op: 'step', goal: 'Inspect progress' });
    const body = JSON.parse((f.fetch.mock.calls as any)[1][1].body);
    expect(body.messages[1].content[1].text).toContain('Find the task');
    expect(body.messages[1].content[1].text).toContain('completed');
    await expect(f.runtime.execute('owner', { op: 'step', goal: 'Inspect again' })).rejects.toThrow('NO_PROGRESS');
    expect(f.driver.perform).toHaveBeenCalledTimes(2);
  });
  it('does not skip a requested action or verify a change from already-present text', async () => {
    const f = fixture(); let saved = false;
    f.driver.perform.mockImplementation(async () => { saved = true; });
    const observe = f.driver.observe.getMockImplementation()!;
    f.driver.observe.mockImplementation(async () => ({ ...await observe(), summary: JSON.stringify({ text: saved ? 'Saved' : 'Draft', elements: [{ role: 'AXWindow' }] }), stateDigest: saved ? 'saved' : 'draft' }));
    await f.open(await f.discover());
    const input = { op: 'step', goal: 'Save draft', expect: { kind: 'text', text: 'Saved' } } as const;
    expect(await f.runtime.execute('owner', input)).toMatchObject({ verified: true, verification: { status: 'satisfied', scope: 'expectation' } });
    expect(await f.runtime.execute('owner', input)).toMatchObject({ verified: false, verification: { status: 'satisfied', preexisting: true } });
    expect(f.fetch).toHaveBeenCalledTimes(2); expect(f.driver.perform).toHaveBeenCalledTimes(2);
  });
  it('does not click an already-selected native tab again', async () => {
    const f = fixture(); const observe = f.driver.observe.getMockImplementation()!;
    f.driver.observe.mockImplementation(async () => ({ ...await observe(), summary: JSON.stringify({ text: 'Memories', elements: [
      { role: 'AXWindow' }, { role: 'AXRadioButton', label: 'Memories', selected: true }] }) }));
    await f.open(await f.discover());
    expect(await f.runtime.execute('owner', { op: 'step', goal: 'Select Memories', expect: { kind: 'selected', label: 'Memories' } }))
      .toMatchObject({ status: 'condition_satisfied', verified: true });
    expect(f.fetch).not.toHaveBeenCalled(); expect(f.driver.perform).not.toHaveBeenCalled();
  });
  it('reports invalid model output without dispatch, clears pixels and releases the session', async () => {
    const f = fixture(); await f.open(await f.discover());
    f.fetch.mockImplementation(async () => Response.json({ choices: [{ message: { content: '<tool_call>private malformed output</tool_call>' } }] }));
    const error = await f.runtime.execute('owner', { op: 'step', goal: 'Select Memories' }).catch(error => error);
    expect(computerDiagnostic(error)).toMatchObject({ phase: 'model', errorCode: 'COMPUTER_INVALID_MODEL_OUTPUT', validationReason: 'invalid_json' });
    expect(error.message).not.toContain('private');
    expect(f.fetch).toHaveBeenCalledTimes(2); expect(f.driver.perform).not.toHaveBeenCalled();
    expect(f.images.every(image => image.every(b => b === 0))).toBe(true);
    expect(isComputerControlActive('owner')).toBe(false);
  });
  it('re-observes and re-plans once after confirmed pre-dispatch change, without replaying', async () => {
    const f = fixture(); const observe = f.driver.observe.getMockImplementation()!; let calls = 0;
    f.driver.observe.mockImplementation(async () => ({ ...await observe(), stateDigest: ++calls === 1 ? 'before-change' : 'changed' }));
    await f.open(await f.discover());
    const result = await f.runtime.execute('owner', { op: 'step', goal: 'Click' });
    expect(result.receipt?.dispatch).toBe('completed');
    expect(f.fetch).toHaveBeenCalledTimes(2); expect(f.driver.perform).toHaveBeenCalledTimes(1);
    expect(result.budget?.actionsRemaining).toBe(1);
    expect(f.runtime.getReport('owner')?.counters).toMatchObject({ observationChanges: 1, modelRequests: 2,
      predictionAttempts: 2, proposedInputs: 2, completedInputs: 1, unknownDispatches: 0, rescueAttempts: 1, rescueExhaustions: 0 });
  });
  it('shares the rescue allowance across steps and never increases the opening ceiling', async () => {
    const f = fixture(); const observe = f.driver.observe.getMockImplementation()!; let calls = 0;
    f.driver.observe.mockImplementation(async () => ({ ...await observe(), stateDigest: ++calls === 1 ? 'old' : 'new' }));
    await f.open(await f.discover());
    expect((await f.runtime.execute('owner', { op: 'step', goal: 'Click once' })).budget?.rescuesRemaining).toBe(0);
    f.config.computer.maxRescuesPerSession = 3;
    f.driver.observe.mockImplementation(async () => ({ ...await observe(), stateDigest: String(++calls) }));
    await expect(f.runtime.execute('owner', { op: 'step', goal: 'Different next action' })).rejects.toThrow('UI_UNSTABLE');
    expect(f.fetch).toHaveBeenCalledTimes(3);
    expect(f.driver.perform).toHaveBeenCalledOnce();
    expect(f.runtime.getReport('owner')).toMatchObject({ status: 'released', counters: { rescueAttempts: 1, rescueExhaustions: 1 },
      failure: { dispatch: 'notStarted', phase: 'dispatch' } });
  });
  it.each([0, 2, 3])('bounds stale rescues to the configured session allowance %i', async limit => {
    const f = fixture(); f.config.computer.maxRescuesPerSession = limit;
    const observe = f.driver.observe.getMockImplementation()!; let calls = 0;
    f.driver.observe.mockImplementation(async () => ({ ...await observe(), stateDigest: String(++calls) }));
    await f.open(await f.discover());
    await expect(f.runtime.execute('owner', { op: 'step', goal: 'Click' })).rejects.toThrow('UI_UNSTABLE');
    expect(f.fetch).toHaveBeenCalledTimes(limit + 1);
    expect(f.driver.perform).not.toHaveBeenCalled();
    expect(f.runtime.getReport('owner')?.counters).toMatchObject({ rescueAttempts: limit, rescueExhaustions: 1,
      modelRequests: limit + 1, unknownDispatches: 0 });
    expect(f.images.every(image => image.every(byte => byte === 0))).toBe(true);
  });
  it('honors a lowered rescue setting before another prediction', async () => {
    const f = fixture(); const observe = f.driver.observe.getMockImplementation()!; let calls = 0;
    await f.open(await f.discover());
    f.config.computer.maxRescuesPerSession = 0;
    f.driver.observe.mockImplementation(async () => ({ ...await observe(), stateDigest: String(++calls) }));
    await expect(f.runtime.execute('owner', { op: 'step', goal: 'Click' })).rejects.toThrow('UI_UNSTABLE');
    expect(f.fetch).toHaveBeenCalledOnce(); expect(f.driver.perform).not.toHaveBeenCalled();
  });
  it('rescues a stale approved proposal under its original goal and requests fresh approval', async () => {
    const f = fixture(false); const observe = f.driver.observe.getMockImplementation()!;
    let state = 'before';
    f.driver.observe.mockImplementation(async () => ({ ...await observe(), stateDigest: state,
      summary: JSON.stringify({ text: 'fixture', elements: [{ role: 'AXWindow' }] }) }));
    await f.open(await f.discover()); f.approve();
    await vi.waitFor(() => expect(f.broker.snapshot().status).toBe('ready'));
    await f.runtime.execute('owner', { op: 'step', goal: 'Original authorized goal', expect: { kind: 'text', text: 'Original result' } });
    state = 'changed'; f.approve(); await Promise.resolve(); await Promise.resolve();
    const rescued = await f.runtime.execute('owner', { op: 'step', goal: 'Replacement goal', expect: { kind: 'text', text: 'fixture' } });
    expect(rescued.status).toBe('pending_action');
    expect(f.fetch).toHaveBeenCalledTimes(2); expect(f.driver.perform).not.toHaveBeenCalled();
    const request = JSON.parse((f.fetch.mock.calls as any)[1][1].body);
    expect(JSON.stringify(request)).toContain('Original authorized goal');
    expect(JSON.stringify(request)).not.toContain('Replacement goal');
    const acts = f.invoke.mock.calls.filter(([arg]) => arg.arguments.op === 'act');
    expect(acts[0][0].arguments.envelope.actionId).not.toBe(acts.at(-1)![0].arguments.envelope.actionId);
    f.approve(); await Promise.resolve(); await Promise.resolve();
    const result = await f.runtime.execute('owner', { op: 'step', goal: 'Resume' });
    expect(result.receipt?.dispatch).toBe('completed');
    expect(result.verification?.status).toBe('not_met');
    expect(f.fetch).toHaveBeenCalledTimes(2); expect(f.driver.perform).toHaveBeenCalledOnce();
    expect(f.runtime.getReport('owner')?.counters).toMatchObject({ rescueAttempts: 1, proposedInputs: 2, completedInputs: 1 });
    expect(f.runtime.getReport('owner')?.failure).toBeUndefined();
  });
  it('discards a native Responses continuation and queued batch on rescue', async () => {
    const f = fixture(); const observe = f.driver.observe.getMockImplementation()!; let calls = 0;
    f.driver.observe.mockImplementation(async () => ({ ...await observe(), stateDigest: ++calls === 1 ? 'old' : 'new' }));
    vi.mocked(resolveModel).mockReturnValueOnce({ id: 'gpt-5.6-sol', provider: 'openai', api: 'openai-responses', input: ['text', 'image'],
      maxTokens: 4096, baseUrl: 'https://api.openai.com/v1', computerUse: { profile: 'openai-responses-computer-v1' } } as any);
    f.fetch.mockResolvedValueOnce(Response.json({ id: 'old_response', output: [{ type: 'computer_call', call_id: 'old_call',
      actions: [{ type: 'click', button: 'left', x: 10, y: 10 }, { type: 'type', text: 'stale queued text' }] }] }))
      .mockResolvedValueOnce(Response.json({ id: 'new_response', output: [{ type: 'computer_call', call_id: 'new_call', actions: [{ type: 'click', button: 'left', x: 20, y: 20 }] }] }));
    await f.open(await f.discover());
    await f.runtime.execute('owner', { op: 'step', goal: 'Click' });
    expect(f.fetch).toHaveBeenCalledTimes(2);
    expect(JSON.parse((f.fetch.mock.calls as any)[1][1].body)).not.toHaveProperty('previous_response_id');
    expect(f.driver.perform).toHaveBeenCalledExactlyOnceWith(expect.anything(), expect.objectContaining({ kind: 'click', point: { x: 20, y: 20 } }), expect.any(AbortSignal));
  });
  it.each(['started', 'unknown', 'completed'] as const)('never rescues an observation error accompanied by a %s receipt', async dispatch => {
    const f = fixture(); await f.open(await f.discover());
    const invoke = f.invoke.getMockImplementation()!;
    f.invoke.mockImplementation(async (args: any) => {
      const result = await invoke(args);
      if (args.arguments.op === 'act') Object.assign(result.content[0].value, {
        status: 'ready', errorCode: 'COMPUTER_OBSERVATION_CHANGED',
        receipt: { actionId: args.arguments.envelope.actionId, dispatch, outcome: 'unknown', verification: 'none' },
      });
      return result;
    });
    const result = await f.runtime.execute('owner', { op: 'step', goal: 'Click' });
    expect(result.errorCode).toBe('COMPUTER_OBSERVATION_CHANGED');
    expect(f.fetch).toHaveBeenCalledOnce(); expect(f.driver.perform).toHaveBeenCalledOnce();
    expect(f.runtime.getReport('owner')?.counters.rescueAttempts).toBe(0);
  });
  it('does not turn a native execution refusal into a rescue or coordinate fallback', async () => {
    const f = fixture(); await f.open(await f.discover());
    f.driver.perform.mockRejectedValueOnce(new Error('COMPUTER_SEMANTIC_ACTION_UNCONFIRMED'));
    const result = await f.runtime.execute('owner', { op: 'step', goal: 'Click' });
    expect(result.receipt?.dispatch).toBe('unknown');
    expect(f.fetch).toHaveBeenCalledOnce(); expect(f.driver.perform).toHaveBeenCalledOnce();
    expect(f.runtime.getReport('owner')?.counters).toMatchObject({ rescueAttempts: 0, unknownDispatches: 1 });
  });
  it('honors cancellation during rescue observation without another prediction or input', async () => {
    const f = fixture(); const observe = f.driver.observe.getMockImplementation()!; let calls = 0;
    f.driver.observe.mockImplementation(async () => ({ ...await observe(), stateDigest: String(++calls) }));
    await f.open(await f.discover());
    const controller = new AbortController(); const invoke = f.invoke.getMockImplementation()!; let observations = 0;
    f.invoke.mockImplementation(async (args: any) => {
      const result = await invoke(args);
      if (args.arguments.op === 'observe' && ++observations === 2) controller.abort();
      return result;
    });
    await expect(f.runtime.execute('owner', { op: 'step', goal: 'Click' }, controller.signal)).rejects.toThrow();
    expect(f.fetch).toHaveBeenCalledOnce(); expect(f.driver.perform).not.toHaveBeenCalled();
    expect(f.runtime.getReport('owner')?.status).toBe('released');
    expect(f.images.every(image => image.every(byte => byte === 0))).toBe(true);
  });
  it('checks session expiry before starting a rescue observation', async () => {
    const f = fixture(); const observe = f.driver.observe.getMockImplementation()!; let calls = 0;
    f.driver.observe.mockImplementation(async () => ({ ...await observe(), stateDigest: String(++calls) }));
    await f.open(await f.discover());
    const now = Date.now(); const clock = vi.spyOn(Date, 'now'); const invoke = f.invoke.getMockImplementation()!;
    f.invoke.mockImplementation(async (args: any) => {
      const result = await invoke(args);
      if (args.arguments.op === 'act') clock.mockReturnValue(now + f.config.computer.maxSessionDurationMs + 1);
      return result;
    });
    try {
      await expect(f.runtime.execute('owner', { op: 'step', goal: 'Click' })).rejects.toThrow('SESSION_BUDGET');
      expect(f.fetch).toHaveBeenCalledOnce(); expect(f.driver.perform).not.toHaveBeenCalled();
      expect(f.invoke.mock.calls.filter(([arg]) => arg.arguments.op === 'observe')).toHaveLength(1);
    } finally { clock.mockRestore(); }
  });
  it('validates rescue configuration bounds and permits disabling it', () => {
    expect(ComputerConfigSchema.parse({}).maxRescuesPerSession).toBe(1);
    for (const value of [-1, 4, 1.5]) expect(ComputerConfigSchema.safeParse({ maxRescuesPerSession: value }).success).toBe(false);
    expect(ComputerConfigSchema.parse({ maxRescuesPerSession: 0 }).maxRescuesPerSession).toBe(0);
  });
  it('keeps rescue predictions within the existing model budget', async () => {
    const f = fixture(); f.config.computer.maxModelRequests = 1;
    const observe = f.driver.observe.getMockImplementation()!; let calls = 0;
    f.driver.observe.mockImplementation(async () => ({ ...await observe(), stateDigest: String(++calls) }));
    await f.open(await f.discover());
    await expect(f.runtime.execute('owner', { op: 'step', goal: 'Click' })).rejects.toThrow('MODEL_BUDGET');
    expect(f.fetch).toHaveBeenCalledOnce(); expect(f.driver.perform).not.toHaveBeenCalled();
    expect(f.runtime.getReport('owner')?.failure).toMatchObject({ category: 'budget', dispatch: 'notStarted' });
  });
  it('reports the model stage, clears screenshots and releases the session on raw network errors', async () => {
    const f = fixture(); await f.open(await f.discover());
    f.fetch.mockRejectedValue(new TypeError('fetch failed with private credential'));
    const error = await f.runtime.execute('owner', { op: 'step', goal: 'Click' }).catch(error => error);
    expect(computerDiagnostic(error)).toMatchObject({ phase: 'model', errorCode: 'COMPUTER_MODEL_FAILED' });
    expect(error.message).not.toContain('private');
    expect(f.driver.perform).not.toHaveBeenCalled();
    expect(f.images.every(image => image.every(b => b === 0))).toBe(true);
    expect(await f.runtime.execute('owner', { op: 'close' })).toMatchObject({ sessionId: 'none' });
  });
  it('preserves a model HTTP rejection through runtime cleanup without retrying or dispatching', async () => {
    const f = fixture(); await f.open(await f.discover(), 'observe');
    const requestId = crypto.randomUUID();
    f.fetch.mockResolvedValue(Response.json({ error: { code: 'max_input_tokens_exceeded', message: 'private prompt' } },
      { status: 400, headers: { 'x-xopc-request-id': requestId } }));
    const error = await f.runtime.execute('owner', { op: 'observe', question: 'Describe' }).catch(error => error);
    expect(computerDiagnostic(error)).toMatchObject({ errorCode: 'COMPUTER_MODEL_HTTP_400', phase: 'model', httpStatus: 400,
      serviceErrorCode: 'max_input_tokens_exceeded', requestId });
    expect(f.fetch).toHaveBeenCalledTimes(1);
    expect(f.driver.perform).not.toHaveBeenCalled();
    expect(f.images.every(image => image.every(b => b === 0))).toBe(true);
    expect(isComputerControlActive('owner')).toBe(false);
    expect(await f.runtime.execute('owner', { op: 'close' })).toMatchObject({ sessionId: 'none' });
  });
  it('consumes and clears frames even when response metadata is malformed', async () => {
    const f = fixture(); await f.open(await f.discover());
    const invoke = f.invoke.getMockImplementation()!;
    f.invoke.mockImplementation(async (args: any) => {
      const result = await invoke(args);
      if (args.arguments.op === 'observe') result.content[0].value.sessionId = 'wrong-session';
      return result;
    });
    await expect(f.runtime.execute('owner', { op: 'observe' })).rejects.toThrow('COMPUTER_SESSION_MISMATCH');
    expect(f.frames.size).toBe(0);
    expect(f.images.every(image => image.every(b => b === 0))).toBe(true);
  });
  it('discovers without model credentials, consent, screenshots or a control lease', async () => {
    const f = fixture();
    const result = await f.runtime.execute('owner', { op: 'discover', query: '飞书' });
    expect(result.apps).toEqual([{ appRef: expect.any(String), name: '飞书', running: true }]);
    expect(JSON.stringify(result)).not.toContain('appId');
    expect(f.driver.observe).not.toHaveBeenCalled(); expect(f.fetch).not.toHaveBeenCalled();
    expect(isComputerControlActive('owner')).toBe(false);
  });
  it('does not inherit the chat model or accept old public inputs', async () => {
    const f = fixture();
    vi.mocked(resolveEffectiveAgentConfigForSession).mockReturnValueOnce({ config: { id: 'main', models: { chat: { primary: 'ali/gui' } } } } as any);
    await expect(f.open(await f.discover())).rejects.toThrow('COMPUTER_MODEL_REQUIRED');
    expect(ComputerUseInputSchema.safeParse({ op: 'open', appId: 'fixture' }).success).toBe(false);
    expect(ComputerUseInputSchema.safeParse({ op: 'act', observationId: 'x', action: { kind: 'wait', durationMs: 0 } }).success).toBe(false);
  });
  it('cleans failed opens so the next attempt does not require manual close', async () => {
    const f = fixture(); const appRef = await f.discover();
    f.driver.resolveTarget.mockRejectedValueOnce(new Error('COMPUTER_WINDOW_REQUIRED'));
    expect(await f.open(appRef)).toMatchObject({ status: 'stopped', errorCode: 'COMPUTER_WINDOW_REQUIRED', nextAction: expect.any(String) });
    expect(isComputerControlActive('owner')).toBe(false);
    expect((await f.open(appRef)).status).toBe('ready');
  });
  it('serializes discovery and honors close before a late result', async () => {
    const f = fixture();
    let finish!: () => void;
    f.driver.discover.mockImplementationOnce(async () => {
      await new Promise<void>(resolve => { finish = resolve; });
      return [{ appId: 'fixture', name: 'Fixture', running: true }];
    });
    const discovery = f.discover();
    const rejected = expect(discovery).rejects.toThrow();
    await vi.waitFor(() => expect(f.driver.discover).toHaveBeenCalled());
    await expect(f.discover()).rejects.toThrow('COMPUTER_BUSY');
    await f.runtime.execute('owner', { op: 'close' }); finish();
    await rejected;
    expect(isComputerControlActive('owner')).toBe(false);
  });
  it('rejects control in a read-only session before model prediction', async () => {
    const f = fixture(); await f.open(await f.discover(), 'observe');
    expect((await f.runtime.execute('owner', { op: 'observe' })).summary).toBe('fixture');
    expect(f.images.every(image => image.every(byte => byte === 0))).toBe(true);
    await expect(f.runtime.execute('owner', { op: 'step', goal: 'Click' })).rejects.toThrow('READ_ONLY');
    expect(f.fetch).not.toHaveBeenCalled(); expect(f.driver.perform).not.toHaveBeenCalled();
  });
  it('answers a visual question with the pinned connection and releases the pixels', async () => {
    const f = fixture(); await f.open(await f.discover(), 'observe');
    f.fetch.mockResolvedValueOnce(Response.json({ choices: [{ message: { content: '<tool_call>{"name":"computer_use","arguments":{"action":"answer","text":"当前有一个蓝色按钮"}}</tool_call>' } }] }));
    expect(await f.runtime.execute('owner', { op: 'observe', question: '当前是什么页面？' })).toMatchObject({ summary: '当前有一个蓝色按钮', verified: false });
    expect(f.driver.perform).not.toHaveBeenCalled(); expect(f.fetch).toHaveBeenCalledTimes(1);
    expect(f.images.every(image => image.every(byte => byte === 0))).toBe(true);
  });
  it('never dispatches a visual model action in response to an observe question', async () => {
    const f = fixture(); await f.open(await f.discover());
    await expect(f.runtime.execute('owner', { op: 'observe', question: 'Read only' })).rejects.toThrow('READ_ONLY_MODEL_OUTPUT');
    expect(f.driver.perform).not.toHaveBeenCalled();
    expect(f.images.every(image => image.every(byte => byte === 0))).toBe(true);
  });
  it('suspends approvals, keeps screenshots private, and never resumes input via observe', async () => {
    const f = fixture(false);
    const observe = f.driver.observe.getMockImplementation()!;
    f.driver.observe.mockImplementation(async () => ({ ...await observe(), summary: JSON.stringify({ text: 'Button', elements: [{ role: 'AXWindow' }] }) }));
    expect((await f.open(await f.discover())).pending).toBe(true);
    expect(isComputerControlActive('owner')).toBe(true);
    expect(f.driver.observe).not.toHaveBeenCalled();
    f.approve(); await vi.waitFor(() => expect(f.broker.snapshot().status).toBe('ready'));
    expect((await f.runtime.execute('owner', { op: 'step', goal: 'Click', expect: { kind: 'text', text: 'Saved' } })).status).toBe('pending_action');
    expect((await f.runtime.execute('owner', { op: 'step', goal: 'Still waiting' })).status).toBe('pending_action');
    f.approve(); await Promise.resolve(); await Promise.resolve();
    expect((await f.runtime.execute('owner', { op: 'observe' })).status).toBe('pending_action');
    expect(f.driver.perform).not.toHaveBeenCalled();
    const result = await f.runtime.execute('owner', { op: 'step', goal: 'Continue', expect: { kind: 'text', text: 'Button' } });
    expect(f.driver.perform).toHaveBeenCalledTimes(1); expect(f.fetch).toHaveBeenCalledTimes(1);
    expect(f.runtime.getReport('owner')?.counters).toMatchObject({ proposedInputs: 1, completedInputs: 1, modelRequests: 1 });
    expect(result.receipt).toMatchObject({ dispatch: 'completed', outcome: 'unknown' });
    expect(result.verification?.status).toBe('not_met');
    expect(JSON.stringify(result)).not.toMatch(/fixture-secret|base64|image\/png/);
    expect(f.frames.size).toBe(0);
    expect(f.images.every(image => image.every(byte => byte === 0))).toBe(true);
  });
  it('reserves an action budget before prediction and closes after exhaustion', async () => {
    const f = fixture(); f.config.computer.maxActionsPerSession = 1;
    await f.open(await f.discover());
    await f.runtime.execute('owner', { op: 'step', goal: 'Click' });
    await expect(f.runtime.execute('owner', { op: 'step', goal: 'Again' })).rejects.toThrow('ACTION_BUDGET');
    expect(f.driver.perform).toHaveBeenCalledTimes(1); expect(f.fetch).toHaveBeenCalledTimes(1);
    expect(isComputerControlActive('owner')).toBe(false);
    expect(f.runtime.getReport('owner')?.failure).toMatchObject({ category: 'budget', dispatch: 'notStarted' });
  });
  it('records a model completion claim separately from verified results', async () => {
    const f = fixture(); await f.open(await f.discover());
    f.fetch.mockResolvedValue(Response.json({ choices: [{ message: { content: '<tool_call>{"name":"computer_use","arguments":{"action":"terminate","status":"success"}}</tool_call>' } }] }));
    expect(await f.runtime.execute('owner', { op: 'step', goal: 'Finish' })).toMatchObject({ claimedSuccess: true, verified: false });
    expect(f.runtime.getReport('owner')?.counters).toMatchObject({ successClaims: 1, verifiedConditions: 0, completedInputs: 0 });
  });
});

function flowRepository() {
  const records = new Map<string, ReturnType<typeof ComputerFlowSchema.parse>[]>();
  return {
    records,
    list: vi.fn((scope: string) => records.get(scope) ?? []),
    save: vi.fn((scope: string, input: any) => {
      const flow = ComputerFlowSchema.parse({ ...input, version: 1, id: crypto.randomUUID(), createdAt: Date.now(), expiresAt: Date.now() + 100_000 });
      records.set(scope, [...(records.get(scope) ?? []), flow]); return flow;
    }),
    delete: vi.fn((scope: string, id: string) => {
      const entries = records.get(scope) ?? []; records.set(scope, entries.filter(flow => flow.id !== id));
      return entries.some(flow => flow.id === id);
    }),
  };
}
function nativeNavigation(f: ReturnType<typeof fixture>) {
  let selected = false, ref = 'original-ref'; const observe = f.driver.observe.getMockImplementation()!;
  f.driver.observe.mockImplementation(async () => ({ ...await observe(), stateDigest: selected ? 'selected' : 'unselected',
    summary: JSON.stringify({ elements: [{ role: 'AXWindow' }, { ref, label: 'Memories', role: 'AXRadioButton', selected,
      semanticActions: ['activate'], bounds: { x: 350, y: 250, width: 100, height: 100 } }] }) }));
  f.driver.perform.mockImplementation(async () => { selected = true; });
  return { reset: () => { selected = false; ref = 'fresh-ref'; } };
}
const navigationStep = { op: 'step', goal: 'Open Memories', expect: { kind: 'selected', label: 'Memories' } } as const;
describe('verified flow lifecycle through the desktop broker', () => {
  it('explicitly saves after release, lists locally and replans with fresh native refs', async () => {
    const store = flowRepository(), f = fixture(true, store), state = nativeNavigation(f);
    await f.open(await f.discover());
    expect(await f.runtime.execute('owner', navigationStep)).toMatchObject({ verified: true });
    const closed = await f.runtime.execute('owner', { op: 'close', saveFlowAs: 'Open Memories' });
    expect(closed).toMatchObject({ status: 'stopped', savedFlow: { title: 'Open Memories', steps: 1 } });
    expect(isComputerControlActive('owner')).toBe(false);
    expect(JSON.stringify(store.save.mock.calls[0])).not.toMatch(/original-ref|stateDigest|goal|bounds|image|fixture-secret/);
    const calls = f.invoke.mock.calls.length, requests = f.fetch.mock.calls.length;
    expect(await f.runtime.execute('owner', { op: 'flows' })).toMatchObject({ flows: [closed.savedFlow] });
    expect(f.invoke).toHaveBeenCalledTimes(calls); expect(f.fetch).toHaveBeenCalledTimes(requests);
    state.reset(); await f.open(await f.discover());
    await f.runtime.execute('owner', { ...navigationStep, flowId: closed.savedFlow!.id });
    const body = JSON.parse((f.fetch.mock.calls as any)[1][1].body);
    expect(body.messages[1].content[1].text).toContain('Untrusted historical navigation hints');
    expect(body.messages[1].content[1].text).not.toContain('original-ref');
    expect(f.driver.perform).toHaveBeenLastCalledWith(expect.anything(), { kind: 'activate', ref: 'fresh-ref' }, expect.any(AbortSignal));
    expect(f.fetch).toHaveBeenCalledTimes(2); expect(f.driver.perform).toHaveBeenCalledTimes(2);
    await f.runtime.execute('owner', { op: 'close' });
    expect(await f.runtime.execute('owner', { op: 'forget_flow', flowId: closed.savedFlow!.id })).toMatchObject({ status: 'flow_deleted' });
    expect((await f.runtime.execute('owner', { op: 'flows' })).flows).toEqual([]);
  });
  it.each(['same', 'other', 'missing', 'other-same-endpoint'])('binds new flows to the authenticated device principal after reconnect: %s', async identity => {
    const store = flowRepository(), f = fixture(true, store), state = nativeNavigation(f);
    f.endpointIdentity.principalId = 'authenticated-device';
    await f.open(await f.discover()); await f.runtime.execute('owner', navigationStep);
    const saved = await f.runtime.execute('owner', { op: 'close', saveFlowAs: 'Device navigation' });
    expect(store.save.mock.calls[0][1]).toMatchObject({ endpointId: 'endpoint', principalId: 'authenticated-device' });
    state.reset();
    f.endpointIdentity.endpointId = identity === 'other-same-endpoint' ? 'endpoint' : 'new-connection';
    f.endpointIdentity.principalId = identity === 'same' ? 'authenticated-device' : identity.startsWith('other') ? 'another-device' : undefined;
    await f.open(await f.discover());
    const calls = f.fetch.mock.calls.length, inputs = f.driver.perform.mock.calls.length;
    if (identity === 'same') {
      expect(await f.runtime.execute('owner', { ...navigationStep, flowId: saved.savedFlow!.id })).toMatchObject({ verified: true });
      expect(f.fetch).toHaveBeenCalledTimes(calls + 1); expect(f.driver.perform).toHaveBeenCalledTimes(inputs + 1);
    } else {
      await expect(f.runtime.execute('owner', { ...navigationStep, flowId: saved.savedFlow!.id })).rejects.toThrow('COMPUTER_FLOW_TARGET_MISMATCH');
      expect(f.fetch).toHaveBeenCalledTimes(calls); expect(f.driver.perform).toHaveBeenCalledTimes(inputs);
    }
  });
  it('keeps legacy flows restricted to their original connection', async () => {
    const store = flowRepository(), f = fixture(true, store), state = nativeNavigation(f);
    await f.open(await f.discover()); await f.runtime.execute('owner', navigationStep);
    const saved = await f.runtime.execute('owner', { op: 'close', saveFlowAs: 'Legacy navigation' });
    state.reset(); f.endpointIdentity.endpointId = 'reconnected'; f.endpointIdentity.principalId = 'authenticated-device';
    await f.open(await f.discover()); const calls = f.fetch.mock.calls.length;
    await expect(f.runtime.execute('owner', { ...navigationStep, flowId: saved.savedFlow!.id })).rejects.toThrow('COMPUTER_FLOW_TARGET_MISMATCH');
    expect(f.fetch).toHaveBeenCalledTimes(calls);
  });
  it('saves positive page evidence from partial native snapshots without certifying selected-state evidence', async () => {
    const store = flowRepository(), f = fixture(true, store); nativeNavigation(f);
    f.fetch.mockResolvedValueOnce(Response.json({ choices: [{ message: {
      content: '<tool_call>{"name":"computer_use","arguments":{"action":"activate","ref":"original-ref"}}</tool_call>',
    } }] }));
    const observe = f.driver.observe.getMockImplementation()!;
    f.driver.observe.mockImplementation(async () => {
      const value = await observe(), tree = JSON.parse(value.summary);
      const selected = tree.elements.find((e: any) => e.label === 'Memories').selected;
      return { ...value, summary: JSON.stringify({ ...tree, truncated: true, text: selected ? 'HTML Saving Options' : 'Native navigation controls' }) };
    });
    await f.open(await f.discover());
    expect(await f.runtime.execute('owner', { ...navigationStep, expect: { kind: 'text', text: 'HTML Saving Options' } })).toMatchObject({ verified: true });
    const observed = await f.runtime.execute('owner', { op: 'observe', expect: navigationStep.expect });
    expect(observed.verification?.status).toBe('unavailable');
    expect(await f.runtime.execute('owner', { op: 'close', saveFlowAs: 'Page navigation' })).toMatchObject({ savedFlow: { steps: 1 } });
    expect(store.save.mock.calls[0][1]).toMatchObject({ coverage: 'partial', condition: { kind: 'text', text: 'HTML Saving Options' } });
    expect(f.runtime.getReport('owner')?.counters.successClaims).toBe(0);
  });
  it('never saves automatically or learns from a model success claim', async () => {
    const store = flowRepository(), f = fixture(true, store); nativeNavigation(f);
    await f.open(await f.discover()); await f.runtime.execute('owner', navigationStep);
    await f.runtime.execute('owner', { op: 'close' }); expect(store.save).not.toHaveBeenCalled();
    await f.open(await f.discover());
    f.fetch.mockResolvedValueOnce(Response.json({ choices: [{ message: { content: '<tool_call>{"name":"computer_use","arguments":{"action":"terminate","status":"success"}}</tool_call>' } }] }));
    await f.runtime.execute('owner', { op: 'step', goal: 'Finish' });
    expect(await f.runtime.execute('owner', { op: 'close', saveFlowAs: 'Claim' })).toMatchObject({ errorCode: 'COMPUTER_FLOW_NOT_VERIFIED' });
    expect(store.save).not.toHaveBeenCalled();
  });
  it.each(['app', 'endpoint', 'missing'])('refuses %s mismatch before prediction or native input', async mismatch => {
    const store = flowRepository(), f = fixture(true, store); nativeNavigation(f);
    const id = crypto.randomUUID();
    store.records.set(JSON.stringify(['main', null]), [ComputerFlowSchema.parse({ version: 1, id, title: 'Navigation',
      appId: mismatch === 'app' ? 'other-app' : 'fixture', endpointId: mismatch === 'endpoint' ? 'other-endpoint' : 'endpoint',
      steps: [{ kind: 'activate', role: 'AXRadioButton', label: 'Memories' }], condition: navigationStep.expect,
      createdAt: Date.now(), expiresAt: Date.now() + 100_000 })]);
    await f.open(await f.discover());
    await expect(f.runtime.execute('owner', { ...navigationStep, flowId: mismatch === 'missing' ? crypto.randomUUID() : id })).rejects.toThrow('COMPUTER_FLOW_');
    expect(f.fetch).not.toHaveBeenCalled(); expect(f.driver.perform).not.toHaveBeenCalled();
    expect(f.images.every(image => image.every(byte => byte === 0))).toBe(true);
  });
  it('retains release uncertainty and refuses to persist even a verified sequence', async () => {
    const store = flowRepository(), f = fixture(true, store); nativeNavigation(f);
    await f.open(await f.discover()); await f.runtime.execute('owner', navigationStep);
    const invoke = f.invoke.getMockImplementation()!;
    f.invoke.mockImplementation(async (args: any) => { if (args.arguments.op === 'release') throw new Error('lost release'); return invoke(args); });
    expect(await f.runtime.execute('owner', { op: 'close', saveFlowAs: 'Navigation' })).toMatchObject({ status: 'stop_unconfirmed' });
    expect(store.save).not.toHaveBeenCalled(); expect(isComputerControlActive('owner')).toBe(true);
    f.invoke.mockImplementation(invoke);
  });
  it('shares flows across conversations only within the same Agent and workspace', async () => {
    const store = flowRepository(), f = fixture(true, store); nativeNavigation(f);
    await f.open(await f.discover()); await f.runtime.execute('owner', navigationStep);
    const closed = await f.runtime.execute('owner', { op: 'close', saveFlowAs: 'Navigation' });
    expect((await f.runtime.execute('second-conversation', { op: 'flows' })).flows).toEqual([closed.savedFlow]);
    for (const config of [{ id: 'other', workspace: undefined }, { id: 'main', workspace: '/different' }]) {
      vi.mocked(resolveEffectiveAgentConfigForSession).mockReturnValueOnce({ config } as any);
      expect((await f.runtime.execute('second-conversation', { op: 'flows' })).flows).toEqual([]);
    }
  });
  it('refuses an unrelated receipt instead of turning its observation into reusable evidence', async () => {
    const store = flowRepository(), f = fixture(true, store); nativeNavigation(f);
    await f.open(await f.discover()); const invoke = f.invoke.getMockImplementation()!;
    f.invoke.mockImplementation(async (args: any) => {
      const result = await invoke(args);
      if (args.arguments.op === 'act' && result.content[0].value.receipt) result.content[0].value.receipt.actionId = 'unrelated-action';
      return result;
    });
    await expect(f.runtime.execute('owner', navigationStep)).rejects.toThrow('RECEIPT_MISMATCH');
    expect(f.runtime.getReport('owner')?.failure).toMatchObject({ dispatch: 'unknown', category: 'transport' });
    expect(await f.runtime.execute('owner', { op: 'close', saveFlowAs: 'Invalid evidence' })).toMatchObject({ errorCode: 'COMPUTER_FLOW_NOT_VERIFIED' });
    expect(store.save).not.toHaveBeenCalled(); expect(f.driver.perform).toHaveBeenCalledOnce();
  });
  it('does not replay a saved flow when native execution becomes uncertain', async () => {
    const store = flowRepository(), f = fixture(true, store), state = nativeNavigation(f);
    await f.open(await f.discover()); await f.runtime.execute('owner', navigationStep);
    const closed = await f.runtime.execute('owner', { op: 'close', saveFlowAs: 'Navigation' });
    state.reset(); await f.open(await f.discover());
    f.driver.perform.mockRejectedValueOnce(new Error('COMPUTER_SEMANTIC_ACTION_UNCONFIRMED'));
    const result = await f.runtime.execute('owner', { ...navigationStep, flowId: closed.savedFlow!.id });
    expect(result.receipt?.dispatch).toBe('unknown');
    expect(f.fetch).toHaveBeenCalledTimes(2); expect(f.driver.perform).toHaveBeenCalledTimes(2);
    expect(await f.runtime.execute('owner', { op: 'close', saveFlowAs: 'Uncertain' })).toMatchObject({ errorCode: 'COMPUTER_FLOW_NOT_VERIFIED' });
    expect(store.save).toHaveBeenCalledOnce();
  });
  it('refuses a previously verified prefix after a human takeover', async () => {
    const store = flowRepository(), f = fixture(true, store); nativeNavigation(f);
    await f.open(await f.discover()); await f.runtime.execute('owner', navigationStep);
    f.fetch.mockResolvedValueOnce(Response.json({ choices: [{ message: { content: '<tool_call>{"name":"computer_use","arguments":{"action":"interact","text":"Confirm a consequential effect"}}</tool_call>' } }] }));
    expect((await f.runtime.execute('owner', { op: 'step', goal: 'Inspect next task' })).status).toBe('takeover');
    expect(await f.runtime.execute('owner', { op: 'close', saveFlowAs: 'Prefix' })).toMatchObject({ errorCode: 'COMPUTER_FLOW_NOT_VERIFIED' });
    expect(store.save).not.toHaveBeenCalled();
  });
  it('releases control on cancellation without saving a verified flow', async () => {
    const store = flowRepository(), f = fixture(true, store); nativeNavigation(f);
    await f.open(await f.discover()); await f.runtime.execute('owner', navigationStep);
    const controller = new AbortController(); controller.abort();
    expect(await f.runtime.execute('owner', { op: 'close', saveFlowAs: 'Navigation' }, controller.signal)).toMatchObject({ status: 'stopped', errorCode: 'COMPUTER_FLOW_NOT_VERIFIED' });
    expect(store.save).not.toHaveBeenCalled(); expect(isComputerControlActive('owner')).toBe(false);
    await expect(f.runtime.execute('owner', { op: 'forget_flow', flowId: crypto.randomUUID() }, controller.signal)).rejects.toThrow();
    expect(store.delete).not.toHaveBeenCalled();
  });
  it('reports storage failure after releasing control without repeating an action', async () => {
    const store = flowRepository(), f = fixture(true, store); nativeNavigation(f);
    store.save.mockImplementation(() => { throw new Error('private database error'); });
    await f.open(await f.discover()); await f.runtime.execute('owner', navigationStep);
    const result = await f.runtime.execute('owner', { op: 'close', saveFlowAs: 'Navigation' });
    expect(result).toMatchObject({ status: 'stopped', errorCode: 'COMPUTER_FLOW_SAVE_FAILED' });
    expect(JSON.stringify(result)).not.toContain('private database');
    expect(f.driver.perform).toHaveBeenCalledOnce(); expect(f.fetch).toHaveBeenCalledOnce();
    expect(isComputerControlActive('owner')).toBe(false);
  });
});

describe('bounded small-goal execution', () => {
  function goalFixture(steps = 3) {
    const f = fixture();
    f.config.computer.maxActionsPerSession = 80;
    let stage = 0;
    const observe = f.driver.observe.getMockImplementation()!;
    f.driver.perform.mockImplementation(async () => { stage++; });
    f.driver.observe.mockImplementation(async () => ({ ...await observe(), stateDigest: `stage-${stage}`,
      summary: JSON.stringify({ text: stage >= steps ? 'Workflow complete' : `Stage ${stage}`, elements: [{ role: 'AXWindow' }] }) }));
    return f;
  }
  const goal = { op: 'run' as const, goal: 'Complete the fixture workflow', expect: { kind: 'text' as const, text: 'Workflow complete' } };

  it('finishes three guarded actions in one invocation, reusing two frames and zeroing all pixels', async () => {
    const f = goalFixture(); await f.open(await f.discover());
    const result = await f.runtime.execute('owner', goal);
    expect(result).toMatchObject({ status: 'goal_satisfied', verified: true,
      run: { actionsExecuted: 3, modelRequests: 3, observationsReused: 2, stopReason: 'condition_satisfied' } });
    expect(f.invoke.mock.calls.filter(([call]) => call.arguments.op === 'observe')).toHaveLength(1);
    // One initial observation plus a fresh pre-dispatch check and post-action observation per input.
    expect(f.driver.observe).toHaveBeenCalledTimes(7);
    expect(f.driver.perform).toHaveBeenCalledTimes(3);
    expect(f.images.every(image => image.every(byte => byte === 0))).toBe(true);
    expect(JSON.stringify(result)).not.toMatch(/base64|mimeType|stateDigest/);
  });
  it('executes a conditional button plan with one model request while checking every dispatch', async () => {
    const f = fixture();
    f.config.computer.maxActionsPerSession = 80;
    f.config.computer.maxModelRequests = 1;
    vi.mocked(resolveModel).mockReturnValueOnce({ id: 'custom-vision', provider: 'custom', api: 'openai-completions',
      input: ['text', 'image'], baseUrl: 'https://proxy.test/v1' } as any);
    let stage = 0;
    const observe = f.driver.observe.getMockImplementation()!;
    f.driver.perform.mockImplementation(async () => { stage++; });
    f.driver.observe.mockImplementation(async () => ({ ...await observe(), stateDigest: `stage-${stage}`,
      summary: JSON.stringify({ text: stage >= 3 ? 'Workflow complete' : `- AXStaticText = "Stage ${stage}"`,
        elements: [{ role: 'AXWindow' }, { role: 'AXButton', label: 'Continue', ref: `e${stage}`, semanticActions: ['activate'] }] }) }));
    const proposal = { kind: 'button_plan', steps: [0, 1, 2].map(i => ({ label: 'Continue', when: { text: `Stage ${i}` } })) };
    f.fetch.mockResolvedValue(Response.json({ choices: [{ message: { tool_calls: [{ function: {
      name: 'computer_proposal', arguments: JSON.stringify({ proposal }),
    } }] } }] }));
    await f.open(await f.discover());
    const result = await f.runtime.execute('owner', goal);
    expect(result).toMatchObject({ status: 'goal_satisfied', verified: true,
      run: { actionsExecuted: 3, modelRequests: 1, observationsReused: 2 }, budget: { modelRequestsRemaining: 0 } });
    expect(f.fetch).toHaveBeenCalledTimes(1);
    expect(f.driver.observe).toHaveBeenCalledTimes(9);
    expect(f.driver.perform.mock.calls.map(([, action]) => action)).toEqual([0, 1, 2].map(i => ({ kind: 'activate', ref: `e${i}` })));
    expect(f.images.every(image => image.every(byte => byte === 0))).toBe(true);
  });
  it.each(['settles', 'unstable', 'capture_failure'] as const)('bounds fast-plan post-action stability checks: %s', async mode => {
    const f = fixture(); f.config.computer.maxActionsPerSession = 80;
    vi.mocked(resolveModel).mockReturnValueOnce({ id: 'custom-vision', provider: 'custom', api: 'openai-completions',
      input: ['text', 'image'], baseUrl: 'https://proxy.test/v1' } as any);
    let stage = 0, postReads = 0;
    const observe = f.driver.observe.getMockImplementation()!;
    f.driver.perform.mockImplementation(async () => { stage++; postReads = 0; });
    f.driver.observe.mockImplementation(async () => {
      const read = stage ? ++postReads : 0;
      if (mode === 'capture_failure' && read === 2) throw new Error('COMPUTER_CAPTURE_REQUIRED');
      return { ...await observe(), stateDigest: stage && (mode === 'unstable' || read === 1) ? `${stage}-animation-${read}` : `stage-${stage}`,
        summary: JSON.stringify({ text: stage >= 3 ? 'Workflow complete' : `- AXStaticText = "Stage ${stage}"`,
          elements: [{ role: 'AXWindow' }, { role: 'AXButton', label: 'Continue', ref: `e${stage}`, semanticActions: ['activate'] }] }) };
    });
    const proposal = { kind: 'button_plan', steps: [0, 1, 2].map(i => ({ label: 'Continue', when: { text: `Stage ${i}` } })) };
    f.fetch.mockResolvedValue(Response.json({ choices: [{ message: { tool_calls: [{ function: {
      name: 'computer_proposal', arguments: JSON.stringify({ proposal }),
    } }] } }] }));
    await f.open(await f.discover());
    const result = await f.runtime.execute('owner', goal);
    if (mode === 'settles') {
      expect(result).toMatchObject({ status: 'goal_satisfied', run: { modelRequests: 1, actionsExecuted: 3 } });
      expect(f.driver.observe).toHaveBeenCalledTimes(11);
    } else {
      expect(result).toMatchObject({ errorCode: mode === 'unstable' ? 'COMPUTER_UI_UNSTABLE' : 'COMPUTER_POST_ACTION_OBSERVATION_FAILED',
        receipt: { dispatch: 'completed' }, run: { actionsExecuted: 1, stopReason: 'handoff' } });
      expect(f.driver.perform).toHaveBeenCalledTimes(1);
      expect(f.runtime.getReport('owner')?.counters).toMatchObject({ completedInputs: 1, unknownDispatches: 0 });
    }
    expect(f.images.every(image => image.every(byte => byte === 0))).toBe(true);
  });
  it('keeps legacy step single-action and fresh across Agent turns', async () => {
    const f = goalFixture(); await f.open(await f.discover());
    for (let i = 0; i < 3; i++) await f.runtime.execute('owner', { ...goal, op: 'step' });
    expect(f.driver.perform).toHaveBeenCalledTimes(3);
    expect(f.driver.observe).toHaveBeenCalledTimes(9);
    expect(f.images.every(image => image.every(byte => byte === 0))).toBe(true);
  });
  it('yields at the action limit without claiming completion or retaining a screenshot', async () => {
    const f = goalFixture(); await f.open(await f.discover());
    expect(await f.runtime.execute('owner', { ...goal, maxActions: 2 })).toMatchObject({ status: 'goal_limit', verified: false,
      run: { actionsExecuted: 2, observationsReused: 1, stopReason: 'action_limit' } });
    expect(f.driver.perform).toHaveBeenCalledTimes(2);
    expect(f.images.every(image => image.every(byte => byte === 0))).toBe(true);
    await f.runtime.execute('owner', { op: 'step', goal: 'Continue' });
    expect(f.invoke.mock.calls.filter(([call]) => call.arguments.op === 'observe')).toHaveLength(2);
  });
  it('does not treat text present before the run as proof of the requested action', async () => {
    const f = goalFixture(0); await f.open(await f.discover());
    expect(await f.runtime.execute('owner', goal)).toMatchObject({ status: 'condition_present', verified: false,
      run: { actionsExecuted: 0, stopReason: 'condition_present' } });
    expect(f.fetch).not.toHaveBeenCalled(); expect(f.driver.perform).not.toHaveBeenCalled();
  });
  it('retains the native guard and replans if a reused observation changes before dispatch', async () => {
    const f = goalFixture(); await f.open(await f.discover());
    const observe = f.driver.observe.getMockImplementation()!;
    let changed = false;
    f.driver.observe.mockImplementation(async () => ({ ...await observe(), ...(changed ? { stateDigest: 'externally-changed' } : {}) }));
    const fetch = f.fetch.getMockImplementation()!;
    f.fetch.mockImplementation(async () => {
      if (f.fetch.mock.calls.length === 2) changed = true;
      return fetch();
    });
    const result = await f.runtime.execute('owner', goal);
    expect(result).toMatchObject({ status: 'goal_satisfied', run: { actionsExecuted: 3, modelRequests: 4 } });
    expect(f.driver.perform).toHaveBeenCalledTimes(3);
    expect(f.runtime.getReport('owner')?.counters).toMatchObject({ observationChanges: 1, rescueAttempts: 1, unknownDispatches: 0 });
    expect(f.images.every(image => image.every(byte => byte === 0))).toBe(true);
  });
  it('expires cached observations before predicting the next action', async () => {
    const f = goalFixture(2); await f.open(await f.discover());
    const invoke = f.invoke.getMockImplementation()!;
    let now = Date.now(); const clock = vi.spyOn(Date, 'now').mockImplementation(() => now);
    f.invoke.mockImplementation(async (args: any) => {
      if (args.arguments.op === 'status' && f.driver.perform.mock.calls.length) now += 6000;
      return invoke(args);
    });
    try {
      expect(await f.runtime.execute('owner', goal)).toMatchObject({ status: 'goal_satisfied', run: { observationsReused: 0 } });
      expect(f.driver.observe).toHaveBeenCalledTimes(6);
      expect(f.images.every(image => image.every(byte => byte === 0))).toBe(true);
    } finally { clock.mockRestore(); }
  });
  it('honors session action budgets inside the goal', async () => {
    const f = goalFixture(); f.config.computer.maxActionsPerSession = 1; await f.open(await f.discover());
    await expect(f.runtime.execute('owner', goal)).rejects.toThrow('COMPUTER_ACTION_BUDGET');
    expect(f.driver.perform).toHaveBeenCalledOnce();
    expect(f.images.every(image => image.every(byte => byte === 0))).toBe(true);
  });
  it('stops on a model success claim without upgrading it to verification', async () => {
    const f = goalFixture(); await f.open(await f.discover());
    f.fetch.mockResolvedValueOnce(Response.json({ choices: [{ message: { content: '<tool_call>{"name":"computer_use","arguments":{"action":"terminate","status":"success"}}</tool_call>' } }] }));
    expect(await f.runtime.execute('owner', goal)).toMatchObject({ status: 'model_finished', verified: false, run: { actionsExecuted: 0, stopReason: 'handoff' } });
    expect(f.driver.perform).not.toHaveBeenCalled();
  });
  it('never replays uncertain dispatch and clears all frames on failure', async () => {
    const f = goalFixture(); await f.open(await f.discover());
    const invoke = f.invoke.getMockImplementation()!;
    f.invoke.mockImplementation(async (args: any) => { const result = await invoke(args); if (args.arguments.op === 'act') throw new Error('Lost reply'); return result; });
    await expect(f.runtime.execute('owner', goal)).rejects.toThrow();
    expect(f.driver.perform).toHaveBeenCalledOnce();
    // A lost endpoint reply can retain its upload until endpoint cleanup; runtime never takes or reuses it.
    expect(f.fetch).toHaveBeenCalledOnce();
  });
  it('keeps the original goal and resumes held approvals inside the same call', async () => {
    const f = fixture(false); f.config.computer.maxActionsPerSession = 80;
    const app = await f.discover(); await f.open(app); f.approve();
    await vi.waitFor(() => expect(f.broker.snapshot().status).toBe('ready'));
    let stage = 0; const observe = f.driver.observe.getMockImplementation()!;
    f.driver.perform.mockImplementation(async () => { stage++; });
    f.driver.observe.mockImplementation(async () => ({ ...await observe(), stateDigest: String(stage),
      summary: JSON.stringify({ text: stage === 2 ? 'Workflow complete' : 'In progress', elements: [{ role: 'AXWindow' }] }) }));
    const running = f.runtime.execute('owner', goal);
    await vi.waitFor(() => expect(f.broker.snapshot().status).toBe('pending_action'));
    expect(f.driver.perform).not.toHaveBeenCalled(); f.approve();
    await vi.waitFor(() => expect(f.driver.perform).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(f.broker.snapshot().status).toBe('pending_action'));
    f.approve();
    expect(await running).toMatchObject({ status: 'goal_satisfied', run: { actionsExecuted: 2, observationsReused: 1 } });
    expect(f.fetch).toHaveBeenCalledTimes(2);
    expect(f.images.every(image => image.every(byte => byte === 0))).toBe(true);
  });
  it('prevents concurrent inputs and responds to cancellation without a second action', async () => {
    const f = goalFixture(); await f.open(await f.discover());
    const fetch = f.fetch.getMockImplementation()!;
    let entered!: () => void; const waiting = new Promise<void>(resolve => { entered = resolve; });
    f.fetch.mockImplementation(async (...args: any[]) => {
      if (f.fetch.mock.calls.length === 1) return fetch();
      entered(); const signal = args[1].signal as AbortSignal;
      return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }));
    });
    const controller = new AbortController();
    const running = f.runtime.execute('owner', goal, controller.signal);
    const rejected = expect(running).rejects.toThrow();
    await waiting;
    await expect(f.runtime.execute('owner', { op: 'step', goal: 'Concurrent' })).rejects.toThrow('COMPUTER_BUSY');
    controller.abort(); await rejected;
    expect(f.driver.perform).toHaveBeenCalledOnce();
    expect(f.images.every(image => image.every(byte => byte === 0))).toBe(true);
    expect(f.broker.snapshot().status).toBe('stopped');
  });
  it('yields at the time boundary without starting another prediction', async () => {
    const f = goalFixture(); await f.open(await f.discover());
    let now = Date.now(); const clock = vi.spyOn(Date, 'now').mockImplementation(() => now);
    f.driver.perform.mockImplementation(async () => { now += 120001; });
    try {
      expect(await f.runtime.execute('owner', goal)).toMatchObject({ status: 'goal_limit', verified: false,
        run: { actionsExecuted: 1, stopReason: 'time_limit' } });
      expect(f.fetch).toHaveBeenCalledOnce();
      expect(f.images.every(image => image.every(byte => byte === 0))).toBe(true);
    } finally { clock.mockRestore(); }
  });
  it('uses the default six-action ceiling even when the session has a larger budget', async () => {
    const f = goalFixture(8); await f.open(await f.discover());
    expect(await f.runtime.execute('owner', goal)).toMatchObject({ status: 'goal_limit', verified: false,
      run: { actionsExecuted: 6, modelRequests: 6, observationsReused: 5, stopReason: 'action_limit' } });
    expect(f.driver.perform).toHaveBeenCalledTimes(6);
    expect(f.images.every(image => image.every(byte => byte === 0))).toBe(true);
  });
  it('retains native already-satisfied selected-state completion without input', async () => {
    const f = goalFixture(); await f.open(await f.discover());
    const observe = f.driver.observe.getMockImplementation()!;
    f.driver.observe.mockImplementation(async () => ({ ...await observe(), summary: JSON.stringify({ text: 'Destination',
      elements: [{ role: 'AXWindow' }, { role: 'AXTab', label: 'Destination', selected: true }] }) }));
    expect(await f.runtime.execute('owner', { ...goal, expect: { kind: 'selected', label: 'Destination' } })).toMatchObject({ status: 'goal_satisfied', verified: true, run: { actionsExecuted: 0, modelRequests: 0 } });
    expect(f.driver.perform).not.toHaveBeenCalled();
  });
  it('rejects run in read-only sessions and validates bounds and required expectations', async () => {
    const f = goalFixture(); await f.open(await f.discover(), 'observe');
    await expect(f.runtime.execute('owner', goal)).rejects.toThrow('COMPUTER_READ_ONLY');
    expect(f.fetch).not.toHaveBeenCalled();
    for (const raw of [{ op: 'run', goal: 'Continue' }, { ...goal, maxActions: 0 }, { ...goal, maxActions: 13 }]) expect(ComputerUseInputSchema.safeParse(raw).success).toBe(false);
  });
});
