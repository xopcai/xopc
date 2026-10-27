import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createPhoneUseTool } from '../../agent/tools/phone-use-tool.js';

import { ConfigSchema } from '../../config/schema.js';
import { closeXopcDatabase, openXopcDatabase } from '../../storage/sqlite/connection.js';
import type { PhoneDriver } from '../adb-driver.js';
import { PhoneError, type PhoneElement, type PhoneObservation, type PhoneReport } from '../contracts.js';
import type { PhoneModelAdapter, PhonePrediction } from '../model-adapter.js';
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
function fixture(predict: PhoneModelAdapter['predict'], options: { modelRequests?: number; readScreen?: PhoneModelAdapter['readScreen']; reset?: PhoneModelAdapter['reset']; semanticControls?: boolean; hierarchicalPlanning?: boolean } = {}) {
  const repository = new PhoneRepository();
  const device = repository.save({ serial: 'reliability-editor', name: 'Synthetic editor', enabled: true, allowedApps: ['com.test.editor', 'com.test.other'] });
  repository.setDefault(device.id);
  let current = observation([element('Initial')]);
  const driver: PhoneDriver = {
    discover: async () => [{ serial: device.serial, name: device.name, state: 'device', emulator: true }],
    observe: vi.fn(async () => ({ ...current, frameId: randomUUID(), frame: Buffer.from(current.frame) })),
    execute: vi.fn(async () => {}),
  };
  const runtime = new PhoneRuntime(repository, () => driver, async () => ({ predict, readScreen: options.readScreen, reset: options.reset }));
  runtimes.push(runtime);
  const context = { config: ConfigSchema.parse({ phone: { enabled: true, maxModelRequests: options.modelRequests ?? 10,
    semanticControls: options.semanticControls, hierarchicalPlanning: options.hierarchicalPlanning } }), agentId: 'main', modelRef: 'test/reliability' };
  return { repository, runtime, driver, context, set: (next: PhoneObservation) => { current = next; },
    open: () => runtime.execute('reliability', { op: 'open', mode: 'control' }, context),
  };
}

describe('phone runtime reliability integration', () => {
  it('dispatches the native Up button across changing Settings uptime without replanning or takeover', async () => {
    const about = { ...element(''), description: '关于手机', clickable: false, bounds: [0, 0, 1000, 100] as PhoneElement['bounds'] };
    const label = { ...element('开机累计时长', 'android:id/title'), clickable: false, bounds: [36, 700, 216, 741] as PhoneElement['bounds'] };
    const value = { ...element('35:47:09', 'android:id/summary'), clickable: false, bounds: [36, 741, 118, 770] as PhoneElement['bounds'] };
    const up = { ...element('', ''), description: '向上导航' };
    const before = observation([about, label, value, up], 'com.android.settings');
    const f = fixture(async () => {
      f.set({ ...before, elements: [about, label, { ...value, text: '35:47:12' }, up] });
      return { kind: 'action', action: { type: 'tap', point: [200, 300] } };
    }, { semanticControls: false });
    const device = f.repository.list()[0];
    f.repository.save({ ...device, allowedApps: ['com.android.settings'] }, device.id);
    f.set(before);
    vi.mocked(f.driver.execute).mockImplementation(async () => { f.set(observation([element('显示')], 'com.android.settings')); });
    await f.open();
    const result = await f.runtime.execute('reliability', { op: 'run', goal: 'Return to Settings', expectText: '显示' }, f.context) as PhoneReport;
    expect(result).toMatchObject({ verified: true, actions: 1, modelRequests: 1, diagnostics: { stalePredictions: 0 } });
    expect(result.humanActions ?? 0).toBe(0);
    expect(f.driver.execute).toHaveBeenCalledOnce();
  });

  it('automatically reads an empty native screen without sending device input and keeps source metadata transient', async () => {
    const readScreen = vi.fn<NonNullable<PhoneModelAdapter['readScreen']>>(async () => 'Android version: 15');
    const f = fixture(vi.fn(), { readScreen });
    f.set(observation([])); await f.open();
    const result = await f.runtime.execute('reliability', { op: 'observe' }, f.context) as PhoneReport;
    expect(result).toMatchObject({ verified: false, verificationLevel: 'none', modelRequests: 1, facts: [],
      readings: [{ source: 'native_ui', verification: 'observed', text: [] },
        { source: 'screenshot', verification: 'unverified', text: ['Android version: 15'], frameId: expect.any(String), capturedAt: expect.any(Number) }] });
    expect(readScreen).toHaveBeenCalledOnce();
    expect(f.driver.execute).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toContain('synthetic-pixels');
    expect(f.repository.history()[0].readings).toBeUndefined();
    await f.runtime.execute('reliability', { op: 'close' }, f.context);
    expect(f.runtime.status('reliability')?.readings).toBeUndefined();
  });

  it('returns screenshot readings to the chat Agent through both tool content and details in observe mode', async () => {
    const predict = vi.fn<PhoneModelAdapter['predict']>();
    const f = fixture(predict, { readScreen: async () => 'Android version: 15' });
    f.set(observation([]));
    const tool = createPhoneUseTool({ runtime: f.runtime, context: () => ({ ...f.context, owner: 'reliability' }) });
    const signal = new AbortController().signal;
    await tool.execute('open', { op: 'open', mode: 'observe' }, signal);
    const result = await tool.execute('read', { op: 'observe' }, signal);
    expect(result.details).toMatchObject({ mode: 'observe', verified: false, readings: [
      { source: 'native_ui' }, { source: 'screenshot', verification: 'unverified', text: ['Android version: 15'] }] });
    const content = result.content[0];
    expect(content.type).toBe('text');
    const { performance: _performance, ...modelDetails } = result.details as PhoneReport;
    if (content.type === 'text') expect(JSON.parse(content.text)).toEqual(JSON.parse(JSON.stringify(modelDetails)));
    expect(result.details).toHaveProperty('performance');
    expect(predict).not.toHaveBeenCalled(); expect(f.driver.execute).not.toHaveBeenCalled();
  });

  it('does not send screenshots from a disallowed app or password screen to the reading model', async () => {
    const readScreen = vi.fn<NonNullable<PhoneModelAdapter['readScreen']>>();
    const f = fixture(vi.fn(), { readScreen }); await f.open();
    f.set(observation([], 'com.private.app'));
    await expect(f.runtime.execute('reliability', { op: 'observe' }, f.context)).rejects.toMatchObject({ code: 'PHONE_APP_DENIED' });
    expect(readScreen).not.toHaveBeenCalled();
    // Reopen after the rejected operation, then inspect a protected field.
    await f.runtime.execute('reliability', { op: 'close' }, f.context); await f.open();
    f.set(observation([{ ...element('secret'), password: true }]));
    const result = await f.runtime.execute('reliability', { op: 'observe' }, f.context) as PhoneReport;
    expect(result.readings?.[1]).toMatchObject({ verification: 'unavailable', reason: 'password_field_visible', text: [] });
    expect(readScreen).not.toHaveBeenCalled(); expect(JSON.stringify(result)).not.toContain('secret');
  });

  it('uses native facts without a model call and accepts a targeted reading for partial native text', async () => {
    const readScreen = vi.fn<NonNullable<PhoneModelAdapter['readScreen']>>(async () => 'Android version: 15');
    const f = fixture(vi.fn(), { readScreen }); await f.open();
    const native = await f.runtime.execute('reliability', { op: 'observe' }, f.context) as PhoneReport;
    expect(native.readings).toMatchObject([{ source: 'native_ui', verification: 'observed', text: ['Initial'] }]);
    expect(readScreen).not.toHaveBeenCalled();
    const visual = await f.runtime.execute('reliability', { op: 'observe', goal: 'Read Android version' }, f.context) as PhoneReport;
    expect(visual.readings?.[1]).toMatchObject({ source: 'screenshot', verification: 'unverified', text: ['Android version: 15'] });
    expect(readScreen.mock.calls[0][0]).toMatchObject({ goal: 'Read Android version' });
  });

  it('does not spend a screenshot-reading request when explicit native predicates remain unmet', async () => {
    const readScreen = vi.fn<NonNullable<PhoneModelAdapter['readScreen']>>(async () => 'Android version: 15');
    const f = fixture(async () => ({ kind: 'complete', summary: 'About phone' }), { readScreen }); await f.open();
    const result = await f.runtime.execute('reliability', { op: 'run', goal: 'Read Android version', expectText: 'Android version' }, f.context) as PhoneReport;
    expect(result).toMatchObject({ status: 'paused', verified: false, verificationLevel: 'none', stopReason: 'completion_unmet', modelRequests: 3 });
    expect(result.readings?.some(reading => reading.source === 'screenshot')).toBe(false);
    expect(readScreen).not.toHaveBeenCalled(); expect(f.driver.execute).not.toHaveBeenCalled();
  });

  it('reads screenshot-only values for goals without explicit completion predicates', async () => {
    const readScreen = vi.fn(async () => 'Version: 15');
    const f = fixture(async () => ({ kind: 'complete', summary: 'Done' }), { readScreen }); await f.open();
    const result = await f.runtime.execute('reliability', { op: 'run', goal: 'Read version' }, f.context) as PhoneReport;
    expect(result.readings?.[1]).toMatchObject({ source: 'screenshot', text: ['Version: 15'], verification: 'unverified' });
    expect(result.modelRequests).toBe(2);
  });

  it('keeps native verification independent and skips the visual fallback when predicates are verified', async () => {
    const readScreen = vi.fn(async () => 'Wrong value');
    const f = fixture(vi.fn(), { readScreen }); await f.open();
    const result = await f.runtime.execute('reliability', { op: 'run', goal: 'Read Initial', expectText: 'Initial' }, f.context) as PhoneReport;
    expect(result).toMatchObject({ verified: true, verificationLevel: 'ui', modelRequests: 0 });
    expect(readScreen).not.toHaveBeenCalled();
  });

  it('does not exceed the shared model request budget for screenshot readings', async () => {
    const readScreen = vi.fn(async () => 'Version: 15');
    const f = fixture(async () => ({ kind: 'complete', summary: 'Done' }), { readScreen, modelRequests: 1 }); await f.open();
    const result = await f.runtime.execute('reliability', { op: 'run', goal: 'Read version' }, f.context) as PhoneReport;
    expect(result.readings?.[1]).toMatchObject({ verification: 'unavailable', text: [], reason: 'model_request_limit' });
    expect(result.modelRequests).toBe(1); expect(readScreen).not.toHaveBeenCalled();
  });

  it('reports unreadable screenshots without fabricating text or losing native facts', async () => {
    const f = fixture(vi.fn(), { readScreen: async () => { throw new PhoneError('PHONE_SCREEN_UNREADABLE', 'Unreadable'); } }); await f.open();
    const result = await f.runtime.execute('reliability', { op: 'observe', goal: 'Read version' }, f.context) as PhoneReport;
    expect(result).toMatchObject({ status: 'ready', facts: ['Initial'], readings: [
      { source: 'native_ui' }, { source: 'screenshot', text: [], verification: 'unavailable', reason: 'PHONE_SCREEN_UNREADABLE' }] });
  });

  it('rejects a visual reading if device authorization changes while the model is running', async () => {
    let f: ReturnType<typeof fixture>;
    f = fixture(vi.fn(), { readScreen: async () => {
      const device = f.repository.list()[0]; f.repository.save({ ...device, enabled: false }, device.id);
      return 'Version: 15';
    } }); f.set(observation([])); await f.open();
    await expect(f.runtime.execute('reliability', { op: 'observe' }, f.context)).rejects.toMatchObject({ code: 'PHONE_ACCESS_CHANGED' });
    expect(f.runtime.status('reliability')?.readings?.some(reading => reading.source === 'screenshot')).toBe(false);
  });

  it('discards a late screenshot reading after pause', async () => {
    let finish!: (value: string) => void;
    let entered!: () => void;
    const started = new Promise<void>(resolve => { entered = resolve; });
    const f = fixture(vi.fn(), { readScreen: async () => { entered(); return new Promise(resolve => { finish = resolve; }); } });
    f.set(observation([])); await f.open();
    const operation = f.runtime.execute('reliability', { op: 'observe' }, f.context);
    await started;
    const stopped = f.runtime.stop('reliability', 'pause'); finish('Late value');
    await Promise.allSettled([operation, stopped]);
    expect(f.runtime.status('reliability')).toMatchObject({ status: 'paused' });
    expect(f.runtime.status('reliability')?.readings?.some(reading => reading.source === 'screenshot')).toBe(false);
  });

  it('resolves a semantic target through the fresh observation before dispatch and independent completion', async () => {
    const f = fixture(async input => ({ kind: 'action', action: { type: 'tapElement', frameId: input.observation.frameId,
      selector: { text: 'Initial' } } }), { semanticControls: true });
    vi.mocked(f.driver.execute).mockImplementation(async () => { f.set(observation([element('Done')])); });
    await f.open();
    const result = await f.runtime.execute('reliability', { op: 'run', goal: 'Open Done', expectText: 'Done' }, f.context) as PhoneReport;
    expect(result).toMatchObject({ verified: true, actions: 1, modelRequests: 1, diagnostics: { semanticActions: 1 } });
    expect(vi.mocked(f.driver.execute).mock.calls[0][1]).toEqual({ type: 'tap', point: [200, 300] });
  });

  it('grounds a standard coordinate action without requiring a new model action format', async () => {
    const f = fixture(async () => ({ kind: 'action', action: { type: 'tap', point: [110, 220] } }), { semanticControls: true });
    vi.mocked(f.driver.execute).mockImplementation(async () => { f.set(observation([element('Done')])); });
    await f.open();
    const result = await f.runtime.execute('reliability', { op: 'run', goal: 'Open Done', expectText: 'Done' }, f.context) as PhoneReport;
    expect(result).toMatchObject({ verified: true, actions: 1, modelRequests: 1, diagnostics: { semanticActions: 1 } });
    expect(vi.mocked(f.driver.execute).mock.calls[0][1]).toEqual({ type: 'tap', point: [200, 300] });
  });

  it('rejects an ambiguous semantic action without dispatch, then uses a new prediction', async () => {
    const f = fixture(async input => input.protocolFeedback || input.recoveryHint?.includes('semantic target was not dispatched')
      ? { kind: 'action', action: { type: 'tap', point: [200, 300] } }
      : { kind: 'action', action: { type: 'tapElement', frameId: input.observation.frameId, selector: { text: 'Initial' } } },
    { semanticControls: true });
    f.set(observation([element('Initial'), { ...element('Initial'), bounds: [500, 200, 700, 400] }]));
    vi.mocked(f.driver.execute).mockImplementation(async () => { f.set(observation([element('Done')])); });
    await f.open();
    const result = await f.runtime.execute('reliability', { op: 'run', goal: 'Open Done', expectText: 'Done' }, f.context) as PhoneReport;
    expect(result).toMatchObject({ verified: true, actions: 1, modelRequests: 2, diagnostics: { semanticRejections: 1 } });
    expect(f.driver.execute).toHaveBeenCalledOnce();
  });

  it('blocks semantic actions when the feature is disabled', async () => {
    const f = fixture(async input => ({ kind: 'action', action: { type: 'tapElement', frameId: input.observation.frameId,
      selector: { text: 'Initial' } } }));
    await f.open();
    await expect(f.runtime.execute('reliability', { op: 'run', goal: 'Open Done' }, f.context))
      .rejects.toMatchObject({ code: 'PHONE_SEMANTIC_DISABLED' });
    expect(f.driver.execute).not.toHaveBeenCalled();
  });

  it('passes an evidence-advanced plan to the next prediction without treating it as final success', async () => {
    const inputs: PhonePrediction[] = [];
    const f = fixture(async input => {
      inputs.push(structuredClone(input));
      return inputs.length === 1 ? { kind: 'action', action: { type: 'tap', point: [200, 300] } }
        : { kind: 'complete', summary: 'Still unfinished' };
    }, { hierarchicalPlanning: true });
    vi.mocked(f.driver.execute).mockImplementation(async () => { f.set(observation([element('Intermediate')])); });
    await f.open();
    const result = await f.runtime.execute('reliability', { op: 'run', goal: 'Open Done',
      completion: { textAny: ['Intermediate'], textAll: ['Done'] } }, f.context) as PhoneReport;
    expect(inputs[1].planning).toMatchObject({ currentStep: 1, verifiedSteps: 1 });
    expect(result).toMatchObject({ verified: false, diagnostics: { plannedSubgoals: 2, completedSubgoals: 1 } });
    expect(inputs[0].planning).toMatchObject({ currentStep: 0, verifiedSteps: 0 });
    expect(JSON.stringify(f.repository.history())).not.toContain('planning');
  });

  it('combines native tap grounding with focus, entry and final inspection phases in the existing request budget', async () => {
    const phases: number[] = [];
    const f = fixture(async input => {
      phases.push(input.planning!.currentStep);
      return phases.length === 1 ? { kind: 'action', action: { type: 'tap', point: [110, 220] } }
        : { kind: 'action', action: { type: 'typeText', text: 'query', mode: 'replace' } };
    }, { semanticControls: true, hierarchicalPlanning: true, modelRequests: 2 });
    const field = (value: string, focused: boolean) => ({ ...element(value, 'query'), editable: true, focused });
    f.set(observation([field('', false)]));
    vi.mocked(f.driver.execute).mockImplementation(async (_serial, action) => {
      f.set(observation([field(action.type === 'typeText' ? action.text : '', true),
        ...(action.type === 'typeText' ? [element('Result', 'result')] : [])]));
    });
    await f.open();
    const result = await f.runtime.execute('reliability', { op: 'run', goal: 'Search query', completion: {
      appPackage: 'com.test.editor', field: { resourceId: 'query', value: 'query' }, textAll: ['Result'],
    } }, f.context) as PhoneReport;
    expect(phases).toEqual([0, 1]);
    expect(result).toMatchObject({ verified: true, modelRequests: 2, actions: 2,
      diagnostics: { semanticActions: 1, plannedSubgoals: 3, completedSubgoals: 3 } });
  });

  it('passes dispatched parameters and observed effects to the next prediction without persisting input or page text', async () => {
    const inputs: Array<Pick<PhonePrediction, 'trajectory' | 'recoveryHint'>> = [];
    const predict = vi.fn<PhoneModelAdapter['predict']>(async input => {
      inputs.push(structuredClone({ trajectory: input.trajectory, recoveryHint: input.recoveryHint }));
      return inputs.length === 1 ? { kind: 'action', action: { type: 'typeText', text: 'private search query', mode: 'replace' } }
        : { kind: 'complete', summary: 'private completion summary' };
    });
    const f = fixture(predict);
    f.set(observation([{ ...element('old query', 'search'), editable: true, focused: true }]));
    vi.mocked(f.driver.execute).mockImplementation(async () => { f.set(observation([{ ...element('private search query', 'search'), editable: true, focused: true }])); });
    await f.open();
    const result = await f.runtime.execute('reliability', { op: 'run', goal: 'Replace search text' }, f.context) as PhoneReport;
    expect(inputs[1].trajectory).toEqual([expect.objectContaining({
      action: { type: 'typeText', text: 'private search query', mode: 'replace' }, dispatch: 'completed', effect: 'changed',
      beforeApp: 'com.test.editor', afterApp: 'com.test.editor', facts: ['private search query'],
    })]);
    expect(result.stopReason).toBe('model_finished_unverified');
    const persisted = JSON.stringify(f.repository.history());
    expect(persisted).not.toMatch(/private search query|private completion summary|old query|trajectory|synthetic-pixels/);
  });

  it('repairs a malformed response once, counts both requests and sends no input before valid output', async () => {
    const inputs: Array<string | undefined> = [];
    const predict = vi.fn<PhoneModelAdapter['predict']>(async input => {
      inputs.push(input.protocolFeedback);
      expect(input.completion).toMatchObject({ textAll: ['Done'] });
      expect(f.driver.execute).not.toHaveBeenCalled();
      if (inputs.length === 1) throw new PhoneError('PHONE_MODEL_TRUNCATED', 'Truncated output');
      return { kind: 'action', action: { type: 'tap', point: [200, 300] } };
    });
    const f = fixture(predict);
    vi.mocked(f.driver.execute).mockImplementation(async () => { f.set(observation([element('Done')])); });
    await f.open();
    const result = await f.runtime.execute('reliability', { op: 'run', goal: 'Open Done', expectText: 'Done' }, f.context) as PhoneReport;
    expect(result).toMatchObject({ verified: true, actions: 1, modelRequests: 2, diagnostics: { protocolRepairs: 1 } });
    expect(inputs[0]).toBeUndefined();
    expect(inputs[1]).toContain('invalid or truncated');
    expect(f.driver.execute).toHaveBeenCalledOnce();
  });

  it('does not make a third model request when the repair is also malformed', async () => {
    const predict = vi.fn<PhoneModelAdapter['predict']>(async () => { throw new PhoneError('PHONE_MODEL_PROTOCOL', 'Invalid output'); });
    const f = fixture(predict);
    await f.open();
    await expect(f.runtime.execute('reliability', { op: 'run', goal: 'Open Done' }, f.context)).rejects.toMatchObject({ code: 'PHONE_MODEL_PROTOCOL' });
    expect(predict).toHaveBeenCalledTimes(2);
    expect(f.runtime.status('reliability')).toMatchObject({ modelRequests: 2, diagnostics: { protocolRepairs: 1 } });
    expect(f.driver.execute).not.toHaveBeenCalled();
  });

  it('includes protocol repair requests in the configured model request limit', async () => {
    const predict = vi.fn<PhoneModelAdapter['predict']>(async () => { throw new PhoneError('PHONE_MODEL_PROTOCOL', 'Invalid output'); });
    const f = fixture(predict, { modelRequests: 1 });
    await f.open();
    await expect(f.runtime.execute('reliability', { op: 'run', goal: 'Open Done' }, f.context)).rejects.toMatchObject({ code: 'PHONE_MODEL_PROTOCOL' });
    expect(predict).toHaveBeenCalledOnce();
    expect(f.driver.execute).not.toHaveBeenCalled();
  });

  it('requires package, any-text, all-text, exact field value and a changed screen together', async () => {
    const f = fixture(async () => ({ kind: 'action', action: { type: 'tap', point: [200, 300] } }));
    const screen = (value: string, app: string) => observation([
      element('Saved'), element('编辑器'), { ...element(value, 'title-input'), editable: true },
    ], app);
    f.set(screen('Correct title', 'com.test.other'));
    let actions = 0;
    vi.mocked(f.driver.execute).mockImplementation(async () => { actions++; f.set(screen(actions === 1 ? 'Wrong title' : 'Correct title', 'com.test.editor')); });
    await f.open();
    const result = await f.runtime.execute('reliability', { op: 'run', goal: 'Set title', completion: {
      appPackage: 'com.test.editor', textAny: ['Editor', '编辑器'], textAll: ['Saved'],
      field: { resourceId: 'title-input', value: 'Correct title' }, requireChange: true,
    } }, f.context) as PhoneReport;
    expect(result).toMatchObject({ verified: true, actions: 2, stopReason: 'condition_satisfied' });
  });

  it('clears the previous UI verification level when a later goal remains unverified', async () => {
    const f = fixture(async () => ({ kind: 'complete', summary: 'Unfinished second goal' }));
    f.set(observation([element('Saved')]));
    await f.open();
    expect(await f.runtime.execute('reliability', { op: 'run', goal: 'Find Saved', expectText: 'Saved' }, f.context))
      .toMatchObject({ verified: true, verificationLevel: 'ui' });
    expect(await f.runtime.execute('reliability', { op: 'run', goal: 'Make another change',
      completion: { textAll: ['Saved'], requireChange: true } }, f.context))
      .toMatchObject({ status: 'paused', verified: false, verificationLevel: 'none', stopReason: 'completion_unmet' });
  });

  it('does not verify an initially existing condition when a state change is required', async () => {
    const predict = vi.fn<PhoneModelAdapter['predict']>(async () => ({ kind: 'complete', summary: 'Already visible' }));
    const f = fixture(predict);
    f.set(observation([element('Saved')]));
    await f.open();
    const result = await f.runtime.execute('reliability', { op: 'run', goal: 'Save a new item', completion: { textAll: ['Saved'], requireChange: true } }, f.context) as PhoneReport;
    expect(result).toMatchObject({ status: 'paused', verified: false, stopReason: 'completion_unmet', modelRequests: 3 });
  });

  it('checks completion against native nodes beyond the 60 display facts', async () => {
    const predict = vi.fn<PhoneModelAdapter['predict']>();
    const f = fixture(predict);
    f.set(observation([...Array.from({ length: 70 }, (_, index) => element(`Row ${index}`)), element('Target beyond preview')]));
    await f.open();
    const result = await f.runtime.execute('reliability', { op: 'run', goal: 'Find target', expectText: 'Target beyond preview' }, f.context) as PhoneReport;
    expect(result).toMatchObject({ verified: true, stopReason: 'condition_present', modelRequests: 0 });
    expect(result.facts).toHaveLength(60);
    expect(result.facts).not.toContain('Target beyond preview');
    expect(predict).not.toHaveBeenCalled();
  });

  it('does not verify a completion match that disappears during confirmation', async () => {
    const predict = vi.fn<PhoneModelAdapter['predict']>(async () => ({ kind: 'complete', summary: 'No stable evidence' }));
    const f = fixture(predict);
    vi.mocked(f.driver.observe)
      .mockResolvedValueOnce(observation([element('Saved')]))
      .mockResolvedValue(observation([element('Still editing')]));
    await f.open();
    const result = await f.runtime.execute('reliability', { op: 'run', goal: 'Save item', expectText: 'Saved' }, f.context) as PhoneReport;
    expect(result).toMatchObject({ status: 'paused', verified: false, facts: ['Still editing'], stopReason: 'completion_unmet' });
    expect(f.driver.observe).toHaveBeenCalledTimes(5);
    expect(f.driver.execute).not.toHaveBeenCalled();
    expect(predict).toHaveBeenCalledTimes(3);
  });

  it('corrects one premature completion claim using fresh evidence and the unmet criteria', async () => {
    const inputs: Array<{ texts: string[]; recoveryHint?: string }> = [];
    const predict = vi.fn<PhoneModelAdapter['predict']>(async input => {
      inputs.push({ texts: input.observation.elements.map(node => node.text), recoveryHint: input.recoveryHint });
      if (inputs.length === 1) {
        f.set(observation([element('Fresh state')]));
        return { kind: 'complete', summary: 'Premature completion' };
      }
      return { kind: 'action', action: { type: 'tap', point: [200, 300] } };
    });
    const f = fixture(predict);
    vi.mocked(f.driver.execute).mockImplementation(async () => { f.set(observation([element('Done')])); });
    await f.open();
    const result = await f.runtime.execute('reliability', { op: 'run', goal: 'Reach Done', expectText: 'Done' }, f.context) as PhoneReport;
    expect(result).toMatchObject({ verified: true, actions: 1, modelRequests: 2, diagnostics: { completionCorrections: 1 } });
    expect(inputs[1].texts).toEqual(['Fresh state']);
    expect(inputs[1].recoveryHint).toContain('Done');
    expect(f.driver.execute).toHaveBeenCalledOnce();
  });

  it('prevents content-versus-field confusion without another request or generated input', async () => {
    const inputs: PhonePrediction[] = [];
    const f = fixture(async input => { inputs.push(input); return { kind: 'needsUser', reason: 'Inspect first' }; });
    f.set(observation([element('target.txt')])); await f.open();
    const result = await f.runtime.execute('reliability', { op: 'run', goal: 'Search for target', completion: { field: { resourceId: 'query', value: 'target' } } }, f.context) as PhoneReport;
    expect(inputs[0].recoveryHint).toContain('Native completion: NOT MET');
    expect(result).toMatchObject({ status: 'needs_user', modelRequests: 1, diagnostics: { completionCorrections: 0 } });
    expect(f.driver.execute).not.toHaveBeenCalled();
  });

  it('bounds repeated completion corrections and pauses without a read-only model call', async () => {
    const predict = vi.fn<PhoneModelAdapter['predict']>(async () => ({ kind: 'complete', summary: 'Premature completion' }));
    const readScreen = vi.fn();
    const f = fixture(predict, { readScreen });
    await f.open();
    const result = await f.runtime.execute('reliability', { op: 'run', goal: 'Reach Done', completion: { textAll: ['Done'] } }, f.context) as PhoneReport;
    expect(result).toMatchObject({ status: 'paused', verified: false, stopReason: 'completion_unmet', errorCode: 'PHONE_COMPLETION_UNMET', modelRequests: 3,
      controlOwner: 'none', diagnostics: { completionCorrections: 2 } });
    expect(predict).toHaveBeenCalledTimes(3); expect(readScreen).not.toHaveBeenCalled();
    expect(result.feedback).toMatchObject({ outcome: 'blocked', nextAction: 'inspect', verified: false });
    expect(f.driver.execute).not.toHaveBeenCalled();
  });

  it('recovers after two premature finishes and dispatches only the model-requested action', async () => {
    const inputs: PhonePrediction[] = [];
    const predict = vi.fn<PhoneModelAdapter['predict']>(async input => {
      inputs.push(input);
      return inputs.length < 3 ? { kind: 'complete', summary: 'Done' }
        : { kind: 'action', action: { type: 'tap', point: [200, 300] } };
    });
    const f = fixture(predict);
    vi.mocked(f.driver.execute).mockImplementation(async () => { f.set(observation([element('Done')])); });
    await f.open();
    const result = await f.runtime.execute('reliability', { op: 'run', goal: 'Reach Done', expectText: 'Done' }, f.context) as PhoneReport;
    expect(result).toMatchObject({ verified: true, actions: 1, modelRequests: 3, diagnostics: { completionCorrections: 2 } });
    expect(inputs[0].recoveryHint).toBeUndefined();
    expect(inputs[2].recoveryHint).toContain('Completion rejected (2/2)');
    expect(f.driver.execute).toHaveBeenCalledOnce();
  });

  it('confirms a delayed UI update after finish without another model call', async () => {
    const predict = vi.fn<PhoneModelAdapter['predict']>(async () => {
      f.set(observation([element('Done')])); return { kind: 'complete', summary: 'Done' };
    });
    const f = fixture(predict, { modelRequests: 1 });
    await f.open();
    const result = await f.runtime.execute('reliability', { op: 'run', goal: 'Reach Done', expectText: 'Done' }, f.context) as PhoneReport;
    expect(result).toMatchObject({ verified: true, modelRequests: 1, diagnostics: { completionCorrections: 0 } });
    expect(f.driver.execute).not.toHaveBeenCalled(); expect(f.driver.observe).toHaveBeenCalledTimes(3);
  });

  it('honors takeover requests rather than correcting them into actions', async () => {
    const readScreen = vi.fn();
    const f = fixture(async () => ({ kind: 'needsUser', reason: 'Please sign in' }), { readScreen });
    await f.open();
    const result = await f.runtime.execute('reliability', { op: 'run', goal: 'Reach Done', expectText: 'Done' }, f.context) as PhoneReport;
    expect(result).toMatchObject({ status: 'needs_user', modelRequests: 1, diagnostics: { completionCorrections: 0 } });
    expect(f.driver.execute).not.toHaveBeenCalled(); expect(readScreen).not.toHaveBeenCalled();
  });

  it.each([1, 2])('does not exceed a %i-request budget to correct unmet completion', async modelRequests => {
    const predict = vi.fn<PhoneModelAdapter['predict']>(async () => ({ kind: 'complete', summary: 'Premature completion' }));
    const f = fixture(predict, { modelRequests });
    await f.open();
    const result = await f.runtime.execute('reliability', { op: 'run', goal: 'Reach Done', expectText: 'Done' }, f.context) as PhoneReport;
    expect(result).toMatchObject({ status: 'paused', verified: false, stopReason: 'completion_unmet', modelRequests,
      diagnostics: { completionCorrections: modelRequests - 1 } });
    expect(predict).toHaveBeenCalledTimes(modelRequests);
    expect(f.driver.execute).not.toHaveBeenCalled();
  });

  it('does not verify or correct after cancellation during the post-finish observation', async () => {
    const predict = vi.fn<PhoneModelAdapter['predict']>(async () => ({ kind: 'complete', summary: 'Done' }));
    const f = fixture(predict); let release!: (value: PhoneObservation) => void;
    vi.mocked(f.driver.observe).mockResolvedValueOnce(observation([element('Initial')]))
      .mockImplementationOnce(async () => new Promise(resolve => { release = resolve; }));
    await f.open(); const controller = new AbortController();
    const running = f.runtime.execute('reliability', { op: 'run', goal: 'Reach Done', expectText: 'Done' }, f.context, controller.signal);
    await vi.waitFor(() => expect(release).toBeTypeOf('function'));
    const rejected = expect(running).rejects.toMatchObject({ code: 'PHONE_CANCELLED' });
    controller.abort(); release(observation([element('Done')])); await rejected;
    expect(predict).toHaveBeenCalledOnce(); expect(f.driver.execute).not.toHaveBeenCalled();
    expect(f.runtime.status('reliability')?.verified).toBe(false);
  });

  it('rejects an out-of-scope app reached during completion reobservation', async () => {
    const predict = vi.fn<PhoneModelAdapter['predict']>(async () => {
      f.set(observation([element('Done')], 'com.forbidden.app')); return { kind: 'complete', summary: 'Done' };
    });
    const f = fixture(predict); await f.open();
    await expect(f.runtime.execute('reliability', { op: 'run', goal: 'Reach Done', expectText: 'Done' }, f.context)).rejects.toMatchObject({ code: 'PHONE_APP_DENIED' });
    expect(predict).toHaveBeenCalledOnce(); expect(f.driver.execute).not.toHaveBeenCalled();
  });

  it('does not verify after caller cancellation while confirmation is in flight', async () => {
    const predict = vi.fn<PhoneModelAdapter['predict']>();
    const f = fixture(predict);
    let release!: (screen: PhoneObservation) => void;
    vi.mocked(f.driver.observe)
      .mockResolvedValueOnce(observation([element('Saved')]))
      .mockImplementationOnce(async () => new Promise(resolve => { release = resolve; }));
    await f.open();
    const controller = new AbortController();
    const running = f.runtime.execute('reliability', { op: 'run', goal: 'Save item', expectText: 'Saved' }, f.context, controller.signal);
    await vi.waitFor(() => expect(release).toBeTypeOf('function'));
    const rejected = expect(running).rejects.toMatchObject({ code: 'PHONE_CANCELLED' });
    controller.abort();
    release(observation([element('Saved')]));
    await rejected;
    expect(f.runtime.status('reliability')).toMatchObject({ verified: false, status: 'ready', controlOwner: 'none', errorCode: 'PHONE_CANCELLED' });
    expect(f.driver.execute).not.toHaveBeenCalled();
    expect(predict).not.toHaveBeenCalled();
  });

  it('discards a matching confirmation when the user pauses and takes the control epoch', async () => {
    const predict = vi.fn<PhoneModelAdapter['predict']>();
    const f = fixture(predict);
    let release!: (screen: PhoneObservation) => void;
    vi.mocked(f.driver.observe)
      .mockResolvedValueOnce(observation([element('Saved')]))
      .mockImplementationOnce(async () => new Promise(resolve => { release = resolve; }));
    await f.open();
    const running = f.runtime.execute('reliability', { op: 'run', goal: 'Save item', expectText: 'Saved' }, f.context);
    await vi.waitFor(() => expect(release).toBeTypeOf('function'));
    const report = f.runtime.status('reliability')!;
    const paused = f.runtime.liveControl('reliability', report.sessionId, f.context, 'browser',
      { op: 'pause', epoch: report.controlEpoch!, operationId: randomUUID() });
    await vi.waitFor(() => expect(f.runtime.status('reliability')).toMatchObject({ handoff: 'acquiring', controlOwner: 'none' }));
    release(observation([element('Saved')]));
    await paused;
    expect(f.runtime.status('reliability')).toMatchObject({ verified: false, status: 'paused', controlOwner: 'none' });
    expect(predict).not.toHaveBeenCalled();
    const rejected = expect(running).rejects.toMatchObject({ code: 'PHONE_CANCELLED' });
    await f.runtime.stop('reliability', 'cancel');
    await rejected;
  });

  it('rechecks device authorization after a matching confirmation observation', async () => {
    const predict = vi.fn<PhoneModelAdapter['predict']>();
    const f = fixture(predict);
    let release!: (screen: PhoneObservation) => void;
    vi.mocked(f.driver.observe)
      .mockResolvedValueOnce(observation([element('Saved')]))
      .mockImplementationOnce(async () => new Promise(resolve => { release = resolve; }));
    await f.open();
    const running = f.runtime.execute('reliability', { op: 'run', goal: 'Save item', expectText: 'Saved' }, f.context);
    await vi.waitFor(() => expect(release).toBeTypeOf('function'));
    const device = f.repository.list()[0];
    f.repository.save({ serial: device.serial, name: device.name, enabled: false, allowedApps: device.allowedApps }, device.id);
    const rejected = expect(running).rejects.toMatchObject({ code: 'PHONE_ACCESS_CHANGED' });
    release(observation([element('Saved')]));
    await rejected;
    expect(f.runtime.status('reliability')).toMatchObject({ verified: false, status: 'failed' });
    expect(predict).not.toHaveBeenCalled();
  });
});


it('clears adapter state written by a late prediction after cancellation and never dispatches it', async () => {
  let finish!: () => void; let retained = false;
  const predict = vi.fn<PhoneModelAdapter['predict']>(async () => {
    await new Promise<void>(resolve => { finish = resolve; }); retained = true;
    return { kind: 'action', action: { type: 'tap', point: [200, 300] } };
  });
  const f = fixture(predict, { reset: () => { retained = false; } }); await f.open();
  const pending = f.runtime.execute('reliability', { op: 'run', goal: 'Inspect', maxActions: 6 }, f.context).catch(error => error);
  await vi.waitFor(() => expect(predict).toHaveBeenCalledOnce());
  const stopped = f.runtime.stop('reliability', 'pause'); finish();
  await stopped; await pending;
  expect(retained).toBe(false); expect(f.driver.execute).not.toHaveBeenCalled();
});
