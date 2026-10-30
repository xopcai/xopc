import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createPhoneUseTool } from '../../agent/tools/phone-use-tool.js';

import { ConfigSchema } from '../../config/schema.js';
import { closeXopcDatabase, openXopcDatabase } from '../../storage/sqlite/connection.js';
import type { PhoneDriver } from '../adb-driver.js';
import { PhoneInputSchema, type PhoneElement, type PhoneObservation, type PhoneReport } from '../contracts.js';
import type { PhoneModelAdapter } from '../model-adapter.js';
import { PhoneRepository } from '../repository.js';
import { PhoneRuntime } from '../runtime.js';

const runtimes: PhoneRuntime[] = [];
beforeEach(() => { closeXopcDatabase(); openXopcDatabase({ path: ':memory:' }); });
afterEach(async () => { await Promise.all(runtimes.splice(0).map(runtime => runtime.shutdown())); closeXopcDatabase(); });

const element = (text: string, resourceId = text): PhoneElement => ({
  text, resourceId, description: '', bounds: [100, 200, 300, 400], clickable: true, focused: false, password: false,
});
function observation(elements: PhoneElement[], app = 'com.test.editor'): PhoneObservation {
  return { frameId: randomUUID(), capturedAt: Date.now(), width: 1000, height: 1000, rotation: 0,
    package: app, frame: Buffer.from('synthetic-pixels'), elements };
}
function fixture(predict: PhoneModelAdapter['predict'], options: { modelRequests?: number; readScreen?: PhoneModelAdapter['readScreen']; readFields?: PhoneModelAdapter['readFields']; batchReadings?: boolean; semanticControls?: boolean; hierarchicalPlanning?: boolean } = {}) {
  const repository = new PhoneRepository();
  const device = repository.save({ serial: 'reliability-editor', name: 'Synthetic editor', enabled: true, allowedApps: ['com.test.editor', 'com.test.other'] });
  repository.setDefault(device.id);
  let current = observation([element('Initial')]);
  const driver: PhoneDriver = {
    discover: async () => [{ serial: device.serial, name: device.name, state: 'device', emulator: true }],
    observe: vi.fn(async () => ({ ...current, frameId: randomUUID(), frame: Buffer.from(current.frame) })),
    execute: vi.fn(async () => {}),
  };
  const runtime = new PhoneRuntime(repository, () => driver, async () => ({ predict, readScreen: options.readScreen, readFields: options.readFields }));
  runtimes.push(runtime);
  const context = { config: ConfigSchema.parse({ phone: { enabled: true, maxModelRequests: options.modelRequests ?? 10,
    batchReadings: options.batchReadings, semanticControls: options.semanticControls, hierarchicalPlanning: options.hierarchicalPlanning } }), agentId: 'main', modelRef: 'test/reliability' };
  return { repository, runtime, driver, context, set: (next: PhoneObservation) => { current = next; },
    open: () => runtime.execute('reliability', { op: 'open', mode: 'control' }, context),
  };
}

describe('phone task contract and execution strategies', () => {
  it('defaults to collaboration, persists chat preference and honors an explicit task override', async () => {
    const f = fixture(async () => ({ kind: 'complete', summary: 'Done' }));
    expect(await f.runtime.execute('reliability', { op: 'discover' }, f.context)).toMatchObject({ executionMode: 'collaborative' });
    await f.runtime.execute('reliability', { op: 'set_mode', executionMode: 'direct', applyCurrent: false }, f.context);
    expect(new PhoneRepository().executionMode('reliability')).toBe('direct');
    await f.open();
    const result = await f.runtime.execute('reliability', { op: 'run', goal: 'Read current page', maxActions: 6 }, f.context) as PhoneReport;
    expect(result).toMatchObject({ executionMode: 'direct', feedback: { outcome: 'partial', nextAction: 'replan', stopReason: 'model_finished_unverified' } });
    expect(result.feedback?.taskId).toBe(result.task?.taskId);
    const explicit = await f.runtime.execute('reliability', { op: 'run', goal: 'Another task', executionMode: 'collaborative', maxActions: 6 }, f.context) as PhoneReport;
    expect(explicit.executionMode).toBe('collaborative');
    expect(f.repository.executionMode('reliability')).toBe('direct');
    expect(explicit.task?.taskId).not.toBe(result.task?.taskId);
  });

  it('locks an active task mode despite changed global/chat defaults and preserves constraints across fragments', async () => {
    const predict = vi.fn<PhoneModelAdapter['predict']>(async () => ({ kind: 'complete', summary: 'Done' }));
    const f = fixture(predict); await f.open();
    const first = await f.runtime.execute('reliability', { op: 'run', goal: 'Read first shop', constraints: ['Do not submit'], maxActions: 6 }, f.context) as PhoneReport;
    await f.runtime.setExecutionMode('reliability', 'direct', f.context);
    f.context.config.phone.executionMode = 'direct';
    const second = await f.runtime.execute('reliability', { op: 'run', taskId: first.task!.taskId, goal: 'Read second shop', maxActions: 6 }, f.context) as PhoneReport;
    expect(second).toMatchObject({ executionMode: 'collaborative', nextExecutionMode: 'direct', task: { constraints: ['Do not submit'] } });
    expect(predict.mock.calls.at(-1)?.[0].task).toMatchObject({ executionMode: 'collaborative', constraints: ['Do not submit'] });
    expect(second.feedback?.segmentId).not.toBe(first.feedback?.segmentId);
    await expect(f.runtime.execute('reliability', { op: 'run', taskId: first.task!.taskId, executionMode: 'direct', goal: 'Continue', maxActions: 6 }, f.context)).rejects.toMatchObject({ code: 'PHONE_MODE_SWITCH_REQUIRED' });
  });

  it('returns named native outputs without extra inference and keeps task content out of durable reports', async () => {
    const predict = vi.fn<PhoneModelAdapter['predict']>();
    const f = fixture(predict); f.set(observation([element('25.50', 'com.test.editor:id/price')])); await f.open();
    const tool = createPhoneUseTool({ runtime: f.runtime, context: () => ({ ...f.context, owner: 'reliability' }) });
    const result = await tool.execute('read', { op: 'run', goal: 'Inspect price', completion: { textAll: ['25.50'] }, constraints: ['Read only'],
      requestedOutputs: [{ key: 'price', description: 'Displayed price', selector: { resourceId: 'com.test.editor:id/price' } }] }, new AbortController().signal);
    expect(result.details).toMatchObject({ feedback: { outcome: 'completed', verified: true, nextAction: 'done',
      outputs: [{ key: 'price', value: '25.50', source: 'native_ui', verification: 'observed', frameId: expect.any(String), capturedAt: expect.any(Number) }],
      usage: { actions: 0, modelRequests: 0 } } });
    const { performance: _timing, ...modelResult } = result.details as PhoneReport;
    expect(JSON.parse((result.content[0] as { text: string }).text)).toEqual(modelResult);
    expect(result.details).toHaveProperty('performance');
    expect(predict).not.toHaveBeenCalled(); expect(f.driver.execute).not.toHaveBeenCalled();
    const saved = f.repository.history()[0];
    expect(saved.task).toBeUndefined(); expect(saved.feedback).toBeUndefined(); expect(saved.readings).toBeUndefined();
  });

  it('uses read-only screenshot fields with unverified provenance and shared request limits', async () => {
    const readScreen = vi.fn(async () => '25.50');
    const f = fixture(async () => ({ kind: 'complete', summary: 'Read' }), { readScreen, modelRequests: 2 }); await f.open();
    const result = await f.runtime.execute('reliability', { op: 'run', goal: 'Read prices', maxActions: 6,
      requestedOutputs: [{ key: 'price', description: 'Read visible price' }, { key: 'delivery', description: 'Read delivery fee' }] }, f.context) as PhoneReport;
    // The targeted field uses the remaining request; no generic finish reading consumes it first.
    expect(result.feedback?.outputs).toMatchObject([{ key: 'price', value: '25.50', verification: 'unverified' }, { key: 'delivery', verification: 'unavailable', reason: 'model_request_limit' }]);
    expect(result.modelRequests).toBe(2); expect(result.feedback?.outcome).toBe('partial'); expect(f.driver.execute).not.toHaveBeenCalled();
  });

  it('returns screenshot field values without promoting screenshot evidence to completion', async () => {
    const f = fixture(async () => ({ kind: 'complete', summary: 'Read' }), { readScreen: async () => '25.50' }); await f.open();
    const result = await f.runtime.execute('reliability', { op: 'run', goal: 'Read price', maxActions: 6,
      requestedOutputs: [{ key: 'price', description: 'Read visible price' }] }, f.context) as PhoneReport;
    expect(result.feedback).toMatchObject({ outcome: 'partial', verified: false, outputs: [{ key: 'price', value: '25.50', source: 'screenshot', verification: 'unverified' }] });
  });

  it('rejects ambiguous, clipped and password native outputs instead of guessing', async () => {
    const f = fixture(async () => ({ kind: 'complete', summary: 'Read' }));
    f.set(observation([element('A', 'same'), element('B', 'same'), { ...element('secret', 'password'), password: true }, { ...element('clipped', 'edge'), bounds: [0, 0, 1100, 100] }]));
    await f.open();
    const result = await f.runtime.execute('reliability', { op: 'run', goal: 'Read labels', maxActions: 6,
      requestedOutputs: ['same', 'password', 'edge'].map(key => ({ key, description: key, selector: { resourceId: key } })) }, f.context) as PhoneReport;
    expect(result.feedback?.outputs.every(output => output.verification === 'unavailable' && !output.value)).toBe(true);
    expect(JSON.stringify(result.feedback)).not.toContain('secret');
  });

  it('reports action exhaustion as partial progress with segment usage', async () => {
    const f = fixture(async () => ({ kind: 'action', action: { type: 'tap', point: [200, 300] } })); await f.open();
    const result = await f.runtime.execute('reliability', { op: 'run', goal: 'Navigate', maxActions: 1 }, f.context) as PhoneReport;
    expect(result.feedback).toMatchObject({ outcome: 'partial', stopReason: 'action_limit', nextAction: 'replan', usage: { actions: 1, modelRequests: 1, activeDurationMs: expect.any(Number) } });
  });

  it('switches current tasks only after pausing, preserves identity and counters, and requires handback', async () => {
    const f = fixture(async () => ({ kind: 'action', action: { type: 'tap', point: [200, 300] } })); await f.open();
    const first = await f.runtime.execute('reliability', { op: 'run', goal: 'Navigate', constraints: ['Do not send'], maxActions: 1 }, f.context) as PhoneReport;
    const switched = await f.runtime.setExecutionMode('reliability', 'direct', f.context, true, first.controlEpoch);
    expect(switched).toMatchObject({ status: 'paused', executionMode: 'direct', stopReason: 'mode_changed', actions: first.actions, modelRequests: first.modelRequests,
      task: { taskId: first.task!.taskId, goal: 'Navigate', constraints: ['Do not send'] }, feedback: { outcome: 'blocked' } });
    await expect(f.runtime.execute('reliability', { op: 'run', taskId: first.task!.taskId, goal: 'Continue', maxActions: 1 }, f.context)).rejects.toMatchObject({ code: 'PHONE_PAUSED' });
    await expect(f.runtime.setExecutionMode('reliability', 'collaborative', f.context, true, first.controlEpoch)).rejects.toMatchObject({ code: 'PHONE_CONTROL_STALE' });
    await expect(f.runtime.execute('reliability', { op: 'resume' }, f.context)).rejects.toMatchObject({ code: 'PHONE_PAUSED' });
    const paused = f.runtime.status('reliability')!;
    await f.runtime.liveControl('reliability', paused.sessionId, f.context, 'browser', { op: 'handback', epoch: paused.controlEpoch!, operationId: randomUUID() });
    const resumed = await f.runtime.execute('reliability', { op: 'run', taskId: first.task!.taskId, goal: 'Continue', maxActions: 1 }, f.context) as PhoneReport;
    expect(resumed.executionMode).toBe('direct'); expect(resumed.actions).toBe(first.actions + 1);
  });

  it('discards a pending prediction when switching instead of dispatching old coordinates', async () => {
    let started!: () => void; const pending = new Promise<void>(resolve => { started = resolve; });
    const f = fixture(async (_input, signal) => { started(); await new Promise<void>((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true })); return { kind: 'action', action: { type: 'tap', point: [200, 300] } }; });
    await f.open();
    const operation = f.runtime.execute('reliability', { op: 'run', goal: 'Navigate', maxActions: 6 }, f.context);
    const rejected = expect(operation).rejects.toMatchObject({ code: 'PHONE_CANCELLED' });
    await pending; await f.runtime.setExecutionMode('reliability', 'direct', f.context, true); await rejected;
    expect(f.driver.execute).not.toHaveBeenCalled(); expect(f.runtime.status('reliability')?.status).toBe('paused');
  });

  it('does not allow current-task switching during human takeover or unknown dispatch', async () => {
    const f = fixture(async () => ({ kind: 'action', action: { type: 'tap', point: [200, 300] } })); await f.open();
    const report = await f.runtime.execute('reliability', { op: 'run', goal: 'Navigate', maxActions: 1 }, f.context) as PhoneReport;
    await f.runtime.liveControl('reliability', report.sessionId, f.context, 'browser', { op: 'takeover', epoch: report.controlEpoch!, operationId: randomUUID() });
    await expect(f.runtime.setExecutionMode('reliability', 'direct', f.context, true)).rejects.toMatchObject({ code: 'PHONE_PAUSED' });
    expect(f.repository.executionMode('reliability')).toBeUndefined();
  });

  it('rejects duplicate keys and oversized task contracts at the boundary', () => {
    const output = { key: 'price', description: 'Price' };
    expect(PhoneInputSchema.safeParse({ op: 'run', goal: 'Read', requestedOutputs: [output, output] }).success).toBe(false);
    expect(PhoneInputSchema.safeParse({ op: 'run', goal: 'Read', constraints: Array(13).fill('Read only') }).success).toBe(false);
  });
  it('does not reset task request budgets through fragments or switching', async () => {
    const f = fixture(async () => ({ kind: 'action', action: { type: 'tap', point: [200, 300] } })); await f.open();
    const first = await f.runtime.execute('reliability', { op: 'run', goal: 'Navigate', budget: { maxModelRequests: 1 }, maxActions: 1 }, f.context) as PhoneReport;
    await f.runtime.setExecutionMode('reliability', 'direct', f.context, true);
    const paused = f.runtime.status('reliability')!;
    await f.runtime.liveControl('reliability', paused.sessionId, f.context, 'browser', { op: 'handback', epoch: paused.controlEpoch!, operationId: randomUUID() });
    await expect(f.runtime.execute('reliability', { op: 'run', taskId: first.task!.taskId, goal: 'Continue', budget: { maxModelRequests: 100 }, maxActions: 1 }, f.context)).rejects.toMatchObject({ code: 'PHONE_MODEL_LIMIT' });
    expect(f.runtime.status('reliability')).toMatchObject({ modelRequests: 1, task: { budget: { maxModelRequests: 1 } }, feedback: { outcome: 'partial', nextAction: 'user' } });
    expect(f.driver.execute).toHaveBeenCalledOnce();
  });

  it('keeps unknown dispatch inspection mandatory when switching modes', async () => {
    const f = fixture(async () => ({ kind: 'action', action: { type: 'tap', point: [200, 300] } })); await f.open();
    vi.mocked(f.driver.execute).mockRejectedValue(new Error('Connection lost during input'));
    await expect(f.runtime.execute('reliability', { op: 'run', goal: 'Navigate', maxActions: 1 }, f.context)).rejects.toThrow();
    expect(f.runtime.status('reliability')?.feedback).toMatchObject({ outcome: 'needs_user', nextAction: 'inspect' });
    await expect(f.runtime.setExecutionMode('reliability', 'direct', f.context, true)).rejects.toMatchObject({ code: 'PHONE_DISPATCH_UNKNOWN' });
    expect(f.repository.executionMode('reliability')).toBeUndefined();
  });

});


it('combines named visual outputs into one budgeted reading without a redundant finish transcription', async () => {
  const readFields = vi.fn(async () => ({ price: '25.50', delivery: null }));
  const readScreen = vi.fn(async () => 'Should not run');
  const f = fixture(async () => ({ kind: 'complete', summary: 'At destination' }), { readFields, readScreen, modelRequests: 2, batchReadings: true });
  await f.open();
  const result = await f.runtime.execute('reliability', { op: 'run', goal: 'Read price and delivery', maxActions: 6,
    requestedOutputs: [{ key: 'price', description: 'Price' }, { key: 'delivery', description: 'Delivery' }] }, f.context) as PhoneReport;
  expect(result.modelRequests).toBe(2); expect(readFields).toHaveBeenCalledOnce(); expect(readScreen).not.toHaveBeenCalled();
  expect(result.feedback?.outputs).toMatchObject([
    { key: 'price', value: '25.50', source: 'screenshot', verification: 'unverified' },
    { key: 'delivery', source: 'screenshot', verification: 'unavailable', reason: 'screen_unreadable' },
  ]);
  expect(result.verified).toBe(false);
  expect(result.performance?.phases.screen_reading?.count).toBe(1);
});

it('batches five product outputs by default and preserves exact native outputs in the same segment', async () => {
  const products = Object.fromEntries(Array.from({ length: 5 }, (_, index) => [`product${index + 1}`, `Glasses ${index + 1}: ¥${index + 100}`]));
  const readFields = vi.fn(async (input: Parameters<NonNullable<PhoneModelAdapter['readFields']>>[0]) => {
    expect(input.observation.frame.toString()).toBe('synthetic-pixels');
    return products;
  });
  const readScreen = vi.fn(async () => 'Redundant');
  const f = fixture(vi.fn(), { readFields, readScreen });
  f.set(observation([element('Results'), element('综合', 'sort')])); await f.open();
  expect(f.context.config.phone.batchReadings).toBe(true);
  const result = await f.runtime.execute('reliability', { op: 'run', goal: 'Read the first five visible products',
    completion: { textAll: ['Results'] }, requestedOutputs: [
      { key: 'sort', description: 'Selected sort', selector: { resourceId: 'sort' } },
      ...Object.keys(products).map(key => ({ key, description: key })),
    ] }, f.context) as PhoneReport;
  expect(readFields).toHaveBeenCalledOnce(); expect(readScreen).not.toHaveBeenCalled();
  // Initial and independent completion observations only; no third screenshot for extraction.
  expect(f.driver.observe).toHaveBeenCalledTimes(2);
  expect(result.feedback?.outputs).toMatchObject([
    { key: 'sort', value: '综合', verification: 'observed', source: 'native_ui' },
    ...Object.entries(products).map(([key, value]) => ({ key, value, verification: 'unverified', source: 'screenshot' })),
  ]);
  expect(result.modelRequests).toBe(1);
  expect(readFields.mock.calls[0][0].observation.frame.every(byte => byte === 0)).toBe(true);
});

it('extracts native fields from the independent confirmation frame without another screenshot or inference', async () => {
  const f = fixture(vi.fn(), { readScreen: vi.fn(), readFields: vi.fn() }); await f.open();
  const frames = [observation([element('Results'), element('100', 'price')]), observation([element('Results'), element('200', 'price')])];
  vi.mocked(f.driver.observe).mockImplementation(async () => frames.shift()!);
  const result = await f.runtime.execute('reliability', { op: 'run', goal: 'Read price', completion: { textAll: ['Results'] },
    requestedOutputs: [{ key: 'price', description: 'Price', selector: { resourceId: 'price' } }] }, f.context) as PhoneReport;
  expect(result.feedback?.outputs[0]).toMatchObject({ value: '200', source: 'native_ui', verification: 'observed' });
  expect(f.driver.observe).toHaveBeenCalledTimes(2); expect(result.modelRequests).toBe(0);
});

it('refreshes after a finish prediction and reads one requested field without generic transcription', async () => {
  const readScreen = vi.fn(async (input: Parameters<NonNullable<PhoneModelAdapter['readScreen']>>[0]) => {
    expect(input.observation.elements[0].text).toBe('Updated'); return '200';
  });
  const f = fixture(async () => { f.set(observation([element('Updated')])); return { kind: 'complete', summary: 'Done' }; }, { readScreen });
  await f.open();
  const result = await f.runtime.execute('reliability', { op: 'run', goal: 'Read price',
    requestedOutputs: [{ key: 'price', description: 'Current price' }] }, f.context) as PhoneReport;
  expect(readScreen).toHaveBeenCalledOnce(); expect(readScreen.mock.calls[0][0].goal).toBe('Current price');
  expect(f.driver.observe).toHaveBeenCalledTimes(2); expect(result.modelRequests).toBe(2);
});

it('extracts fields from the last post-action screen when a fragment hits its action limit', async () => {
  const readFields = vi.fn(async () => ({ first: 'A', second: 'B' }));
  const f = fixture(async () => ({ kind: 'action', action: { type: 'swipe', start: [500, 800], end: [500, 200], durationMs: 200 } }), { readFields });
  await f.open();
  const result = await f.runtime.execute('reliability', { op: 'run', goal: 'Scroll and read', maxActions: 1,
    requestedOutputs: [{ key: 'first', description: 'First product' }, { key: 'second', description: 'Second product' }] }, f.context) as PhoneReport;
  expect(f.driver.observe).toHaveBeenCalledTimes(3); expect(readFields).toHaveBeenCalledOnce();
  expect(result.feedback).toMatchObject({ outcome: 'partial', stopReason: 'action_limit', outputs: [{ value: 'A' }, { value: 'B' }] });
});

it('keeps sequential extraction available when batching is explicitly disabled', async () => {
  const readFields = vi.fn(async () => ({ price: 'unexpected', delivery: 'unexpected' }));
  const readScreen = vi.fn(async () => '25.50');
  const f = fixture(vi.fn(), { readFields, readScreen, batchReadings: false });
  await f.open();
  await f.runtime.execute('reliability', { op: 'run', goal: 'Read', completion: { textAll: ['Initial'] },
    requestedOutputs: [{ key: 'price', description: 'Price' }, { key: 'delivery', description: 'Delivery' }] }, f.context);
  expect(readScreen).toHaveBeenCalledTimes(2); expect(readFields).not.toHaveBeenCalled();
});

it('does not expose completion while named product fields are still being extracted', async () => {
  let complete!: (values: Record<string, string>) => void;
  let started!: () => void;
  const reading = new Promise<void>(resolve => { started = resolve; });
  const readFields = vi.fn(async () => { started(); return await new Promise<Record<string, string>>(resolve => { complete = resolve; }); });
  const f = fixture(vi.fn(), { readFields }); await f.open();
  const execution = f.runtime.execute('reliability', { op: 'run', goal: 'Read products', completion: { textAll: ['Initial'] },
    requestedOutputs: [{ key: 'first', description: 'First' }, { key: 'second', description: 'Second' }] }, f.context);
  await reading;
  expect(f.runtime.status('reliability')?.status).toBe('running');
  complete({ first: 'A', second: 'B' });
  expect(await execution).toMatchObject({ status: 'completed', feedback: { outputs: [{ value: 'A' }, { value: 'B' }] } });
});

it('discards a batch that finishes after human handoff without publishing product values', async () => {
  let complete!: (values: Record<string, string>) => void;
  let entered!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; });
  const readFields = vi.fn(async () => { entered(); return await new Promise<Record<string, string>>(resolve => { complete = resolve; }); });
  const f = fixture(vi.fn(), { readFields }); await f.open();
  const execution = f.runtime.execute('reliability', { op: 'run', goal: 'Read products', completion: { textAll: ['Initial'] },
    requestedOutputs: [{ key: 'first', description: 'First' }, { key: 'second', description: 'Second' }] }, f.context);
  await started;
  const stopped = f.runtime.stop('reliability', 'pause'); complete({ first: 'late A', second: 'late B' });
  await Promise.allSettled([execution, stopped]);
  const report = f.runtime.status('reliability')!;
  expect(report.status).toBe('paused');
  expect(report.feedback?.outputs.every(output => output.value === undefined)).toBe(true);
  expect(report.readings?.some(reading => reading.source === 'screenshot')).toBe(false);
});
