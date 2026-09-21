import { afterEach, describe, expect, it, vi } from 'vitest';
import { ComputerBroker, type ComputerApproval, type ComputerDriver } from '../broker.js';

const target = { appId: 'fixture', pid: 1, processIdentity: '1:100', windowId: '10', width: 800, height: 600, geometryRevision: '1' };
const opening = { op: 'open' as const, sessionId: 's', owner: 'o', appRef: 'fixture', mode: 'control' as const, prepare: false, model: { modelRef: 'ali/gui', profile: 'gui-plus-2026-02-26' as const, origin: 'https://example.com', runtimeLocation: 'local' as const } };
const brokers: ComputerBroker[] = [];
function fixture(autoApprove = false) {
  let settle: (approved: boolean) => void;
  let clock = 1000;
  let digest = 'a';
  let visible = true;
  const approvals: ComputerApproval[] = [];
  const driver: ComputerDriver = {
    discover: vi.fn(async () => [{ appId: 'fixture', name: 'Fixture', running: true }]),
    resolveTarget: vi.fn(async () => target),
    observe: vi.fn(async () => ({ target, summary: 'fixture', stateDigest: digest, focusedEditableRef: 'field', image: new Uint8Array([1]), mimeType: 'image/png', imageWidth: 800, imageHeight: 600 })),
    perform: vi.fn(async () => {}), stop: vi.fn(async () => {}),
  };
  const broker = new ComputerBroker(driver, { isVisible: () => visible, requestApproval: async (request) => {
    approvals.push(request);
    if (autoApprove) return true;
    return new Promise<boolean>((resolve) => { settle = resolve; });
  } }, { enabled: true }, () => clock);
  brokers.push(broker);
  let appRef: string;
  return { broker, driver, approvals, open: async (mode: 'observe' | 'control' = 'control') => {
    appRef ??= (await broker.command({ op: 'discover', sessionId: 'discovery', owner: 'o', query: 'Fixture' })).apps![0].appRef;
    const result = await broker.command({ ...opening, appRef, mode });
    if (!autoApprove) return result;
    await vi.waitFor(() => expect(broker.snapshot().status).toBe('ready'));
    return broker.command({ op: 'status', sessionId: 's', owner: 'o' });
  }, approve: async () => { settle!(true); await vi.waitFor(() => expect(driver.resolveTarget).toHaveBeenCalled()); },
    settle: (value: boolean) => settle!(value), move: () => { digest = 'b'; }, hide: () => { visible = false; }, advance: (ms: number) => { clock += ms; } };
}
async function ready(f: ReturnType<typeof fixture>) {
  await f.open(); await f.approve();
  return f.broker.command({ op: 'observe', sessionId: 's', owner: 'o' });
}
function envelope(observed: Awaited<ReturnType<typeof ready>>) {
  return { actionId: 'action1', sessionId: 's', observationId: observed.observation!.id, brokerEpoch: observed.brokerEpoch,
    generation: observed.generation, grantId: observed.grantId!, deadlineAt: 5000,
    action: { kind: 'click' as const, point: { x: 200, y: 100 }, button: 'left' as const, count: 1 as const } };
}
afterEach(async () => { await Promise.all(brokers.splice(0).map((b) => b.dispose())); });
describe('desktop computer authority', () => {
  it('binds discovery references to the requesting task and expires them', async () => {
    const f = fixture(true);
    const appRef = (await f.broker.command({ op: 'discover', owner: 'o', sessionId: 'd', query: 'Fixture' })).apps![0].appRef;
    await expect(f.broker.command({ ...opening, appRef, owner: 'other' })).rejects.toThrow('APP_REF_EXPIRED');
    f.advance(300_001);
    await expect(f.broker.command({ ...opening, appRef })).rejects.toThrow('APP_REF_EXPIRED');
    expect(f.driver.resolveTarget).not.toHaveBeenCalled();
  });
  it('enforces read-only in the host even after approval and with a forged action', async () => {
    const f = fixture(true); await f.open('observe');
    const obs = await f.broker.command({ op: 'observe', sessionId: 's', owner: 'o' });
    await expect(f.broker.command({ op: 'act', sessionId: 's', owner: 'o', envelope: envelope(obs) })).rejects.toThrow('READ_ONLY');
    expect(f.driver.perform).not.toHaveBeenCalled();
  });
  it('does not cancel another task when an unrelated invocation aborts', async () => {
    const f = fixture(true); await f.open();
    await f.broker.cancel({ op: 'discover', owner: 'other', sessionId: 'other', query: '' });
    expect(f.broker.snapshot().status).toBe('ready');
    await expect(f.broker.command({ op: 'discover', owner: 'other', sessionId: 'other', query: '' })).rejects.toThrow('BUSY');
    expect(f.broker.snapshot().status).toBe('ready');
  });
  it('stops idle discovery resources without granting a session', async () => {
    const f = fixture(); await f.broker.command({ op: 'discover', owner: 'o', sessionId: 'd', query: '' });
    expect(f.driver.stop).toHaveBeenCalledOnce();
    expect(f.approvals).toHaveLength(0); expect(f.broker.snapshot().status).toBe('idle');
  });
  it('never bypasses session or action approvals', async () => {
    const f = fixture(true);
    expect((await f.open()).status).toBe('ready');
    const obs = await f.broker.command({ op: 'observe', sessionId: 's', owner: 'o' });
    const command = { op: 'act' as const, sessionId: 's', owner: 'o', envelope: envelope(obs) };
    expect((await f.broker.command(command)).status).toBe('pending_action');
    await vi.waitFor(() => expect(f.approvals).toHaveLength(2));
    expect((await f.broker.command(command)).status).toBe('ready');
    expect(f.driver.perform).toHaveBeenCalledOnce();
    await f.broker.stop();
    await expect(f.broker.command({ op: 'observe', sessionId: 's', owner: 'o' })).rejects.toThrow('REVOKED');
  });
  it('retains visibility, ownership and stale-frame guards after approval', async () => {
    const f = fixture(true); await f.open();
    await expect(f.broker.command({ op: 'observe', sessionId: 's', owner: 'other' })).rejects.toThrow('NOT_FOUND');
    const obs = await f.broker.command({ op: 'observe', sessionId: 's', owner: 'o' });
    f.move();
    const command = { op: 'act' as const, sessionId: 's', owner: 'o', envelope: envelope(obs) };
    await f.broker.command(command); await Promise.resolve();
    expect(await f.broker.command(command)).toMatchObject({ status: 'ready', errorCode: 'COMPUTER_OBSERVATION_CHANGED' });
    expect(f.driver.perform).not.toHaveBeenCalled();
    f.hide();
    await expect(f.broker.command({ ...opening, sessionId: 'new' })).rejects.toThrow('LOCAL_UI_REQUIRED');
  });
  it('does not discover or capture a window before local consent', async () => {
    const f = fixture(); expect((await f.open()).status).toBe('pending_authorization');
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
    expect(await f.broker.command(command)).toMatchObject({ status: 'ready', errorCode: 'COMPUTER_OBSERVATION_CHANGED' }); expect(f.driver.perform).not.toHaveBeenCalled();
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
  it('preserves completed dispatch when only the post-action observation fails', async () => {
    const f = fixture(true); await f.open();
    const obs = await f.broker.command({ op: 'observe', sessionId: 's', owner: 'o' });
    vi.mocked(f.driver.perform).mockImplementation(async () => {
      vi.mocked(f.driver.observe).mockRejectedValue(new Error('capture disconnected'));
    });
    const command = { op: 'act' as const, sessionId: 's', owner: 'o', envelope: envelope(obs) };
    await f.broker.command(command); await Promise.resolve();
    const result = await f.broker.command(command);
    expect(result).toMatchObject({ status: 'stopped', errorCode: 'COMPUTER_POST_ACTION_OBSERVATION_FAILED',
      receipt: { dispatch: 'completed', outcome: 'unknown', verification: 'none' } });
    expect(f.driver.perform).toHaveBeenCalledTimes(1);
  });
});
