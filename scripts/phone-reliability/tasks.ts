import { randomUUID } from 'node:crypto';

import { ConfigSchema } from '../../src/config/schema.js';
import { closeXopcDatabase, openXopcDatabase } from '../../src/storage/sqlite/connection.js';
import type { PhoneDriver } from '../../src/phone/adb-driver.js';
import { PhoneError, type PhoneElement, type PhoneObservation, type PhoneReport } from '../../src/phone/contracts.js';
import type { PhoneModelAdapter } from '../../src/phone/model-adapter.js';
import { PhoneRepository } from '../../src/phone/repository.js';
import { PhoneRuntime } from '../../src/phone/runtime.js';

type Task = { id: string; category: 'completion' | 'guard'; actions?: number; noise?: boolean; hazard?: 'movement' | 'overlay' | 'no-progress' | 'unknown' | 'product-change' | 'recipient-change' };
export const reliabilityTasks: Task[] = [
  { id: 'stable-single-stage', category: 'completion', actions: 1 },
  { id: 'stable-two-stage', category: 'completion', actions: 2 },
  { id: 'stable-three-stage', category: 'completion', actions: 3 },
  { id: 'system-clock-single-stage', category: 'completion', actions: 1, noise: true },
  { id: 'system-clock-two-stage', category: 'completion', actions: 2, noise: true },
  { id: 'system-clock-three-stage', category: 'completion', actions: 3, noise: true },
  { id: 'moving-target', category: 'guard', hazard: 'movement' },
  { id: 'new-target-overlay', category: 'guard', hazard: 'overlay' },
  { id: 'repeated-no-progress', category: 'guard', hazard: 'no-progress' },
  { id: 'system-clock-no-progress', category: 'guard', hazard: 'no-progress', noise: true },
  { id: 'unknown-dispatch', category: 'guard', hazard: 'unknown' },
  { id: 'changed-product-title', category: 'guard', hazard: 'product-change' },
  { id: 'changed-message-recipient', category: 'guard', hazard: 'recipient-change' },
];

export type ReliabilityResult = {
  task: string; category: Task['category']; passed: boolean; completed: boolean;
  actions: number; modelRequests: number; observations: number; status?: string; stopReason?: string; errorCode?: string;
};

/** Uses production orchestration with a simulated device and scripted (non-LLM) policy. */
export async function runReliabilityTask(task: Task, Runtime: typeof PhoneRuntime = PhoneRuntime): Promise<ReliabilityResult> {
  closeXopcDatabase(); openXopcDatabase({ path: ':memory:' });
  const repository = new PhoneRepository();
  const device = repository.save({ serial: 'reliability-simulation', name: 'Synthetic task device', enabled: true, allowedApps: ['com.xopc.benchmark'] });
  repository.setDefault(device.id);
  let stage = 0; let observations = 0; let dispatches = 0;
  const node = (text: string, resourceId: string, bounds: PhoneElement['bounds'], clickable = false): PhoneElement =>
    ({ text, description: '', resourceId, bounds, clickable, focused: false, password: false });
  const driver: PhoneDriver = {
    discover: async () => [{ serial: device.serial, name: device.name, state: 'device', emulator: true }],
    observe: async (): Promise<PhoneObservation> => {
      observations++;
      const shift = task.hazard === 'movement' && observations % 2 === 0 ? 150 : 0;
      const label = task.hazard === 'product-change' ? 'Buy' : task.hazard === 'recipient-change' ? 'Send' : 'Continue';
      const elements = [node(stage >= (task.actions ?? Infinity) ? 'TASK COMPLETE' : `Stage ${stage}`, 'stage', [0, 0, 1000, 100]),
        node(label, 'continue', [100 + shift, 200, 300 + shift, 400], true),
        node(task.noise ? `12:00:${String(observations % 60).padStart(2, '0')}` : 'Unrelated content', task.noise ? 'com.android.systemui:id/clock' : 'noise', task.noise ? [850, 0, 1000, 30] : [0, 800, 1000, 950])];
      if (task.hazard === 'product-change' || task.hazard === 'recipient-change') {
        const subject = task.hazard === 'product-change' ? 'Product' : 'Recipient';
        elements.push(node(`${subject} ${observations % 2 === 0 ? 'B' : 'A'}`, 'subject-heading', [0, 110, 1000, 180]));
      }
      if (task.hazard === 'overlay' && observations % 2 === 0) elements.push(node('Modal overlay', 'overlay', [50, 150, 500, 450], true));
      return { frameId: randomUUID(), capturedAt: Date.now(), width: 1000, height: 1000, rotation: 0,
        package: 'com.xopc.benchmark', frame: Buffer.from(`simulated-frame-${observations}`), elements };
    },
    execute: async () => {
      dispatches++;
      if (task.hazard === 'unknown') throw new PhoneError('PHONE_ADB_FAILED', 'Simulated transport lost after dispatch');
      if (!task.hazard) stage++;
    },
  };
  const adapter: PhoneModelAdapter = { predict: async () => ({ kind: 'action', action: { type: 'tap', point: [200, 300] } }) };
  const runtime = new Runtime(repository, () => driver, async () => adapter);
  const context = { config: ConfigSchema.parse({ phone: { enabled: true, maxModelRequests: 12 } }), agentId: 'main', modelRef: 'synthetic/scripted-policy' };
  let report: PhoneReport | undefined;
  let errorCode: string | undefined;
  try {
    await runtime.execute('benchmark', { op: 'open', mode: 'control' }, context);
    try { report = await runtime.execute('benchmark', { op: 'run', goal: `Complete synthetic ${task.id}`, expectText: 'TASK COMPLETE', maxActions: 6 }, context) as PhoneReport; }
    catch (error) { errorCode = error instanceof PhoneError ? error.code : 'UNEXPECTED_ERROR'; report = runtime.status('benchmark'); }
    const completed = !task.hazard && stage === task.actions && report?.verified === true;
    const passed = task.category === 'completion' ? completed
      : task.hazard === 'unknown' ? dispatches === 1 && report?.status === 'outcome_unknown'
        : task.hazard === 'no-progress' ? dispatches <= 3 && report?.stopReason === 'no_progress'
          : dispatches === 0;
    return { task: task.id, category: task.category, passed, completed, actions: dispatches, modelRequests: report?.modelRequests ?? 0,
      observations, status: report?.status, stopReason: report?.stopReason, errorCode: errorCode ?? report?.errorCode };
  } finally { await runtime.shutdown(); closeXopcDatabase(); }
}

export async function runReliabilitySuite(Runtime: typeof PhoneRuntime = PhoneRuntime, repeats = 3) {
  const results: Array<ReliabilityResult & { repeat: number }> = [];
  for (let repeat = 1; repeat <= repeats; repeat++) for (const task of reliabilityTasks) results.push({ ...await runReliabilityTask(task, Runtime), repeat });
  const completion = results.filter(result => result.category === 'completion');
  const guards = results.filter(result => result.category === 'guard');
  return { completion: { passed: completion.filter(result => result.passed).length, total: completion.length },
    guards: { passed: guards.filter(result => result.passed).length, total: guards.length },
    modelRequests: results.reduce((total, result) => total + result.modelRequests, 0), results };
}
