import { randomUUID } from 'node:crypto';
import { REMOTE_COMPUTER_CONTROL_TOOL } from '@xopcai/computer-control-contract';

import { expect, it, vi } from 'vitest';

import { hasVerifiedDesktopExecutionStop } from '../../storage/sqlite/desktop-execution-stop-repository.js';
import { bindComputerAgentTurn, endComputerAgentTurn } from '../agent-context.js';
import { ComputerBroker } from '../broker.js';
import { ComputerConfigSchema } from '../config.js';
import { isComputerControlActive } from '../control-guard.js';
import { invokeComputerCommand } from '../endpoint-transport.js';
import { ComputerRuntime } from '../runtime.js';

vi.mock('../../storage/sqlite/desktop-execution-stop-repository.js', () => ({ hasVerifiedDesktopExecutionStop: vi.fn(() => false) }));
vi.mock('../../storage/sqlite/desktop-operation-repository.js', () => ({ hasReviewedDesktopExecutionStop: () => false }));
vi.mock('../../config/agent-profile.js', () => ({ resolveEffectiveAgentConfigForSession: () => ({ config: { id: 'main', workspace: '/tmp/xopc-stop-fixture', models: {} } }) }));
vi.mock('../endpoint-transport.js', () => ({ invokeComputerCommand: vi.fn() }));

it('retains offline Computer admission until independent stop proof, then clears only metadata without sending another old command', async () => {
  const owner = 'stop-fixture-owner', runId = 'stop-fixture-run';
  const target = { appId: 'fixture', pid: 1, processIdentity: 'fixture:1', windowId: '1', width: 800, height: 600, geometryRevision: '1' };
  const driver = { discover: async () => [{ appId: 'fixture', name: 'Fixture', running: true }], resolveTarget: vi.fn(async () => target), observe: vi.fn(), perform: vi.fn(), stop: vi.fn(async () => {}) };
  const makeBroker = () => new ComputerBroker(driver, { deferApproval: false, isVisible: () => true, requestApproval: async () => true }, { enabled: true });
  let broker = makeBroker(), online = true;
  const endpoint = { endpointId: randomUUID(), principalId: randomUUID(), kind: 'desktop', availability: 'foreground', tools: [{ descriptor: { name: REMOTE_COMPUTER_CONTROL_TOOL }, revision: 'r1' }],
    executionAuthority: { gatewayId: randomUUID(), deviceId: '', grantId: randomUUID(), authorizationRevision: 1, expiresAt: Date.now() + 120000 } };
  endpoint.executionAuthority.deviceId = endpoint.principalId;
  const endpoints = { bindings: { get: () => undefined, resolve: () => undefined },
    registry: { get: (id: string) => online && id === endpoint.endpointId ? endpoint : undefined, getTool: () => ({ revision: 'r1' }) } };
  vi.mocked(invokeComputerCommand).mockImplementation(async (_runtime, _id, command) => {
    if (!online) throw new Error('COMPUTER_REMOTE_AUTHORITY_INVALID');
    let reply = await broker.command(command);
    if (reply.status === 'pending_authorization') {
      await vi.waitFor(() => expect(broker.snapshot().status).toBe('ready'));
      reply = await broker.command({ op: 'status', owner: command.owner, sessionId: command.sessionId });
    }
    const { frame: _frame, ...value } = reply;
    return { content: [{ type: 'json', value }] } as never;
  });
  const config = { computer: ComputerConfigSchema.parse({ enabled: true }) };
  const runtime = new ComputerRuntime(endpoints as never, () => config as never, () => endpoint.endpointId);
  bindComputerAgentTurn(owner, runId, { id: 'fixture-vision', provider: 'fixture', baseUrl: 'https://model.invalid/v1', input: ['image'] } as never);
  try {
    const discovered = await runtime.execute(owner, { op: 'discover', query: 'Fixture' });
    expect(await runtime.execute(owner, { op: 'open', appRef: discovered.apps![0]!.appRef, mode: 'control', prepare: false, planner: 'agent' })).toMatchObject({ status: 'ready' });
    expect(isComputerControlActive(owner)).toBe(true);
    online = false;
    expect(await runtime.close(owner)).toBe(false); expect(isComputerControlActive(owner)).toBe(true);
    await broker.dispose();
    vi.mocked(hasVerifiedDesktopExecutionStop).mockImplementation(scope => scope.gatewayId === endpoint.executionAuthority.gatewayId
      && scope.deviceId === endpoint.principalId && scope.authorizationRevision === 1 && scope.toolRevision === 'r1');
    const before = vi.mocked(invokeComputerCommand).mock.calls.length;
    expect(await runtime.execute(owner, { op: 'close' })).toMatchObject({ status: 'stopped' });
    expect(invokeComputerCommand).toHaveBeenCalledTimes(before); expect(isComputerControlActive(owner)).toBe(false);
    endpoint.endpointId = randomUUID(); endpoint.executionAuthority.authorizationRevision = 2; endpoint.executionAuthority.grantId = randomUUID();
    broker = makeBroker(); online = true;
    const next = await runtime.execute(owner, { op: 'discover', query: 'Fixture' });
    expect(await runtime.execute(owner, { op: 'open', appRef: next.apps![0]!.appRef, mode: 'control', prepare: false, planner: 'agent' })).toMatchObject({ status: 'ready' });
    expect(isComputerControlActive(owner)).toBe(true); expect(await runtime.close(owner)).toBe(true);
  } finally { await runtime.shutdown(); await broker.dispose(); await endComputerAgentTurn(owner, runId); }
});
