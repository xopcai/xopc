import { afterEach, describe, expect, it, vi } from 'vitest';
import { computerDiagnostic } from '../errors.js';
import { ComputerBroker, type ComputerApproval, type ComputerDriver } from '../broker.js';

const target = { appId: 'fixture', pid: 1, processIdentity: '1:100', windowId: '10', width: 800, height: 600, geometryRevision: '1' };
const opening = { op: 'open' as const, sessionId: 's', owner: 'o', appRef: 'fixture', mode: 'control' as const, prepare: false, model: { modelRef: 'ali/gui', profile: 'gui-plus-2026-02-26' as const, origin: 'https://example.com', runtimeLocation: 'local' as const } };
const brokers: ComputerBroker[] = [];
it('binds preview authority to the active session without taking a model observation', async () => {
  const f = fixture(true, false); await f.open();
  const authority = f.broker.previewAuthority()!;
  expect(authority).toMatchObject({ conversationId: 'o', computerSessionId: 's', target });
  f.driver.validatePreviewTarget = vi.fn(async () => {});
  await f.broker.validatePreview(authority);
  expect(f.driver.observe).not.toHaveBeenCalled();
  await f.broker.stop();
  expect(authority.signal.aborted).toBe(true);
  expect(f.broker.previewAuthority()).toBeUndefined();
  await expect(f.broker.validatePreview(authority)).rejects.toThrow('COMPUTER_PREVIEW_REVOKED');
});
function fixture(autoApprove = false, deferApproval = true) {
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
  const broker = new ComputerBroker(driver, { deferApproval, isVisible: () => visible, requestApproval: async (request) => {
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
  it('completes inline authorization and input in one command without pending-action polling', async () => {
    const f = fixture(true, false);
    await f.open();
    const observed = await f.broker.command({ op: 'observe', sessionId: 's', owner: 'o' });
    const result = await f.broker.command({ op: 'act', sessionId: 's', owner: 'o', envelope: envelope(observed) });
    expect(result).toMatchObject({ status: 'ready', receipt: { dispatch: 'completed' } });
    expect(f.driver.perform).toHaveBeenCalledOnce();
    expect(f.approvals).toHaveLength(2);
  });
  it('settles a deferred decision on its promise without dispatching input', async () => {
    const f = fixture(); const observed = await ready(f);
    await f.broker.command({ op: 'act', sessionId: 's', owner: 'o', envelope: envelope(observed) });
    const settled = f.broker.command({ op: 'settle', sessionId: 's', owner: 'o' });
    f.settle(true);
    expect(await settled).toMatchObject({ status: 'pending_action' });
    expect(f.driver.perform).not.toHaveBeenCalled();
    expect((await f.broker.command({ op: 'act', sessionId: 's', owner: 'o', envelope: envelope(observed) })).receipt?.dispatch).toBe('completed');
  });
  it('releases a pending decision wait immediately on stop', async () => {
    const f = fixture(); await f.open();
    const settled = f.broker.command({ op: 'settle', sessionId: 's', owner: 'o' });
    await f.broker.stop();
    expect(await settled).toMatchObject({ status: 'stopped' });
    expect(f.driver.perform).not.toHaveBeenCalled();
  });
  it('keeps a precise capture failure and completed receipt without replaying input', async () => {
    const f = fixture(true); await f.open();
    const observed = await f.broker.command({ op: 'observe', sessionId: 's', owner: 'o' });
    vi.mocked(f.driver.perform).mockImplementation(async () => {
      vi.mocked(f.driver.observe).mockRejectedValue(new Error('COMPUTER_CAPTURE_UNAVAILABLE'));
    });
    const command = { op: 'act' as const, sessionId: 's', owner: 'o', envelope: envelope(observed) };
    await f.broker.command(command); await Promise.resolve();
    expect(await f.broker.command(command)).toMatchObject({ status: 'stopped', errorCode: 'COMPUTER_CAPTURE_UNAVAILABLE', receipt: { dispatch: 'completed' } });
    expect(f.broker.snapshot()).toMatchObject({ errorCode: 'COMPUTER_CAPTURE_UNAVAILABLE', dispatch: 'completed' });
    await expect(f.broker.command(command)).rejects.toThrow('REVOKED');
    expect(f.driver.perform).toHaveBeenCalledOnce();
  });

  it('reports hidden local UI distinctly before sending input', async () => {
    const f = fixture(true); await f.open(); f.hide();
    await expect(f.broker.command({ op: 'observe', sessionId: 's', owner: 'o' })).rejects.toThrow('LOCAL_UI_REQUIRED');
    expect(f.broker.snapshot()).toMatchObject({ errorCode: 'COMPUTER_LOCAL_UI_REQUIRED', dispatch: 'notStarted' });
    expect(f.driver.perform).not.toHaveBeenCalled();
  });
  it('revokes the old grant immediately when a native observation fails', async () => {
    const f = fixture(true); await f.open();
    const observed = await f.broker.command({ op: 'observe', sessionId: 's', owner: 'o' });
    vi.mocked(f.driver.observe).mockRejectedValueOnce(new Error('driver pipe disconnected'));
    await expect(f.broker.command({ op: 'observe', sessionId: 's', owner: 'o' })).rejects.toThrow('pipe disconnected');
    expect(f.broker.snapshot().status).toBe('stopped');
    await expect(f.broker.command({ op: 'act', sessionId: 's', owner: 'o', envelope: envelope(observed) })).rejects.toThrow('REVOKED');
    expect(f.driver.perform).not.toHaveBeenCalled();
  });
  it('revokes a grant when the driver dies during the fresh input precheck', async () => {
    const f = fixture(true); await f.open();
    const observed = await f.broker.command({ op: 'observe', sessionId: 's', owner: 'o' });
    const command = { op: 'act' as const, sessionId: 's', owner: 'o', envelope: envelope(observed) };
    await f.broker.command(command); await Promise.resolve();
    vi.mocked(f.driver.observe).mockRejectedValueOnce(new Error('driver crashed'));
    await expect(f.broker.command(command)).rejects.toThrow('driver crashed');
    expect(f.broker.snapshot().status).toBe('stopped'); expect(f.driver.perform).not.toHaveBeenCalled();
  });
  it.each(['activate', 'showMenu'] as const)('keeps %s inside consent, freshness and execution receipt boundaries', async kind => {
    const f = fixture(); const obs = await ready(f);
    const command = { op: 'act' as const, owner: 'o', sessionId: 's', envelope: {
      ...envelope(obs), action: { kind, ref: 'e1' },
    } };
    expect((await f.broker.command(command)).status).toBe('pending_action');
    expect(f.driver.perform).not.toHaveBeenCalled();
    expect(f.approvals.at(-1)).toMatchObject({ kind: 'action', action: { kind, ref: 'e1' } });
    f.settle(true); await Promise.resolve(); await Promise.resolve();
    expect((await f.broker.command(command)).receipt).toMatchObject({ dispatch: 'completed', outcome: 'unknown', verification: 'visual' });
    expect(f.driver.perform).toHaveBeenCalledWith(target, { kind, ref: 'e1' }, expect.any(AbortSignal));
    await f.broker.command(command);
    expect(f.driver.perform).toHaveBeenCalledOnce();
  });
  it('measures fresh precheck, acknowledged input and post-action capture separately', async () => {
    const f = fixture(true); await f.open();
    const obs = await f.broker.command({ op: 'observe', sessionId: 's', owner: 'o' });
    const original = vi.mocked(f.driver.observe).getMockImplementation()!;
    vi.mocked(f.driver.observe).mockImplementation(async (...args) => { f.advance(11); return original(...args); });
    vi.mocked(f.driver.perform).mockImplementation(async () => { f.advance(23); });
    const command = { op: 'act' as const, owner: 'o', sessionId: 's', envelope: envelope(obs) };
    expect((await f.broker.command(command)).status).toBe('pending_action');
    await Promise.resolve();
    expect(await f.broker.command(command)).toMatchObject({
      receipt: { dispatch: 'completed' }, nativeMs: { precheckMs: 11, inputMs: 23, postObserveMs: 11 },
    });
    expect(f.driver.observe).toHaveBeenCalledTimes(3);
  });
  it.each(['activate', 'showMenu'] as const)('refuses %s in read-only sessions and after a window change', async kind => {
    const f = fixture(true); await f.open('observe');
    const obs = await f.broker.command({ op: 'observe', owner: 'o', sessionId: 's' });
    const command = { op: 'act' as const, owner: 'o', sessionId: 's', envelope: {
      ...envelope(obs), action: { kind, ref: 'e1' },
    } };
    await expect(f.broker.command(command)).rejects.toThrow('READ_ONLY');
    expect(f.driver.perform).not.toHaveBeenCalled();
    const control = fixture(true); await control.open();
    const fresh = await control.broker.command({ op: 'observe', owner: 'o', sessionId: 's' });
    const changed = { ...command, envelope: { ...envelope(fresh), action: { kind, ref: 'e1' } } };
    await control.broker.command(changed); await Promise.resolve(); control.move();
    expect(await control.broker.command(changed)).toMatchObject({ errorCode: 'COMPUTER_OBSERVATION_CHANGED' });
    expect(control.driver.perform).not.toHaveBeenCalled();
  });
  it('resamples a transient pixel change but still requires the exact original state before one dispatch', async () => {
    const f = fixture(true); await f.open();
    const obs = await f.broker.command({ op: 'observe', owner: 'o', sessionId: 's' });
    const original = vi.mocked(f.driver.observe).getMockImplementation()!;
    const checks: Uint8Array[] = []; let reads = 0;
    vi.mocked(f.driver.observe).mockImplementation(async (...args) => {
      const frame = await original(...args);
      if (++reads <= 2) checks.push(frame.image);
      return { ...frame, stateDigest: reads === 1 ? 'caret-blink' : 'a' };
    });
    const command = { op: 'act' as const, owner: 'o', sessionId: 's', envelope: envelope(obs) };
    await f.broker.command(command); await Promise.resolve();
    expect(await f.broker.command(command)).toMatchObject({ receipt: { dispatch: 'completed' } });
    expect(f.driver.perform).toHaveBeenCalledTimes(1);
    expect(checks).toHaveLength(2);
    expect(checks.every(image => image.every(byte => byte === 0))).toBe(true);
  });
  it('bounds pre-dispatch resampling and never accepts a persistent state change', async () => {
    const f = fixture(true); await f.open();
    const obs = await f.broker.command({ op: 'observe', owner: 'o', sessionId: 's' });
    const command = { op: 'act' as const, owner: 'o', sessionId: 's', envelope: envelope(obs) };
    await f.broker.command(command); await Promise.resolve(); f.move();
    expect(await f.broker.command(command)).toMatchObject({ errorCode: 'COMPUTER_OBSERVATION_CHANGED' });
    expect(f.driver.observe).toHaveBeenCalledTimes(5);
    expect(f.driver.perform).not.toHaveBeenCalled();
  });
  it.each([true, false])('requires bounded stable native-editor observations (settles=%s)', async settles => {
    const f = fixture(true); await f.open();
    const original = vi.mocked(f.driver.observe).getMockImplementation()!;
    const images: Uint8Array[] = []; let reads = 0;
    vi.mocked(f.driver.observe).mockImplementation(async (...args) => {
      const frame = await original(...args); images.push(frame.image);
      reads++;
      return { ...frame, summary: JSON.stringify({ elements: [{ role: 'AXWindow' }, { role: 'AXTextArea', value: 'test' }] }),
        stateDigest: settles && reads > 1 ? 'steady' : 'fade-' + reads };
    });
    const capture = f.broker.command({ op: 'observe', owner: 'o', sessionId: 's' });
    if (settles) {
      expect(await capture).toMatchObject({ observation: { stateDigest: 'steady' } });
      expect(images.slice(0, -1).every(image => image.every(byte => byte === 0))).toBe(true);
    } else {
      const error = await capture.catch(error => error);
      expect(computerDiagnostic(error)).toMatchObject({ errorCode: 'COMPUTER_UI_UNSTABLE', stability: {
        stage: 'initial_capture', samples: 6, changes: ['visual_or_unexposed_state'], changedElementIndices: [],
      } });
      expect(f.driver.observe).toHaveBeenCalledTimes(6);
      expect(images.every(image => image.every(byte => byte === 0))).toBe(true);
    }
    expect(f.driver.perform).not.toHaveBeenCalled();
  });
  it('allows a time-based editor transition to settle between bounded samples', async () => {
    const f = fixture(true); await f.open();
    const original = vi.mocked(f.driver.observe).getMockImplementation()!;
    const startedAt = Date.now(); let reads = 0;
    vi.mocked(f.driver.observe).mockImplementation(async (...args) => ({ ...await original(...args),
      summary: JSON.stringify({ elements: [{ role: 'AXTextArea' }] }),
      stateDigest: Date.now() - startedAt >= 150 ? 'settled' : `transition-${++reads}`,
    }));
    const result = await f.broker.command({ op: 'observe', owner: 'o', sessionId: 's' });
    expect(result.observation?.stateDigest).toBe('settled');
    expect(f.driver.observe.mock.calls.length).toBeLessThanOrEqual(6);
    expect(f.driver.perform).not.toHaveBeenCalled();
  });
  it('refuses a target change during native-editor stable capture and clears both frames', async () => {
    const f = fixture(true); await f.open();
    const original = vi.mocked(f.driver.observe).getMockImplementation()!;
    const images: Uint8Array[] = [];
    vi.mocked(f.driver.observe).mockImplementation(async (...args) => {
      const frame = await original(...args); images.push(frame.image);
      return { ...frame, target: images.length === 1 ? target : { ...target, windowId: 'other' },
        summary: JSON.stringify({ elements: [{ role: 'AXWindow' }, { role: 'AXTextArea', value: 'test' }] }) };
    });
    await expect(f.broker.command({ op: 'observe', owner: 'o', sessionId: 's' })).rejects.toThrow('COMPUTER_TARGET_CHANGED');
    expect(f.driver.observe).toHaveBeenCalledTimes(2);
    expect(f.driver.perform).not.toHaveBeenCalled();
    expect(images.every(image => image.every(byte => byte === 0))).toBe(true);
  });
  it('recognizes a recurring caret phase while preserving an exact fresh dispatch check', async () => {
    const f = fixture(true); await f.open();
    const original = vi.mocked(f.driver.observe).getMockImplementation()!;
    const images: Uint8Array[] = []; let reads = 0;
    vi.mocked(f.driver.observe).mockImplementation(async (...args) => {
      const frame = await original(...args); images.push(frame.image);
      return { ...frame, summary: JSON.stringify({ elements: [{ role: 'AXWindow' }, { role: 'AXTextArea' }] }),
        stateDigest: ++reads % 2 ? 'caret-on' : 'caret-off' };
    });
    const observed = await f.broker.command({ op: 'observe', owner: 'o', sessionId: 's' });
    expect(observed.observation?.stateDigest).toBe('caret-on');
    expect(images).toHaveLength(3);
    expect(images.slice(0, -1).every(image => image.every(byte => byte === 0))).toBe(true);
    vi.mocked(f.driver.observe).mockImplementation(async (...args) => ({ ...await original(...args), stateDigest: 'changed-after-prediction' }));
    const command = { op: 'act' as const, owner: 'o', sessionId: 's', envelope: envelope(observed) };
    await f.broker.command(command); await Promise.resolve();
    expect(await f.broker.command(command)).toMatchObject({ errorCode: 'COMPUTER_OBSERVATION_CHANGED' });
    expect(f.driver.perform).not.toHaveBeenCalled();
  });
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
  it('rejects either drag endpoint outside the authorized window', async () => {
    const f = fixture(true); await f.open();
    const obs = await f.broker.command({ op: 'observe', sessionId: 's', owner: 'o' });
    const command = { op: 'act' as const, sessionId: 's', owner: 'o', envelope: { ...envelope(obs), action: {
      kind: 'drag' as const, from: { x: 10, y: 10 }, to: { x: 800, y: 20 },
    } } };
    await expect(f.broker.command(command)).rejects.toThrow('COORDINATE_OUTSIDE_WINDOW');
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

it('retains only a quiescent transport on normal release; explicit stop still terminates it', async () => {
  const f = fixture(true, false); f.driver.idle = vi.fn(async () => {});
  await f.open();
  vi.mocked(f.driver.idle).mockClear();
  await f.broker.command({ op: 'release', sessionId: 's', owner: 'o' });
  expect(f.driver.idle).toHaveBeenCalledOnce();
  expect(f.broker.previewAuthority()).toBeUndefined();
  await f.broker.stop(); expect(f.driver.stop).toHaveBeenCalled();
});

it('terminates the driver instead of retaining it when release races an input', async () => {
  const f = fixture(true, false); f.driver.idle = vi.fn(async () => {});
  await f.open(); vi.mocked(f.driver.idle).mockClear();
  const observed = await f.broker.command({ op: 'observe', sessionId: 's', owner: 'o' });
  let entered!: () => void; let finish!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; });
  vi.mocked(f.driver.perform).mockImplementation(() => new Promise<void>(resolve => { finish = resolve; entered(); }));
  const action = f.broker.command({ op: 'act', sessionId: 's', owner: 'o', envelope: envelope(observed) }).catch(() => undefined);
  await started;
  await f.broker.command({ op: 'release', sessionId: 's', owner: 'o' });
  expect(f.driver.idle).not.toHaveBeenCalled(); expect(f.driver.stop).toHaveBeenCalled();
  finish(); await action;
});

it('switches applications only for the bound active conversation', async () => {
  const f = fixture(true, false); f.driver.focusTarget = vi.fn(async () => {});
  await f.open();
  await expect(f.broker.focusConversation('another')).rejects.toThrow('COMPUTER_PREVIEW_REVOKED');
  expect(f.driver.focusTarget).not.toHaveBeenCalled();
  await f.broker.focusConversation('o');
  expect(f.driver.focusTarget).toHaveBeenCalledExactlyOnceWith(target, expect.any(AbortSignal));
  await f.broker.stop();
  await expect(f.broker.focusConversation('o')).rejects.toThrow('COMPUTER_PREVIEW_REVOKED');
});
it('exposes only action kind and phase while input is in flight, then observes the result', async () => {
  const f = fixture(true, false); await f.open();
  const observed = await f.broker.command({ op: 'observe', sessionId: 's', owner: 'o' });
  let finish!: () => void;
  vi.mocked(f.driver.perform).mockImplementation(() => new Promise<void>(resolve => { finish = resolve; }));
  const command = { op: 'act' as const, sessionId: 's', owner: 'o', envelope: {
    ...envelope(observed), action: { kind: 'typeText' as const, point: { x: 20, y: 20 }, text: 'private typed content' },
  } };
  const pending = f.broker.command(command);
  await vi.waitFor(() => expect(f.broker.previewAuthority()?.activity).toEqual({ phase: 'acting', action: 'typeText' }));
  expect(JSON.stringify(f.broker.previewAuthority()?.activity)).not.toContain('private');
  finish(); await pending;
  expect(f.broker.previewAuthority()?.activity).toEqual({ phase: 'ready', action: 'typeText' });
});
