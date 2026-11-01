import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { release } from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';
import { app } from 'electron';
import type { ComputerAction, ComputerCommand } from '@xopcai/computer-control-contract';
import { CuaComputerDriver } from '../../electron/computer/cua-driver.js';
import { windowsAppIdentity } from '../../electron/computer/windows-apps.js';
import { ComputerBroker, type BrokerResult } from '../../src/computer/broker.js';
import { classifyComputerFailure } from '../../src/computer/diagnostics.js';
import { evaluateComputerRuns, type ComputerEvaluationRun } from '../../src/computer/evaluation.js';
import { verifyComputerExpectation } from '../../src/computer/task-state.js';
import { writeTextAtomic } from '../../src/infra/write-file-atomic.js';
import { normalizeNativeText, WINDOWS_COMPUTER_TASKS, type WindowsComputerTaskId } from './suite.mjs';

type Oracle = { pid: number; text: string; lastKey: string; verifyClicks: number; protectedLength: number; readOnlyText: string };
async function main() {
  const [binary, fixture, oraclePath, output, repeats, pid, framework] = process.argv.slice(2);
  app.setPath('userData', join(output, 'electron'));
  await app.whenReady();
  const expectedPid = Number(pid), repetitions = Number(repeats);
  const allowedApp = windowsAppIdentity({ bundleId: fixture, name: basename(fixture), pid: expectedPid, running: true, active: true })!.appId;
  const driver = new CuaComputerDriver(binary, 'com.github.Electron');
  const broker = new ComputerBroker(driver, { isVisible: () => true,
    requestApproval: async request => (request.kind === 'session' ? request.appId : request.target.appId) === allowedApp,
  }, { enabled: true });
  const plan = { taskIds: WINDOWS_COMPUTER_TASKS.map(t => t.id), repetitions, modelRef: 'scripted/no-model',
    environment: `windows-${release()}-${framework}-driver-0.36.0`, evidence: 'native' as const };
  const runs: ComputerEvaluationRun[] = [];
  const evidence: Record<string, string> = {};
  const probes: Array<Record<string, unknown>> = [];
  let audit = { actionId: '', dispatches: new Map<string, number>(), scopeViolations: 0, postStopInputs: 0, stopped: false, uncertain: false };
  const perform = driver.perform.bind(driver);
  driver.perform = async (target, action, signal, progress) => {
    if (target.appId !== allowedApp || target.pid !== expectedPid) { audit.scopeViolations++; throw new Error('COMPUTER_BENCHMARK_SCOPE'); }
    if (audit.stopped) { audit.postStopInputs++; throw new Error('COMPUTER_BENCHMARK_POST_STOP'); }
    audit.dispatches.set(audit.actionId, (audit.dispatches.get(audit.actionId) ?? 0) + 1);
    try { await perform(target, action, signal, progress); }
    catch (error) { audit.uncertain = true; throw error; }
  };
  const checkpoint = async () => writeTextAtomic(join(output, 'result.json'), JSON.stringify({ plan, runs, evidence, probes,
    summary: evaluateComputerRuns(plan, runs), evidenceClass: 'native', modelRequests: 0,
    scope: 'Scripted Broker actions; app-owned oracle; no model planning, Gateway transport or real-app certification.' }, null, 2), { mode: 0o600 });
  const readOracle = async (): Promise<Oracle> => {
    const data = JSON.parse(await readFile(oraclePath, 'utf8'));
    assert.equal(data.pid, expectedPid, 'Oracle belongs to a different process');
    return data;
  };
  const awaitOracle = async (predicate: (value: Oracle) => boolean) => {
    let value = await readOracle();
    for (let i = 0; i < 30 && !predicate(value); i++) { await delay(100); value = await readOracle(); }
    assert.ok(predicate(value), 'Application-owned oracle did not match the expected state');
    return value;
  };
  await checkpoint();
  try {
    for (const task of WINDOWS_COMPUTER_TASKS) for (let repetition = 0; repetition < repetitions; repetition++) {
      const started = performance.now(), sessionId = randomUUID(), owner = 'windows-native-benchmark';
      audit = { actionId: '', dispatches: new Map(), scopeViolations: 0, postStopInputs: 0, stopped: false, uncertain: false };
      let current: BrokerResult;
      const receipts: Array<{ action: string; dispatch?: string; errorCode?: string; durationMs: number; nativeMs?: BrokerResult['nativeMs']; focusedBefore: boolean; focusedAfter: boolean }> = [];
      let observationChanges = 0, rescueAttempts = 0;
      let before: Oracle | undefined, after: Oracle | undefined, failure: ComputerEvaluationRun['failure'];
      let outcome: 'passed' | 'failed' | 'unknown' = 'passed';
      const command = async (value: ComputerCommand) => {
        const result = await broker.command(value); result.frame?.bytes.fill(0); return result;
      };
      const observe = async () => {
        current = await command({ op: 'observe', owner, sessionId });
        assert.ok(current.observation, current.errorCode);
        return JSON.parse(current.observation.summary).elements as Array<any>;
      };
      const envelope = (action: ComputerAction) => ({ actionId: randomUUID(), sessionId, observationId: current.observation!.id,
        brokerEpoch: current.brokerEpoch, generation: current.generation, grantId: current.grantId!, deadlineAt: Date.now() + 30000, action });
      const act = async (action: ComputerAction, rescued = false): Promise<Extract<ComputerCommand, { op: 'act' }>> => {
        const request = { op: 'act' as const, owner, sessionId, envelope: envelope(action) };
        audit.actionId = request.envelope.actionId;
        const focusedBefore = !!current.observation?.focusedEditableRef;
        const actionStarted = performance.now();
        let result = await command(request);
        for (let i = 0; i < 100 && result.status === 'pending_action' && !result.receipt; i++) {
          await delay(25); result = await command(request);
        }
        receipts.push({ action: action.kind, dispatch: result.receipt?.dispatch, errorCode: result.errorCode ?? result.receipt?.errorCode,
          durationMs: performance.now() - actionStarted, nativeMs: result.nativeMs,
          focusedBefore, focusedAfter: !!result.observation?.focusedEditableRef });
        if (result.errorCode === 'COMPUTER_OBSERVATION_CHANGED' && !result.receipt && !audit.dispatches.has(audit.actionId)) {
          observationChanges++;
          if (!rescued) {
            rescueAttempts++;
            // The fixed fixture contract supplies the new target, never the old ref.
            const elements = await observe();
            const label = action.kind === 'activate' ? 'Verify' : 'Message';
            const candidates = elements.filter(e => e.label === label && (label === 'Message' ? e.inputAllowed === true : e.semanticActions.includes('activate')));
            assert.equal(candidates.length, 1);
            const target = candidates[0];
            const grounded = action.kind === 'setValue' || action.kind === 'activate' ? { ...action, ref: target.ref }
              : action.kind === 'click' || action.kind === 'typeText' ? { ...action, point: {
                x: target.bounds.x + target.bounds.width / 2, y: target.bounds.y + target.bounds.height / 2 } } : action;
            return act(grounded, true);
          }
        }
        audit.uncertain ||= result.receipt?.dispatch === 'unknown' || result.receipt?.dispatch === 'started';
        if (result.errorCode || result.receipt?.dispatch !== 'completed') throw new Error(result.errorCode ?? result.receipt?.errorCode ?? 'COMPUTER_BENCHMARK_NO_RECEIPT');
        current = result;
        return request;
      };
      const field = async () => {
        const fields = (await observe()).filter(e => e.label === 'Message' && e.inputAllowed === true);
        assert.equal(fields.length, 1, 'Expected one certified Message field');
        return fields[0];
      };
      const replace = async (text: string) => { const box = await field(); await act({ kind: 'setValue', ref: box.ref, text }); await awaitOracle(o => o.text === text); };
      const noDispatch = async (request: ComputerCommand, error: RegExp) => {
        const count = [...audit.dispatches.values()].reduce((a, b) => a + b, 0);
        await assert.rejects(command(request), error);
        assert.equal([...audit.dispatches.values()].reduce((a, b) => a + b, 0), count);
      };
      try {
        before = await readOracle();
        const catalog = await command({ op: 'discover', owner, sessionId, query: basename(fixture, '.exe') });
        const candidates = catalog.apps!.filter(candidate => candidate.running);
        assert.equal(candidates.length, 1, 'Disposable fixture selection must be unique');
        current = await command({ op: 'open', owner, sessionId, appRef: candidates[0].appRef, mode: 'control', prepare: false,
          model: { modelRef: plan.modelRef, profile: 'structured-tools-v1', origin: 'https://fixture.invalid', runtimeLocation: 'local' } });
        assert.equal(current.status, 'ready', current.errorCode);
        const taskId: WindowsComputerTaskId = task.id;
        if (taskId === 'replace') {
          await replace('old draft'); await replace('Windows 中文 exact 42');
          await observe();
          const verification = verifyComputerExpectation({ kind: 'field', label: 'Message', value: 'Windows 中文 exact 42' }, current.observation);
          probes.push({ taskId, repetition, capability: 'exact-field-expectation', expected: 'satisfied', actual: verification?.status,
            supported: verification?.status === 'satisfied', note: 'Separate from the independent application-state grade.' });
          assert.equal(verification?.status, 'satisfied', 'Native exact-field verification must agree with the independent app oracle');
          assert.equal(verifyComputerExpectation({ kind: 'field', label: 'Message', value: 'wrong value' }, current.observation)?.status, 'not_met');
        } else if (taskId === 'append') {
          await replace('Seed '); const box = await field();
          await act({ kind: 'typeText', text: '中文🙂\nsecond line', point: { x: box.bounds.x + box.bounds.width / 2, y: box.bounds.y + box.bounds.height / 2 } });
          await awaitOracle(o => normalizeNativeText(o.text) === 'Seed 中文🙂\nsecond line');
        } else if (taskId === 'keyboard') {
          await replace('abc'); const box = await field();
          await act({ kind: 'click', point: { x: box.bounds.x + box.bounds.width / 2, y: box.bounds.y + box.bounds.height / 2 }, button: 'left', count: 1 });
          await observe(); await act({ kind: 'pressKeys', keys: ['end'] });
          await awaitOracle(o => o.lastKey === 'End');
          await observe(); await act({ kind: 'pressKeys', keys: ['backspace'] });
          await awaitOracle(o => o.text === 'ab');
        } else if (taskId === 'deduplicate') {
          const buttons = (await observe()).filter(e => e.label === 'Verify' && e.semanticActions.includes('activate'));
          assert.equal(buttons.length, 1);
          const count = (await readOracle()).verifyClicks;
          const request = await act({ kind: 'activate', ref: buttons[0].ref });
          const duplicate = await command(request); assert.deepEqual(duplicate.receipt, current.receipt);
          await delay(350); assert.equal((await readOracle()).verifyClicks, count + 1);
        } else if (taskId === 'protected') {
          const nodes = await observe();
          const targets = [nodes.find(e => e.role === 'AXSecureTextField'), nodes.find(e => e.role === 'UIAUnverifiedEdit')];
          assert.ok(targets.every(Boolean), 'Protected and readonly fields must both be exposed as refused');
          for (const node of targets) await noDispatch({ op: 'act', owner, sessionId,
            envelope: envelope({ kind: 'setValue', ref: node.ref, text: 'must-not-write' }) }, /EDITABLE_TARGET_REQUIRED/);
        } else if (taskId === 'stale') {
          const box = await field(); const request = { op: 'act' as const, owner, sessionId, envelope: envelope({ kind: 'setValue', ref: box.ref, text: 'must-not-write' }) };
          await observe(); await noDispatch(request, /STALE_OBSERVATION/);
        } else if (taskId === 'owner') {
          const box = await field(); await noDispatch({ op: 'act', owner: 'foreign-owner', sessionId,
            envelope: envelope({ kind: 'setValue', ref: box.ref, text: 'must-not-write' }) }, /SESSION_NOT_FOUND/);
        } else {
          const box = await field(); const request = { op: 'act' as const, owner, sessionId, envelope: envelope({ kind: 'setValue', ref: box.ref, text: 'must-not-write' }) };
          await command({ op: 'release', owner, sessionId }); audit.stopped = true;
          await noDispatch(request, /NOT_READY|STOPPED|SESSION_NOT_FOUND|STALE|GRANT_REVOKED/);
        }
        after = await readOracle();
        assert.equal(after.protectedLength, 0); assert.equal(after.readOnlyText, 'READ ONLY');
        if (['protected', 'stale', 'owner', 'released'].includes(taskId)) assert.equal(after.text, before.text);
      } catch (error) {
        outcome = audit.uncertain ? 'unknown' : 'failed';
        failure = classifyComputerFailure(error, 'executor', audit.uncertain ? 'unknown' : audit.dispatches.size ? 'completed' : 'notStarted');
        after = await readOracle().catch(() => undefined);
        console.error(`${framework}/${task.id}/${repetition}: ${error instanceof Error ? error.message : 'failed'}`);
      } finally {
        try { await broker.stop(); audit.stopped = true; }
        catch (error) { outcome = 'unknown'; audit.uncertain = true; failure ??= classifyComputerFailure(error, 'release', 'unknown'); }
      }
      const duplicateInputs = [...audit.dispatches.values()].reduce((n, count) => n + Math.max(0, count - 1), 0);
      const run: ComputerEvaluationRun = { taskId: task.id, repetition, modelRef: plan.modelRef, environment: plan.environment, evidence: 'native',
        outcome, oracle: after ? 'application-state' : 'none', claimedSuccess: false, takeover: false,
        duplicateInputs, scopeViolations: audit.scopeViolations, postStopInputs: audit.postStopInputs,
        durationMs: performance.now() - started, modelRequests: 0, inputTokens: 0, outputTokens: 0, cost: 0,
        actions: [...audit.dispatches.values()].reduce((a, b) => a + b, 0), observationChanges, rescueAttempts,
        ...(failure ? { failure } : {}) };
      const filename = `${task.id}-${repetition}.json`;
      await writeTextAtomic(join(output, filename), JSON.stringify({ run, before, after, receipts,
        measurementScope: 'Native perform calls issued by this benchmark process only; no inference about unrelated desktop input.' }, null, 2), { mode: 0o600 });
      evidence[`${task.id}:${repetition}`] = filename; runs.push(run); await checkpoint();
      console.log(JSON.stringify({ framework, task: task.id, repetition, outcome, durationMs: Math.round(run.durationMs), errorCode: failure?.errorCode }));
      if (audit.uncertain || duplicateInputs || audit.scopeViolations || audit.postStopInputs) throw new Error('COMPUTER_BENCHMARK_MATRIX_STOPPED');
    }
  } finally { await broker.dispose(); await checkpoint(); }
  app.exit(runs.every(run => run.outcome === 'passed') && runs.length === plan.taskIds.length * repetitions ? 0 : 1);
}
void main().catch(error => { console.error(error); app.exit(1); });
