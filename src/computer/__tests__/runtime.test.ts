import { afterEach, describe, expect, it, vi } from 'vitest';
import { ComputerBroker } from '../broker.js';
import { ComputerRuntime, ComputerUseInputSchema } from '../runtime.js';
import { isComputerControlActive } from '../control-guard.js';
import { ComputerConfigSchema } from '../config.js';
import { canonicalJson } from '@xopcai/endpoint-tools-protocol';
import { resolveEffectiveAgentConfigForSession } from '../../config/agent-profile.js';

vi.mock('../../config/agent-profile.js', () => ({ resolveEffectiveAgentConfigForSession: vi.fn(() => ({ config: { id: 'main', models: { computerUse: { primary: 'ali/gui' } } } })) }));
vi.mock('../../providers/index.js', () => ({
  getApiKey: async (_provider: string, options: any) => {
    if (!options.agentId || !options.appConfig) throw new Error('Agent credentials require appConfig');
    return 'fixture-secret';
  },
  resolveModel: () => ({ id: 'gui-plus-2026-02-26', provider: 'ali', api: 'openai-completions', input: ['text', 'image'], baseUrl: 'https://model.test/v1', computerUse: { profile: 'gui-plus-2026-02-26' } }),
}));

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => { await Promise.all(cleanups.splice(0).map(fn => fn())); vi.unstubAllGlobals(); });
function fixture(fullControl = true) {
  const target = { appId: 'fixture', pid: 1, processIdentity: 'fixture:1', windowId: '1', width: 800, height: 600, geometryRevision: '1' };
  const images: Uint8Array[] = [];
  const driver = { discover: vi.fn(async () => [{ appId: 'fixture', name: '飞书', running: true }]),
    resolveTarget: vi.fn(async () => target), stop: vi.fn(async () => {}), perform: vi.fn(async () => {}),
    observe: vi.fn(async () => {
      const image = new Uint8Array([1, 2, 3]); images.push(image);
      return { target, summary: 'fixture', stateDigest: 'fixed', image, mimeType: 'image/png' as const, imageWidth: 800, imageHeight: 600 };
    }) };
  let approve!: (value: boolean) => void;
  const broker = new ComputerBroker(driver, { isVisible: () => true, hasFullControl: () => fullControl,
    requestApproval: () => new Promise(resolve => { approve = resolve; }) }, { enabled: true });
  const frames = new Map<string, Uint8Array>();
  const config = { computer: ComputerConfigSchema.parse({ enabled: true, maxActionsPerSession: 2 }) };
  const fetch = vi.fn(async () => Response.json({ choices: [{ finish_reason: 'stop', message: { content: '<tool_call>{"name":"computer_use","arguments":{"action":"left_click","coordinate":[500,500]}}</tool_call>' } }] }));
  vi.stubGlobal('fetch', fetch);
  const invoke = vi.fn(async ({ arguments: args }: any) => {
    canonicalJson(args);
    const { frame, ...value } = await broker.command(args);
    const content: any[] = [{ type: 'json', value }];
    if (frame) { frames.set('frame', frame.bytes); content.push({ type: 'file', fileId: 'frame', mimeType: frame.mimeType }); }
    return { content, invocationId: 'invoke' };
  });
  const endpoint = { bindings: { get: () => undefined, resolve: () => undefined }, registry: {
    get: (id: string) => id === 'endpoint' ? ({ kind: 'desktop', endpointId: id }) : undefined, getTool: () => ({ revision: 'r1' }) },
    invocations: { invoke }, uploads: { takeComputerFrame: (id: string) => { const value = frames.get(id); frames.delete(id); return value; } } };
  const runtime = new ComputerRuntime(endpoint as any, () => config as any, () => 'endpoint');
  cleanups.push(async () => { await runtime.shutdown(); await broker.dispose(); });
  return { runtime, broker, driver, frames, images, config, fetch, invoke, approve: (value = true) => approve(value),
    discover: async () => (await runtime.execute('owner', { op: 'discover', query: '飞书' })).apps![0].appRef,
    open: async (appRef: string, mode: 'observe' | 'control' = 'control') => runtime.execute('owner', { op: 'open', appRef, mode, prepare: false }) };
}
describe('agent to broker desktop lifecycle', () => {
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
    expect((await f.open(await f.discover())).pending).toBe(true);
    expect(isComputerControlActive('owner')).toBe(true);
    expect(f.driver.observe).not.toHaveBeenCalled();
    f.approve(); await vi.waitFor(() => expect(f.broker.snapshot().status).toBe('ready'));
    expect((await f.runtime.execute('owner', { op: 'step', goal: 'Click' })).status).toBe('pending_action');
    expect((await f.runtime.execute('owner', { op: 'step', goal: 'Still waiting' })).status).toBe('pending_action');
    f.approve(); await Promise.resolve(); await Promise.resolve();
    expect((await f.runtime.execute('owner', { op: 'observe' })).status).toBe('pending_action');
    expect(f.driver.perform).not.toHaveBeenCalled();
    const result = await f.runtime.execute('owner', { op: 'step', goal: 'Continue' });
    expect(f.driver.perform).toHaveBeenCalledTimes(1); expect(f.fetch).toHaveBeenCalledTimes(1);
    expect(result.receipt).toMatchObject({ dispatch: 'completed', outcome: 'unknown' });
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
  });
});
