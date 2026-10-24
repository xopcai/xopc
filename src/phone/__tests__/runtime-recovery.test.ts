import { randomUUID } from 'node:crypto';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ConfigSchema } from '../../config/schema.js';
import { closeXopcDatabase, openXopcDatabase } from '../../storage/sqlite/connection.js';
import type { PhoneDriver } from '../adb-driver.js';
import { PhoneError, type PhoneElement, type PhoneObservation, type PhoneReport } from '../contracts.js';
import type { PhoneModelAdapter } from '../model-adapter.js';
import { PhoneRepository } from '../repository.js';
import { PhoneRuntime } from '../runtime.js';

const runtimes: PhoneRuntime[] = [];
const owner = 'native-recovery';
const app = 'com.example.editor';
const completion = { appPackage: app, field: { resourceId: 'editor:id/query', value: 'query' } };

beforeEach(() => { closeXopcDatabase(); openXopcDatabase({ path: ':memory:' }); });
afterEach(async () => { await Promise.all(runtimes.splice(0).map(runtime => runtime.shutdown())); closeXopcDatabase(); });

function element(text: string, overrides: Partial<PhoneElement> = {}): PhoneElement {
  return { text, description: '', resourceId: `editor:id/${text}`, bounds: [100, 200, 300, 400],
    clickable: true, focused: false, editable: false, password: false, ...overrides };
}
function observation(elements: PhoneElement[]): PhoneObservation {
  return { frameId: randomUUID(), capturedAt: Date.now(), package: app, width: 1000, height: 1000, rotation: 0,
    elements, frame: Buffer.from('test-pixels') };
}
function field(value = 'old', focused = false): PhoneElement {
  return element(value, { resourceId: completion.field.resourceId, editable: true, focused });
}
function fixture(predict: PhoneModelAdapter['predict'], options: { modelRequests?: number } = {}) {
  const repository = new PhoneRepository();
  const device = repository.save({ serial: 'native-recovery-editor', name: 'Native recovery editor', enabled: true, allowedApps: [app] });
  repository.setDefault(device.id);
  let current = observation([element('Home')]);
  const read = () => ({ ...current, frameId: randomUUID(), frame: Buffer.from(current.frame), elements: structuredClone(current.elements) });
  const driver: PhoneDriver = { discover: async () => [{ serial: device.serial, name: device.name, state: 'device', emulator: true }],
    observe: vi.fn(async () => read()), execute: vi.fn(async () => {}) };
  const runtime = new PhoneRuntime(repository, () => driver, async () => ({ predict }));
  runtimes.push(runtime);
  const context = { config: ConfigSchema.parse({ phone: { enabled: true, hierarchicalPlanning: true,
    maxModelRequests: options.modelRequests ?? 8 } }), agentId: 'main', modelRef: 'test/native-recovery' };
  return { runtime, driver, context, read, set: (elements: PhoneElement[]) => { current = observation(elements); },
    open: () => runtime.execute(owner, { op: 'open', mode: 'control' }, context),
    run: (extra = {}) => runtime.execute(owner, { op: 'run', goal: 'Search query', completion, ...extra }, context) as Promise<PhoneReport> };
}

describe('phone native recovery runtime', () => {
  it('replans entry Back without dispatching it, then completes an allowed forward route', async () => {
    const predict = vi.fn<PhoneModelAdapter['predict']>(async input => input.recoveryHint
      ? { kind: 'action', action: { type: 'tap', point: [200, 300] } } : { kind: 'action', action: { type: 'back' } });
    const f = fixture(predict);
    vi.mocked(f.driver.execute).mockImplementation(async () => { f.set([element('Done')]); });
    await f.open();
    const result = await f.run({ goal: 'Open Done', completion: { textAll: ['Done'] } });
    expect(result).toMatchObject({ verified: true, actions: 1, modelRequests: 2, diagnostics: { backReplans: 1 } });
    expect(vi.mocked(f.driver.execute).mock.calls.map(call => call[1].type)).toEqual(['tap']);
    expect(predict.mock.calls[1][0].recoveryHint).toContain('Back was not dispatched');
  });

  it('bounds repeated rejected Back decisions without injecting any Back', async () => {
    const f = fixture(async () => ({ kind: 'action', action: { type: 'back' } }));
    await f.open();
    const result = await f.run();
    expect(result).toMatchObject({ status: 'paused', stopReason: 'back_boundary', actions: 0, modelRequests: 3,
      diagnostics: { backReplans: 3 } });
    expect(f.driver.execute).not.toHaveBeenCalled();
  });

  it('keeps an incomplete destination open and permits scrolling to reveal its required evidence', async () => {
    const predict = vi.fn<PhoneModelAdapter['predict']>(async input => input.recoveryHint
      ? { kind: 'action', action: { type: 'swipe', start: [500, 800], end: [500, 300], durationMs: 500 } }
      : { kind: 'action', action: { type: 'back' } });
    const f = fixture(predict);
    const heading = element('Destination');
    f.set([heading, element('', { description: 'Navigate up', resourceId: 'editor:id/up' })]);
    vi.mocked(f.driver.execute).mockImplementation(async () => { f.set([heading, element('Value')]); });
    await f.open();
    const result = await f.run({ completion: { appPackage: app, textAny: ['Destination'], textAll: ['Value'] } });
    expect(result).toMatchObject({ verified: true, actions: 1, modelRequests: 2, diagnostics: { backReplans: 1 } });
    expect(vi.mocked(f.driver.execute).mock.calls.map(call => call[1].type)).toEqual(['swipe']);
    expect(predict.mock.calls[1][0].recoveryHint).toContain('destination anchor');
  });

  it('replans absent-field typing, opens the input, then focuses and resumes the exact model intent once', async () => {
    const hints: Array<string | undefined> = [];
    const predict = vi.fn<PhoneModelAdapter['predict']>(async input => {
      hints.push(input.recoveryHint);
      return hints.length === 2 ? { kind: 'action', action: { type: 'tap', point: [200, 300] } }
        : { kind: 'action', action: { type: 'typeText', text: 'query', mode: 'replace' } };
    });
    const f = fixture(predict, { modelRequests: 3 });
    let taps = 0;
    vi.mocked(f.driver.execute).mockImplementation(async (_serial, action) => {
      if (action.type === 'tap') { taps++; f.set([field('old', taps === 2)]); }
      else if (action.type === 'typeText') f.set([field(action.text, true)]);
    });
    await f.open();
    const result = await f.run();
    expect(result).toMatchObject({ verified: true, actions: 3, modelRequests: 3,
      diagnostics: { focusReplans: 1, focusRecoveries: 1, resumedTextInputs: 1 } });
    expect(hints[1]).toContain('No text was sent');
    expect(vi.mocked(f.driver.execute).mock.calls.map(call => call[1].type)).toEqual(['tap', 'tap', 'typeText']);
    expect(predict).toHaveBeenCalledTimes(3);
  });

  it('allows confirmed queued typing at the model-request limit while counting both device actions', async () => {
    const predict = vi.fn<PhoneModelAdapter['predict']>(async () => ({ kind: 'action', action: { type: 'typeText', text: 'query', mode: 'replace' } }));
    const f = fixture(predict, { modelRequests: 1 });
    f.set([field()]);
    vi.mocked(f.driver.execute).mockImplementation(async (_serial, action) => {
      f.set([field(action.type === 'typeText' ? action.text : 'old', true)]);
    });
    await f.open();
    const result = await f.run();
    expect(result).toMatchObject({ verified: true, actions: 2, modelRequests: 1,
      diagnostics: { focusRecoveries: 1, resumedTextInputs: 1 } });
    expect(predict).toHaveBeenCalledOnce();
    expect(vi.mocked(f.driver.execute).mock.calls.map(call => call[1].type)).toEqual(['tap', 'typeText']);
  });

  it('stops at the action budget after focus without sending its queued text', async () => {
    const f = fixture(async () => ({ kind: 'action', action: { type: 'typeText', text: 'query', mode: 'replace' } }), { modelRequests: 1 });
    f.set([field()]);
    vi.mocked(f.driver.execute).mockImplementation(async () => { f.set([field('old', true)]); });
    await f.open();
    const result = await f.run({ maxActions: 1 });
    expect(result).toMatchObject({ verified: false, actions: 1, modelRequests: 1, stopReason: 'action_limit' });
    expect(vi.mocked(f.driver.execute).mock.calls.map(call => call[1].type)).toEqual(['tap']);
  });

  it('discards queued typing when text changes during focus instead of overwriting a new value', async () => {
    const predict = vi.fn<PhoneModelAdapter['predict']>(async () => predict.mock.calls.length === 1
      ? { kind: 'action', action: { type: 'typeText', text: 'query', mode: 'replace' } }
      : { kind: 'complete', summary: 'Needs fresh inspection' });
    const f = fixture(predict, { modelRequests: 2 });
    f.set([field()]);
    vi.mocked(f.driver.execute).mockImplementation(async () => { f.set([field('new user value', true)]); });
    await f.open();
    const result = await f.run();
    expect(result).toMatchObject({ verified: false, actions: 1, modelRequests: 2 });
    expect(result.diagnostics?.resumedTextInputs).toBeUndefined();
    expect(vi.mocked(f.driver.execute).mock.calls.map(call => call[1].type)).toEqual(['tap']);
    expect(predict.mock.calls[1][0].recoveryHint).toContain('No text was sent');
  });

  it('does not refocus or replay a consumed intent when the focus transition never becomes ready', async () => {
    const predict = vi.fn<PhoneModelAdapter['predict']>(async () => ({ kind: 'action', action: { type: 'typeText', text: 'query', mode: 'replace' } }));
    const f = fixture(predict, { modelRequests: 4 });
    f.set([field()]);
    await f.open();
    await expect(f.run()).rejects.toMatchObject({ code: 'PHONE_INPUT_NOT_FOCUSED' });
    expect(f.runtime.status(owner)).toMatchObject({ verified: false, actions: 1, modelRequests: 4,
      diagnostics: { focusRecoveries: 1, focusReplans: 3 } });
    expect(vi.mocked(f.driver.execute).mock.calls.map(call => call[1].type)).toEqual(['tap']);
  });

  it.each(['tap', 'typeText'] as const)('does not retry an unknown %s dispatch during focus recovery', async failedType => {
    const predict = vi.fn<PhoneModelAdapter['predict']>(async () => ({ kind: 'action', action: { type: 'typeText', text: 'query', mode: 'replace' } }));
    const f = fixture(predict, { modelRequests: 1 });
    f.set([field()]);
    vi.mocked(f.driver.execute).mockImplementation(async (_serial, action) => {
      if (action.type === failedType) throw new PhoneError('PHONE_ADB_FAILED', 'Unknown injected dispatch');
      f.set([field('old', true)]);
    });
    await f.open();
    await expect(f.run()).rejects.toMatchObject({ code: 'PHONE_ADB_FAILED' });
    expect(f.runtime.status(owner)).toMatchObject({ status: 'outcome_unknown', verified: false, modelRequests: 1 });
    expect(vi.mocked(f.driver.execute).mock.calls.map(call => call[1].type)).toEqual(failedType === 'tap' ? ['tap'] : ['tap', 'typeText']);
    expect(predict).toHaveBeenCalledOnce();
  });

  it('discards the queued typing intent after a control epoch change and handback', async () => {
    const predict = vi.fn<PhoneModelAdapter['predict']>(async () => predict.mock.calls.length === 1
      ? { kind: 'action', action: { type: 'typeText', text: 'query', mode: 'replace' } }
      : { kind: 'complete', summary: 'Handback requires new inspection' });
    const f = fixture(predict);
    f.set([field()]);
    let release: (() => void) | undefined;
    let reads = 0;
    vi.mocked(f.driver.observe).mockImplementation(async () => {
      reads++;
      if (reads === 3) await new Promise<void>(resolve => { release = resolve; });
      return f.read();
    });
    vi.mocked(f.driver.execute).mockImplementation(async () => { f.set([field('old', true)]); });
    await f.open();
    const running = f.run();
    await vi.waitFor(() => expect(release).toBeTypeOf('function'));
    const initial = f.runtime.status(owner)!;
    const paused = f.runtime.liveControl(owner, initial.sessionId, f.context, 'browser',
      { op: 'pause', epoch: initial.controlEpoch!, operationId: randomUUID() });
    await vi.waitFor(() => expect(f.runtime.status(owner)).toMatchObject({ controlOwner: 'none', handoff: 'acquiring' }));
    release!();
    await paused;
    const held = f.runtime.status(owner)!;
    await f.runtime.liveControl(owner, held.sessionId, f.context, 'browser',
      { op: 'handback', epoch: held.controlEpoch!, operationId: randomUUID() });
    const result = await running;
    expect(result).toMatchObject({ verified: false, actions: 1 });
    expect(result.diagnostics?.resumedTextInputs).toBeUndefined();
    expect(vi.mocked(f.driver.execute).mock.calls.map(call => call[1].type)).toEqual(['tap']);
    expect(predict.mock.calls.length).toBeGreaterThan(1);
  });

  it('cancels a pending focus transition without dispatching its queued text', async () => {
    const predict = vi.fn<PhoneModelAdapter['predict']>(async () => ({ kind: 'action', action: { type: 'typeText', text: 'query', mode: 'replace' } }));
    const f = fixture(predict);
    f.set([field()]);
    let release: (() => void) | undefined;
    let reads = 0;
    vi.mocked(f.driver.observe).mockImplementation(async () => {
      reads++;
      if (reads === 3) await new Promise<void>(resolve => { release = resolve; });
      return f.read();
    });
    vi.mocked(f.driver.execute).mockImplementation(async () => { f.set([field('old', true)]); });
    await f.open();
    const running = f.run();
    const rejected = expect(running).rejects.toMatchObject({ code: 'PHONE_CANCELLED' });
    await vi.waitFor(() => expect(release).toBeTypeOf('function'));
    const cancelled = f.runtime.execute(owner, { op: 'cancel' }, f.context);
    await vi.waitFor(() => expect(f.runtime.status(owner)).toMatchObject({ status: 'cancelled' }));
    release!();
    await rejected;
    await cancelled;
    expect(vi.mocked(f.driver.execute).mock.calls.map(call => call[1].type)).toEqual(['tap']);
    expect(predict).toHaveBeenCalledOnce();
  });
});
