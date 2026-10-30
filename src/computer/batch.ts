import { setTimeout as delay } from 'node:timers/promises';
import { z } from 'zod';
import { ComputerPrimitiveActionSchema, type ComputerPrimitiveAction } from '@xopcai/computer-control-contract';
import { ComputerExpectationSchema, type ComputerExpectation, type ComputerVerification } from './task-state.js';
import type { ComputerProgramHost } from './program-runtime.js';

const Target = z.object({ role: z.string().min(1).max(100), label: z.string().max(300) }).strict();
const PlannedAction = z.union(ComputerPrimitiveActionSchema.options.map(option => 'ref' in option.shape
  ? option.extend({ ref: z.string().min(1).max(200).optional() }) : option));
export const ComputerBatchSchema = z.object({
  snapshotId: z.string().min(1).max(200),
  steps: z.array(z.union([
    z.object({ kind: z.literal('action'), action: PlannedAction, target: Target.optional() }).strict(),
    z.object({ kind: z.literal('observe'), expect: ComputerExpectationSchema.optional(),
      timeoutMs: z.number().int().min(0).max(5000).optional(), visual: z.boolean().optional() }).strict(),
  ])).min(1).max(24),
}).strict();
type State = Record<string, unknown> & { snapshotId: string };

/** Checkpoints delimit native dispatches; a failed condition never starts the next segment. */
export async function executeComputerBatch(raw: unknown, host: ComputerProgramHost, options: {
  remainingInputs: number; signal: AbortSignal;
  state(snapshotId: string): State;
  verify(expect: ComputerExpectation): ComputerVerification | undefined;
}) {
  const input = ComputerBatchSchema.parse(raw);
  if (input.steps.filter(step => step.kind === 'action').length > options.remainingInputs) throw new Error('COMPUTER_ACTION_BUDGET');
  let state = options.state(input.snapshotId);
  let afterCheckpoint = false;
  let queued: ComputerPrimitiveAction[] = [];
  const receipts: unknown[] = [];
  const finish = (status: string, nextStep: number, verification?: ComputerVerification) => ({
    ...state, status, nextStep, receipts, ...(verification ? { verification } : {}),
  });
  const flush = async () => {
    if (!queued.length) return;
    state = await host('act', { snapshotId: state.snapshotId, action: { kind: 'batch', actions: queued } }, options.signal) as State;
    receipts.push(state.receipt);
    queued = [];
  };
  for (const [index, step] of input.steps.entries()) {
    options.signal.throwIfAborted();
    if (step.kind === 'action') {
      let action = step.action;
      if (step.target) {
        if (!('ref' in action) && !['activate', 'showMenu', 'setValue', 'click', 'scroll', 'typeText'].includes(action.kind)) throw new Error('COMPUTER_INVALID_INPUT');
        const element = await host('resolve', { snapshotId: state.snapshotId, ...step.target }, options.signal) as Record<string, unknown>;
        if (['activate', 'showMenu', 'setValue'].includes(action.kind)) action = { ...action, ref: element.ref } as typeof action;
        else {
          const bounds = z.object({ x: z.number().finite(), y: z.number().finite(), width: z.number().positive(), height: z.number().positive() }).parse(element.bounds);
          action = { ...action, point: { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 } } as typeof action;
        }
      } else if (afterCheckpoint && ('ref' in action || ['activate', 'showMenu', 'setValue', 'click', 'scroll', 'typeText', 'drag'].includes(action.kind))) {
        throw new Error('COMPUTER_ELEMENT_REF_REQUIRED');
      }
      queued.push(ComputerPrimitiveActionSchema.parse(action));
      continue;
    }
    await flush();
    let verification: ComputerVerification | undefined;
    if (step.expect) {
      const deadline = Date.now() + (step.timeoutMs ?? 2000);
      for (let sample = 0; ; sample++) {
        verification = options.verify(step.expect);
        if (verification?.status === 'satisfied') break;
        if (sample >= 19 || Date.now() >= deadline) return finish('condition_not_met', index, verification);
        // Only an unmet condition waits. Already-ready results have no sleep or extra capture.
        await delay(Math.min(25 * 2 ** Math.min(sample, 3), 200, Math.max(0, deadline - Date.now())), undefined, { signal: options.signal });
        state = await host('observe', {}, options.signal) as State;
      }
    }
    if (step.visual) await host('emitScreenshot', { snapshotId: state.snapshotId }, options.signal);
    if ((!step.expect || step.visual) && index < input.steps.length - 1) return finish('observation_required', index + 1, verification);
    afterCheckpoint = true;
    if (index === input.steps.length - 1) return finish('batch_completed', index + 1, verification);
  }
  await flush();
  return finish('batch_completed', input.steps.length);
}
