/** Deterministic request/capture counts only; this does not measure real phone or model latency. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';

import { ConfigSchema } from '../src/config/schema.js';
import { openXopcDatabase, closeXopcDatabase } from '../src/storage/sqlite/connection.js';
import { PhoneRepository } from '../src/phone/repository.js';
import { PhoneRuntime } from '../src/phone/runtime.js';
import type { PhoneDriver } from '../src/phone/adb-driver.js';
import type { PhoneReport, PhoneObservation, PhoneInput } from '../src/phone/contracts.js';
import { loadBaseline, sourceHashes } from './phone-apps-live/support.js';

const option = (name: string) => process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined;
const baseline = option('--baseline-dir');
const output = option('--output');
assert(baseline && output, 'Pass --baseline-dir and --output');
const root = resolve('.');
const modules = await mkdtemp(join(root, '.phone-output-benchmark-'));
const products = Object.fromEntries(Array.from({ length: 5 }, (_, i) => [`product${i + 1}`, `Glasses ${i + 1}: ¥${i + 100}`]));
const rows: Array<Record<string, unknown>> = [];
try {
  const previous = await loadBaseline(root, resolve(baseline), modules);
  for (const arm of ['baseline', 'optimized'] as const) {
    for (const scenario of ['verified-top5', 'model-finished-top5', 'scroll-top5'] as const) {
      closeXopcDatabase(); openXopcDatabase({ path: ':memory:' });
      const repository = new PhoneRepository();
      const device = repository.save({ name: 'Synthetic benchmark', serial: 'synthetic-phone', enabled: true, allowedApps: ['com.test.shop'] });
      repository.setDefault(device.id);
      let observations = 0; let fieldReads = 0; let genericReads = 0;
      const driver: PhoneDriver = {
        discover: async () => [{ name: device.name, serial: device.serial, state: 'device', emulator: true }],
        observe: async (): Promise<PhoneObservation> => {
          observations++;
          return { frameId: randomUUID(), capturedAt: Date.now(), width: 1000, height: 1000, rotation: 0,
            package: 'com.test.shop', frame: Buffer.from('synthetic-pixels'), elements: [{ text: 'Results', description: '', resourceId: 'title',
              bounds: [0, 0, 200, 100], clickable: false, focused: false, password: false }] };
        },
        execute: async () => {},
      };
      const Runtime = arm === 'baseline' ? previous.runtime.PhoneRuntime : PhoneRuntime;
      const runtime = new Runtime(repository, () => driver, async () => ({
        predict: async () => scenario === 'scroll-top5'
          ? { kind: 'action', action: { type: 'swipe', start: [500, 800], end: [500, 200], durationMs: 200 } }
          : { kind: 'complete', summary: 'At results' },
        readFields: async () => { fieldReads++; return products; },
        readScreen: async () => { genericReads++; return 'Synthetic product'; },
      }));
      // Parse each arm's own defaults so the former opt-in and new default are compared honestly.
      const phone = arm === 'baseline'
        ? (await import(`${modules}/contracts.ts`)).PhoneConfigSchema.parse({ enabled: true })
        : ConfigSchema.parse({ phone: { enabled: true } }).phone;
      const context = { config: { ...ConfigSchema.parse({}), phone }, agentId: 'main', modelRef: 'synthetic/model' };
      try {
        await runtime.execute('benchmark', { op: 'open', mode: 'control' }, context);
        const input: PhoneInput = { op: 'run', goal: 'Read five products', maxActions: 1,
          ...(scenario === 'verified-top5' ? { completion: { textAll: ['Results'] } } : {}),
          requestedOutputs: Object.keys(products).map(key => ({ key, description: key })) };
        const report = await runtime.execute('benchmark', input, context) as PhoneReport;
        assert.equal(report.feedback?.outputs.filter(value => value.value).length, 5);
        rows.push({ arm, scenario, observations, modelRequests: report.modelRequests, fieldReads, genericReads,
          actions: report.actions, outputs: report.feedback?.outputs.length, verified: report.verified });
      } finally { await runtime.shutdown(); }
    }
  }
  const result = { scope: 'Synthetic request and full-observation counts; no real JD, device or model calls, no end-to-end latency claim.',
    testedAt: new Date().toISOString(), baselineSources: previous.hashes, optimizedSources: await sourceHashes(resolve('src/phone')), rows };
  await writeFile(resolve(output), JSON.stringify(result, null, 2) + '\n', { flag: 'wx' });
  console.log(JSON.stringify(result.rows, null, 2));
} finally { closeXopcDatabase(); await rm(modules, { recursive: true, force: true }); }
