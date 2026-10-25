import { randomUUID } from 'node:crypto';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ConfigSchema } from '../../config/schema.js';
import { closeXopcDatabase, openXopcDatabase } from '../../storage/sqlite/connection.js';
import type { PhoneDriver } from '../adb-driver.js';
import { PhoneError, type PhoneElement, type PhoneObservation, type PhoneReport } from '../contracts.js';
import type { PhoneModelAdapter } from '../model-adapter.js';
import { PhoneRepository } from '../repository.js';
import { PhoneRuntime } from '../runtime.js';

const APP = 'com.example.clock';
const OWNER = 'numeric-runtime';
const runtimes: PhoneRuntime[] = [];
beforeEach(() => { closeXopcDatabase(); openXopcDatabase({ path: ':memory:' }); });
afterEach(async () => { await Promise.all(runtimes.splice(0).map(runtime => runtime.shutdown())); closeXopcDatabase(); });

function node(id: string, text: string, bounds: PhoneElement['bounds'], clickable = true): PhoneElement {
  return { resourceId: `${APP}:id/${id}`, text, description: '', clickable, focused: false, password: false, bounds };
}
function keypad(value: string): PhoneElement[] {
  return [node('timer_setup_time', value, [100, 100, 900, 200], false),
    node('timer_setup_delete', 'Backspace', [700, 400, 750, 450]),
    ...Array.from({ length: 10 }, (_, index) => node(`timer_setup_digit_${index}`, String(index), [100 + index * 60, 400, 150 + index * 60, 450]))];
}
function format(value: string): string {
  const text = value.padStart(6, '0');
  return `${text.slice(0, 2)}h ${text.slice(2, 4)}m ${text.slice(4, 6)}s`;
}

function fixture(options: { enabled?: boolean; semantic?: boolean; target?: string; wrongDigit?: boolean; unknownDigit?: boolean; modelOnlyDigit?: boolean; delayedFeedback?: boolean } = {}) {
  const repository = new PhoneRepository();
  const device = repository.save({ serial: 'synthetic-clock', name: 'Synthetic Clock', enabled: true, allowedApps: [APP] });
  repository.setDefault(device.id);
  let inSetup = false; let entered = ''; let numericDispatches = 0;
  let delayedReads = options.delayedFeedback ? 1 : 0;
  let holdCapture = false; let releaseCapture: ((observation: PhoneObservation) => void) | undefined;
  const snapshots: Array<{ value: string; frameId: string }> = [];
  const target = options.target ?? '00h 02m 30s';
  const current = (): PhoneObservation => ({ frameId: randomUUID(), capturedAt: Date.now(), width: 1000, height: 1000,
    rotation: 0, package: APP, frame: Buffer.from('synthetic-clock-pixels'),
    elements: inSetup ? keypad(format(entered)) : [node('tab_menu_timer', 'Timer', [50, 50, 150, 150])] });
  const observedValues: string[] = [];
  const driver: PhoneDriver = {
    discover: async () => [{ serial: device.serial, state: 'device', name: device.name, emulator: true }],
    observe: vi.fn(async () => {
      const observation = current();
      if (numericDispatches === 1 && delayedReads > 0) { observation.elements[0].text = '00h 00m 00s'; delayedReads--; }
      observedValues.push(inSetup ? observation.elements[0].text : 'Alarm');
      if (holdCapture && numericDispatches === 1 && !releaseCapture)
        return new Promise<PhoneObservation>(resolve => { releaseCapture = resolve; });
      return observation;
    }),
    execute: vi.fn(async (_serial, action, observation) => {
      if (action.type !== 'tap') throw new Error('Only stopped keypad taps are expected');
      if (!inSetup) { inSetup = true; return; }
      const [x, y] = action.point;
      const hit = observation.elements.find(element => element.clickable && element.bounds[0] <= x && x < element.bounds[2]
        && element.bounds[1] <= y && y < element.bounds[3]);
      expect(hit).toBeDefined();
      snapshots.push({ value: format(entered), frameId: observation.frameId });
      numericDispatches++;
      if (options.unknownDigit) throw new PhoneError('PHONE_DISPATCH_UNKNOWN', 'Synthetic unacknowledged key');
      if (hit!.resourceId.endsWith('_delete')) entered = entered.slice(0, -1);
      else entered += options.wrongDigit ? `${hit!.text}${hit!.text}` : hit!.text;
    }),
  };
  const predict = vi.fn<PhoneModelAdapter['predict']>(async () => ({ kind: 'action', action: { type: 'tap',
    point: options.modelOnlyDigit && inSetup ? [665, 425] : [100, 100] } }));
  const runtime = new PhoneRuntime(repository, () => driver, async () => ({ predict })); runtimes.push(runtime);
  const context = { agentId: 'main', modelRef: 'test/clock-model', config: ConfigSchema.parse({ phone: { enabled: true,
    hierarchicalPlanning: options.enabled ?? true, semanticControls: options.semantic ?? false,
    maxModelRequests: options.modelOnlyDigit ? 4 : 1 } }) };
  const input = (maxActions = 12) => ({ op: 'run' as const, goal: `Open Timer and enter the duration ${target}. Do not start the timer.`,
    completion: { appPackage: APP, textAll: [target] }, maxActions });
  return { driver, predict, runtime, context, target, snapshots, observedValues,
    numericDispatches: () => numericDispatches,
    hold: () => { holdCapture = true; },
    release: () => { if (!releaseCapture) throw new Error('Capture is not pending'); releaseCapture(current()); },
    capturePending: () => Boolean(releaseCapture),
    open: () => runtime.execute(OWNER, { op: 'open', mode: 'control' }, context),
    run: (maxActions = 12, signal?: AbortSignal) => runtime.execute(OWNER, input(maxActions), context, signal) as Promise<PhoneReport>,
  };
}

describe('phone runtime native numeric entry', () => {
  it.each([false, true])('uses one model navigation and verifies each native keypad action (semantic=%s)', async semantic => {
    const f = fixture({ semantic }); await f.open();
    const report = await f.run();
    expect(report).toMatchObject({ verified: true, actions: 4, modelRequests: 1,
      diagnostics: { numericActions: 3, numericConfirmedSteps: 3 } });
    expect(f.predict).toHaveBeenCalledOnce();
    expect(f.snapshots.map(snapshot => snapshot.value)).toEqual(['00h 00m 00s', '00h 00m 02s', '00h 00m 23s']);
    expect(new Set(f.snapshots.map(snapshot => snapshot.frameId)).size).toBe(3);
    expect(f.observedValues.filter(value => value === f.target).length).toBeGreaterThanOrEqual(2);
    expect(f.driver.execute).toHaveBeenCalledTimes(4);
  });

  it('configures an arbitrary hour/minute/second duration without an additional model call', async () => {
    const f = fixture({ target: '01h 05m 09s' }); await f.open();
    const report = await f.run();
    expect(report).toMatchObject({ verified: true, actions: 6, modelRequests: 1,
      diagnostics: { numericActions: 5, numericConfirmedSteps: 5 } });
    expect(f.snapshots.map(snapshot => snapshot.value)).toEqual(['00h 00m 00s', '00h 00m 01s', '00h 00m 10s', '00h 01m 05s', '00h 10m 50s']);
  });

  it('pauses after unexpected acknowledged digit feedback and bounded reads without another key', async () => {
    const f = fixture({ wrongDigit: true }); await f.open();
    const report = await f.run();
    expect(report).toMatchObject({ verified: false, status: 'paused', stopReason: 'numeric_state_mismatch', actions: 2,
      modelRequests: 1, diagnostics: { numericActions: 1, numericMismatches: 1 } });
    expect(f.numericDispatches()).toBe(1);
    expect(f.observedValues.filter(value => value === '00h 00m 22s')).toHaveLength(3);
    expect(f.driver.execute).toHaveBeenCalledTimes(2);
  });

  it('waits for delayed native feedback without resending the acknowledged key', async () => {
    const f = fixture({ delayedFeedback: true }); await f.open();
    const report = await f.run();
    expect(report).toMatchObject({ verified: true, actions: 4, modelRequests: 1,
      diagnostics: { numericActions: 3, numericConfirmedSteps: 3 } });
    expect(f.snapshots.map(snapshot => snapshot.value)).toEqual(['00h 00m 00s', '00h 00m 02s', '00h 00m 23s']);
    expect(f.numericDispatches()).toBe(3);
  });

  it('never retries a key with an unknown dispatch outcome', async () => {
    const f = fixture({ unknownDigit: true }); await f.open();
    await expect(f.run()).rejects.toMatchObject({ code: 'PHONE_DISPATCH_UNKNOWN' });
    expect(f.runtime.status(OWNER)).toMatchObject({ verified: false, status: 'outcome_unknown', actions: 2, modelRequests: 1 });
    expect(f.driver.execute).toHaveBeenCalledTimes(2);
    expect(f.numericDispatches()).toBe(1);
  });

  it('stops at the shared action budget while preserving the confirmed partial entry', async () => {
    const f = fixture(); await f.open();
    const report = await f.run(2);
    expect(report).toMatchObject({ verified: false, status: 'ready', stopReason: 'action_limit', actions: 2, modelRequests: 1,
      diagnostics: { numericActions: 1, numericConfirmedSteps: 1 } });
    expect(f.driver.execute).toHaveBeenCalledTimes(2);
  });

  it('leaves keypad choices to the model when hierarchical execution is disabled', async () => {
    const f = fixture({ enabled: false, modelOnlyDigit: true }); await f.open();
    const report = await f.run(2);
    expect(report).toMatchObject({ verified: false, stopReason: 'action_limit', actions: 2, modelRequests: 2 });
    expect(report.diagnostics?.numericActions).toBeUndefined();
    expect(f.observedValues).toContain('00h 00m 09s');
  });

  it('does not send another digit if cancellation arrives during feedback observation', async () => {
    const f = fixture(); f.hold(); await f.open();
    const controller = new AbortController(); const running = f.run(12, controller.signal);
    await vi.waitFor(() => expect(f.capturePending()).toBe(true));
    const rejected = expect(running).rejects.toMatchObject({ code: 'PHONE_CANCELLED' });
    controller.abort(); f.release(); await rejected;
    expect(f.runtime.status(OWNER)).toMatchObject({ verified: false, status: 'ready', controlOwner: 'none', errorCode: 'PHONE_CANCELLED', actions: 2, modelRequests: 1 });
    expect(f.numericDispatches()).toBe(1);
  });

  it('holds pending verification when the control epoch changes and sends no digit under paused ownership', async () => {
    const f = fixture(); f.hold(); await f.open();
    const running = f.run(); await vi.waitFor(() => expect(f.capturePending()).toBe(true));
    const report = f.runtime.status(OWNER)!;
    const pausing = f.runtime.liveControl(OWNER, report.sessionId, f.context, 'browser', {
      op: 'pause', epoch: report.controlEpoch!, operationId: randomUUID(),
    });
    await vi.waitFor(() => expect(f.runtime.status(OWNER)).toMatchObject({ controlOwner: 'none', handoff: 'acquiring' }));
    f.release(); await pausing;
    expect(f.runtime.status(OWNER)).toMatchObject({ status: 'paused', verified: false, actions: 2 });
    expect(f.numericDispatches()).toBe(1);
    const rejected = expect(running).rejects.toMatchObject({ code: 'PHONE_CANCELLED' });
    await f.runtime.execute(OWNER, { op: 'cancel' }, f.context); await rejected;
    expect(f.numericDispatches()).toBe(1);
  });
});
