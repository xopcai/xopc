/** Bounded opt-in live cancellation trial; uses configured Cloud credentials and isolated usage rows. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { readRuntimeUsage } from '../evals/control/runtime-usage.mjs';

assert.ok(process.argv.includes('--configured-models'), 'Explicit configured-model authorization required');
const output = resolve(process.argv[process.argv.indexOf('--output') + 1]);
mkdirSync(output, { recursive: true });
const state = join(output, 'state'); mkdirSync(state);
const source = process.env.XOPC_STATE_DIR ?? join(homedir(), '.xopc');
const configPath = process.env.XOPC_CONFIG_PATH ?? join(source, 'xopc.json');
process.env.XOPC_CREDENTIALS_DIR ??= join(source, 'credentials');
for (const folder of ['cache/model-catalog']) if (existsSync(join(source, folder))) cpSync(join(source, folder), join(state, folder), { recursive: true });
process.env.XOPC_STATE_DIR = state;
process.env.XOPC_CONFIG_PATH = configPath;
process.env.XOPC_LOG_CONSOLE = 'false';
const { openXopcDatabase, closeXopcDatabase } = await import('../src/storage/sqlite/connection.js');
const { resolveModel } = await import('../src/providers/index.js');
const { createResolvedModelStream } = await import('../src/providers/model-call.js');
openXopcDatabase({ path: join(state, 'xopc.db') });
const model = resolveModel('xopc-cloud/openai-codex/gpt-5.6-sol');
const paths = ['src/usage/cloud-wire.ts', 'src/usage/recorder.ts', 'src/providers/model-call.ts', 'src/providers/extension-stream-bridge.ts', 'scripts/verify-cloud-cancellation-live.mts'];
const fingerprint = () => Object.fromEntries(paths.map(path => [path,createHash('sha256').update(readFileSync(path)).digest('hex')]));
const sourceHashes = fingerprint();
const trials: unknown[] = [];
let failure: string | undefined;
try {
  for (let index = 0; index < 2; index++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(new Error('Live trial maximum 45 seconds')), 45_000);
    const startedAt = Date.now(); let canceledAt: number | undefined;
    try {
      const stream = await createResolvedModelStream(model, { messages: [{ role: 'user', content: 'List the integers from 1 to 100, separated by spaces. No other text.', timestamp: Date.now() }] },
        { signal: controller.signal, maxTokens: 512, reasoning: 'low' }, undefined, { operation: 'agent.answer', trigger: 'user' });
      for await (const event of stream) if (event.type === 'text_delta' && !canceledAt) { canceledAt = Date.now(); controller.abort(new Error('Disclosed first-delta cancellation')); }
      const message = await stream.result();
      const trial = { index, scenario: 'first-delta-cancellation', repetition:index+1, success:false, stopReason: message.stopReason, canceledAt, startedAt, finishedAt: Date.now(), totalTokens: message.usage.totalTokens, inputTokens:message.usage.input, outputTokens:message.usage.output };
      trials.push(trial);
      assert.ok(canceledAt, 'Cancellation must occur after an actual model delta');
      assert.equal(message.stopReason, 'aborted', 'Cancellation must not deliver a successful answer');
      assert.ok(trial.finishedAt - canceledAt <= 17_000, 'Cancellation drain exceeded its bounded grace');
      assert.ok(message.usage.totalTokens > 0 && message.usage.input > 0 && message.usage.output > 0, 'Final authoritative total and components must be observed');
      trial.success = true;
    } finally { clearTimeout(timeout); }
  }
} catch (error) { failure = error instanceof Error ? error.message : String(error); process.exitCode = 1; }
finally {
  closeXopcDatabase();
  const rows = readRuntimeUsage(join(state, 'xopc.db'));
  writeFileSync(join(output, 'runtime-usage.json'), JSON.stringify({mode:'post-close-readonly',finalSnapshotGuaranteed:true,rows},null,2));
  writeFileSync(join(output, 'summary.json'), JSON.stringify({success:!failure,failure,trials,manifest:{sourceHashes,sourceChangedDuringRun:JSON.stringify(sourceHashes)!==JSON.stringify(fingerprint())},models:[model.provider+'/'+model.id],scope:'two intentional first-delta cancellations; bounded 15s accounting drain, not a provider receipt recovery service'},null,2));
}
process.exit(process.exitCode ?? 0);
