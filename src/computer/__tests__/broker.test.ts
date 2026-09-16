import { afterEach, describe, expect, it, vi } from 'vitest';
import { ComputerBroker, type ComputerApproval, type ComputerDriver } from '../broker.js';

const target = { appId: 'fixture', pid: 1, processIdentity: '1:100', windowId: '10', width: 800, height: 600, geometryRevision: '1' };
const opening = { op: 'open' as const, sessionId: 's', owner: 'o', appId: 'fixture', model: { modelRef: 'ali/gui', profile: 'gui-plus-2026-02-26' as const, origin: 'https://example.com', runtimeLocation: 'local' as const } };
const brokers: ComputerBroker[] = [];
function fixture(fullControl = false) {
  let settle: (approved: boolean) => void;
  let clock = 1000;
  let digest = 'a';
  let visible = true;
  const approvals: ComputerApproval[] = [];
  const driver: ComputerDriver = {
    resolveTarget: vi.fn(async () => target),
    observe: vi.fn(async () => ({ target, summary: 'fixture', stateDigest: digest, focusedEditableRef: 'field', image: new Uint8Array([1]), mimeType: 'image/png', imageWidth: 800, imageHeight: 600 })),
    perform: vi.fn(async () => {}), stop: vi.fn(async () => {}),
  };
  const broker = new ComputerBroker(driver, { isVisible: () => visible, hasFullControl: () => fullControl, requestApproval: async (request) => {
    approvals.push(request); return new Promise<boolean>((resolve) => { settle = resolve; });
  } }, { enabled: true }, () => clock);
  brokers.push(broker);
  return { broker, driver, approvals, approve: async () => { settle!(true); await vi.waitFor(() => expect(driver.resolveTarget).toHaveBeenCalled()); },
    settle: (value: boolean) => settle!(value), move: () => { digest = 'b'; }, hide: () => { visible = false; }, advance: (ms: number) => { clock += ms; } };
}
async function ready(f: ReturnType<typeof fixture>) {
  await f.broker.command(opening); await f.approve();
  return f.broker.command({ op: 'observe', sessionId: 's', owner: 'o' });
}
function envelope(observed: Awaited<ReturnType<typeof ready>>) {
  return { actionId: 'action1', sessionId: 's', observationId: observed.observation!.id, brokerEpoch: observed.brokerEpoch,
    generation: observed.generation, grantId: observed.grantId!, deadlineAt: 5000,
    action: { kind: 'click' as const, point: { x: 200, y: 100 }, button: 'left' as const, count: 1 as const } };
}
afterEach(async () => { await Promise.all(brokers.splice(0).map((b) => b.dispose())); });
describe('desktop computer authority', () => {
  it('runs full-control sessions and actions without prompts or pending results', async () => {
    const f = fixture(true);
    expect((await f.broker.command(opening)).status).toBe('ready');
    const obs = await f.broker.command({ op: 'observe', sessionId: 's', owner: 'o' });
    const result = await f.broker.command({ op: 'act', sessionId: 's', owner: 'o', envelope: envelope(obs) });
    expect(result.status).toBe('ready');
    expect(f.driver.perform).toHaveBeenCalledOnce();
    expect(f.approvals).toHaveLength(0);
    await f.broker.stop();
    await expect(f.broker.command({ op: 'observe', sessionId: 's', owner: 'o' })).rejects.toThrow('REVOKED');
  });
  it('retains visibility, ownership and stale-frame guards in full control', async () => {
    const f = fixture(true); await f.broker.command(opening);
    await expect(f.broker.command({ op: 'observe', sessionId: 's', owner: 'other' })).rejects.toThrow('NOT_FOUND');
    const obs = await f.broker.command({ op: 'observe', sessionId: 's', owner: 'o' });
    f.move();
    await expect(f.broker.command({ op: 'act', sessionId: 's', owner: 'o', envelope: envelope(obs) })).rejects.toThrow('TARGET_CHANGED');
    expect(f.driver.perform).not.toHaveBeenCalled();
    f.hide();
    await expect(f.broker.command({ ...opening, sessionId: 'new' })).rejects.toThrow('LOCAL_UI_REQUIRED');
  });
  it('does not discover or capture a window before local consent', async () => {
    const f = fixture(); expect((await f.broker.command(opening)).status).toBe('pending_authorization');
    expect(f.driver.resolveTarget).not.toHaveBeenCalled(); expect(f.driver.observe).not.toHaveBeenCalled();
    await expect(f.broker.command({ op: 'observe', sessionId: 's', owner: 'o' })).rejects.toThrow('NOT_READY');
  });
  it('binds ownership and enforces one device lease', async () => {
    const f = fixture(); await ready(f);
    await expect(f.broker.command({ ...opening, sessionId: 'another' })).rejects.toThrow('DEVICE_BUSY');
    await expect(f.broker.command({ op: 'observe', sessionId: 's', owner: 'attacker' })).rejects.toThrow('NOT_FOUND');
  });
  it('requires action consent, executes once and never calls ACK verified success', async () => {
    const f = fixture(); const obs = await ready(f);
    const command = { op: 'act' as const, sessionId: 's', owner: 'o', envelope: envelope(obs) };
    expect((await f.broker.command(command)).status).toBe('pending_action');
    expect(f.driver.perform).not.toHaveBeenCalled(); f.settle(true); await Promise.resolve(); await Promise.resolve();
    const result = await f.broker.command(command);
    expect(result.receipt).toMatchObject({ dispatch: 'completed', outcome: 'unknown' });
    await f.broker.command(command); expect(f.driver.perform).toHaveBeenCalledTimes(1);
  });
  it('rejects target changes after approval', async () => {
    const f = fixture(); const obs = await ready(f); const command = { op: 'act' as const, sessionId: 's', owner: 'o', envelope: envelope(obs) };
    await f.broker.command(command); f.settle(true); await Promise.resolve(); await Promise.resolve(); f.move();
    await expect(f.broker.command(command)).rejects.toThrow('TARGET_CHANGED'); expect(f.driver.perform).not.toHaveBeenCalled();
  });
  it('revokes a pending decision synchronously on stop', async () => {
    const f = fixture(); const obs = await ready(f); const command = { op: 'act' as const, sessionId: 's', owner: 'o', envelope: envelope(obs) };
    await f.broker.command(command); const stopped = f.broker.stop(); f.settle(true); await stopped;
    await expect(f.broker.command(command)).rejects.toThrow('REVOKED'); expect(f.driver.perform).not.toHaveBeenCalled();
  });
  it('expires grants and rejects hidden UI before any native input', async () => {
    const f = fixture(); await ready(f); f.advance(300_001);
    await expect(f.broker.command({ op: 'observe', sessionId: 's', owner: 'o' })).rejects.toThrow('REVOKED');
  });
  it('does not retry a native action whose outcome is unknown', async () => {
    const f = fixture(); const obs = await ready(f); vi.mocked(f.driver.perform).mockRejectedValue(new Error('disconnected'));
    const command = { op: 'act' as const, sessionId: 's', owner: 'o', envelope: envelope(obs) };
    await f.broker.command(command); f.settle(true); await Promise.resolve(); await Promise.resolve();
    expect((await f.broker.command(command)).receipt?.dispatch).toBe('unknown');
    await expect(f.broker.command(command)).rejects.toThrow('REVOKED'); expect(f.driver.perform).toHaveBeenCalledTimes(1);
  });
});
