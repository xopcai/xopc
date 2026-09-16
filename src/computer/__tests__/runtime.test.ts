import { afterEach, describe, expect, it, vi } from 'vitest';
import { ComputerBroker } from '../broker.js';
import { ComputerRuntime } from '../runtime.js';
import { isComputerControlActive } from '../control-guard.js';
import { ComputerConfigSchema } from '../config.js';
import { canonicalJson } from '@xopcai/endpoint-tools-protocol';
import { resolveEffectiveAgentConfigForSession } from '../../config/agent-profile.js';

vi.mock('../../config/agent-profile.js', () => ({ resolveEffectiveAgentConfigForSession: vi.fn(() => ({ config: { id: 'main', models: { chat: { primary: 'ali/chat' }, computerUse: { primary: 'ali/gui' } } } })) }));
vi.mock('../../providers/index.js', () => ({
  getApiKey: async (_provider: string, options: any) => {
    if (!options.agentId || !options.appConfig) throw new Error('Agent credentials require appConfig');
    return 'fixture-secret';
  },
  resolveModel: () => ({ id: 'gui-plus-2026-02-26', provider: 'ali', api: 'openai-completions', input: ['text', 'image'], baseUrl: 'https://model.test/v1', computerUse: { profile: 'gui-plus-2026-02-26' } }),
}));

afterEach(() => vi.unstubAllGlobals());
describe('agent to broker single-step lifecycle (synthetic driver)', () => {
  it('does not inherit a chat model when no computer model is selected', async () => {
    vi.mocked(resolveEffectiveAgentConfigForSession).mockReturnValueOnce({ config: { id: 'main', models: { chat: { primary: 'ali/gui' } } } } as any);
    const runtime = new ComputerRuntime({ bindings: { get: () => undefined, resolve: () => ({ kind: 'desktop' }) } } as any,
      () => ({ computer: ComputerConfigSchema.parse({ enabled: true }) }) as any);
    await expect(runtime.execute('owner', { op: 'open', appId: 'fixture' })).rejects.toThrow('COMPUTER_MODEL_REQUIRED');
  });
  it('suspends approvals, keeps screenshots private, and does not act during observe', async () => {
    const target = { appId: 'fixture', pid: 1, processIdentity: 'fixture:1', windowId: '1', width: 800, height: 600, geometryRevision: '1' };
    const driver = { resolveTarget: vi.fn(async () => target), stop: vi.fn(async () => {}), perform: vi.fn(async () => {}),
      observe: vi.fn(async () => ({ target, summary: 'fixture', stateDigest: 'fixed', image: new Uint8Array([1, 2, 3]), mimeType: 'image/png' as const, imageWidth: 800, imageHeight: 600 })) };
    let approve!: (value: boolean) => void;
    const broker = new ComputerBroker(driver, { isVisible: () => true, requestApproval: () => new Promise(resolve => { approve = resolve; }) }, { enabled: true });
    const frames = new Map<string, Uint8Array>();
    const config = { computer: ComputerConfigSchema.parse({ enabled: true, maxActionsPerSession: 2 }) };
    const fetch = vi.fn(async () => Response.json({ choices: [{ finish_reason: 'stop', message: { content: '<tool_call>{"name":"computer_use","arguments":{"action":"left_click","coordinate":[500,500]}}</tool_call>' } }] }));
    vi.stubGlobal('fetch', fetch);
    const endpoint = { bindings: { get: () => undefined, resolve: () => undefined }, registry: { get: (id: string) => id === 'endpoint' ? ({ kind: 'desktop', endpointId: id }) : undefined, getTool: () => ({ revision: 'r1' }) },
      invocations: { invoke: async ({ arguments: args }: any) => {
        canonicalJson(args);
        const { frame, ...value } = await broker.command(args);
        const content: any[] = [{ type: 'json', value }];
        if (frame) { frames.set('frame', frame.bytes); content.push({ type: 'file', fileId: 'frame', mimeType: frame.mimeType }); }
        return { content, invocationId: 'invoke' };
      } }, uploads: { takeComputerFrame: (id: string) => { const value = frames.get(id); frames.delete(id); return value; } } };
    const runtime = new ComputerRuntime(endpoint as any, () => config as any, owner => owner === 'owner' ? 'endpoint' : undefined);
    try {
      expect((await runtime.execute('owner', { op: 'open', appId: 'fixture' })).pending).toBe(true);
      expect(isComputerControlActive('owner')).toBe(true);
      expect(fetch).not.toHaveBeenCalled(); expect(driver.observe).not.toHaveBeenCalled();
      approve(true); await vi.waitFor(() => expect(broker.snapshot().status).toBe('ready'));
      expect((await runtime.execute('owner', { op: 'step', goal: 'Click' })).status).toBe('pending_action');
      expect((await runtime.execute('owner', { op: 'step', goal: 'Still waiting' })).status).toBe('pending_action');
      approve(true); await Promise.resolve(); await Promise.resolve();
      const pending = await runtime.execute('owner', { op: 'observe' });
      expect(pending.status).toBe('pending_action');
      expect(pending.summary).toContain('"op":"step"');
      expect(driver.perform).not.toHaveBeenCalled();
      const result = await runtime.execute('owner', { op: 'step', goal: 'Continue' });
      expect(driver.perform).toHaveBeenCalledTimes(1); expect(fetch).toHaveBeenCalledTimes(1);
      expect(result.receipt).toMatchObject({ dispatch: 'completed', outcome: 'unknown' });
      expect(JSON.stringify(result)).not.toMatch(/fixture-secret|base64|frame|image\/png/);
      expect(frames.size).toBe(0);
      // The approved action used one slot despite multiple pending resumes.
      const last = await runtime.execute('owner', { op: 'observe' });
      expect((await runtime.execute('owner', { op: 'act', observationId: last.observation!.id, action: { kind: 'wait', durationMs: 0 } })).receipt?.dispatch).toBe('completed');
      expect(driver.perform).toHaveBeenCalledTimes(2);
      const exhausted = await runtime.execute('owner', { op: 'observe' });
      await expect(runtime.execute('owner', { op: 'act', observationId: exhausted.observation!.id, action: { kind: 'wait', durationMs: 0 } })).rejects.toThrow('COMPUTER_ACTION_BUDGET');
      expect(driver.perform).toHaveBeenCalledTimes(2);
      expect(broker.snapshot().status).toBe('stopped');
      expect(isComputerControlActive('owner')).toBe(false);
      config.computer.enabled = false;
      expect((await runtime.execute('owner', { op: 'close' })).status).toBe('stopped');
      expect((await runtime.execute('owner', { op: 'close' })).status).toBe('stopped');
      expect(isComputerControlActive('owner')).toBe(false);
    } finally { await runtime.shutdown(); await broker.dispose(); }
  });
  it.each(['act', 'step'] as const)('rejects %s once a direct action exhausts the budget', async op => {
    const config = { computer: ComputerConfigSchema.parse({ enabled: true, maxActionsPerSession: 1 }) };
    let actions = 0;
    let sessionId = '';
    const observation = () => ({ id: 'observation', sessionId, brokerEpoch: 'epoch', generation: 0,
      target: { appId: 'fixture', pid: 1, processIdentity: 'fixture', windowId: '1', width: 1, height: 1, geometryRevision: '1' },
      capturedAt: Date.now(), imageWidth: 1, imageHeight: 1, summary: 'fixture', stateDigest: 'fixed' });
    const invoke = vi.fn(async ({ arguments: args }: any) => {
      sessionId = args.sessionId;
      if (args.op === 'act') actions++;
      return { content: [{ type: 'json', value: { sessionId, brokerEpoch: 'epoch', generation: 0,
        status: args.op === 'release' ? 'stopped' : 'ready', grantId: 'grant',
        ...(args.op === 'observe' ? { observation: observation() } : {}) } }] };
    });
    const endpoint = { bindings: { get: () => undefined, resolve: () => ({ kind: 'desktop', endpointId: 'endpoint' }) },
      registry: { getTool: () => ({ revision: 'r1' }) }, invocations: { invoke } };
    const runtime = new ComputerRuntime(endpoint as any, () => config as any);
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    try {
      await runtime.execute('budget-owner', { op: 'open', appId: 'fixture' });
      await runtime.execute('budget-owner', { op: 'observe' });
      await runtime.execute('budget-owner', { op: 'act', observationId: 'observation', action: { kind: 'wait', durationMs: 0 } });
      await expect(runtime.execute('budget-owner', op === 'step' ? { op, goal: 'Another action' }
        : { op, observationId: 'observation', action: { kind: 'wait', durationMs: 0 } })).rejects.toThrow('COMPUTER_ACTION_BUDGET');
      expect(actions).toBe(1);
      expect(fetch).not.toHaveBeenCalled();
    } finally { await runtime.shutdown(); }
  });
});
