import { rejectUnbudgetedCloudTransport } from '../providers/xopc-cloud-credit-budget.js';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { z } from 'zod';
import {
  COMPUTER_CONTROL_TOOL, computerActionInputCount, ComputerActionSchema, ComputerTransportTimingSchema, ComputerAppSchema, ComputerWindowSchema, ComputerObservationSchema,
  type ActionEnvelope, type ComputerCommand, type ComputerModelBinding,
} from '@xopcai/computer-control-contract';
import type { EndpointToolRuntime } from '../endpoint-tools/runtime.js';
import type { Config } from '../config/schema.js';
import { resolveEffectiveAgentConfigForSession } from '../config/agent-profile.js';
import { getApiKey, resolveModel } from '../providers/index.js';
import { createComputerModelAdapter, predictComputerStep, readComputerJson, type ComputerStepAdapter } from './model-adapter.js';
import { enterComputerControl, leaveComputerControl } from './control-guard.js';
import { computerModelProfile, ComputerServiceLimitsSchema, type ComputerServiceLimits } from './model-policy.js';
import { groundComputerAction } from './semantic-actions.js';
import { ComputerFlowCapture, ComputerFlowStore, computerFlowMetadata, computerFlowHint, type ComputerFlowRepository } from './flows.js';
import { ComputerSessionDiagnostics, ComputerNativeTimingSchema, type ComputerNativeTiming, type ComputerSessionReport } from './diagnostics.js';
import { computerAgentTurn, clearComputerFrames, retainComputerFrame } from './agent-context.js';
import { executeComputerProgram, type ComputerProgramHost } from './program-runtime.js';
import { executeComputerBatch } from './batch.js';
import { ComputerDiagnosticSchema, ComputerOperationError, computerDiagnostic, computerRecovery } from './errors.js';
import { ComputerStabilityTracker } from './stability-diagnostics.js';
import { createLogger } from '../utils/logger.js';
import { ComputerExpectationSchema, ComputerTaskState, verifyComputerExpectation,
  type ComputerExpectation, type ComputerVerification } from './task-state.js';

const log = createLogger('ComputerRuntime');

const Reply = z.object({
  status: z.enum(['pending_authorization', 'ready', 'running', 'pending_action', 'paused', 'stopped']),
  sessionId: z.string(), brokerEpoch: z.string(), generation: z.number().int().nonnegative(),
  grantId: z.string().optional(), observation: ComputerObservationSchema.optional(),
  nativeMs: ComputerNativeTimingSchema.optional(),
  transportTiming: ComputerTransportTimingSchema.optional(),
  errorCode: z.string().optional(),
  diagnostic: ComputerDiagnosticSchema.optional(),
  apps: z.array(ComputerAppSchema).max(100).optional(), windows: z.array(ComputerWindowSchema).max(100).optional(),
  receipt: z.object({ actionId: z.string(), inputCount: z.number().int().min(1).max(12).optional(), steps: z.array(z.object({ index: z.number().int().min(0).max(11), dispatch: z.enum(['notStarted', 'started', 'completed', 'unknown']) }).strict()).max(12).optional(), dispatch: z.enum(['notStarted', 'started', 'completed', 'unknown']), outcome: z.enum(['applied', 'notApplied', 'unknown']), verification: z.enum(['semantic', 'artifact', 'visual', 'none']), errorCode: z.string().optional() }).optional(),
}).strict();
type ObservationReply = { value: z.infer<typeof Reply>; frame?: Uint8Array; mimeType?: 'image/png' | 'image/jpeg' };
type GoalContext = { observation?: ObservationReply; observationsReused: number; stabilityObservations: number; actionsRemaining: number; nativeMs: ComputerNativeTiming };
type Session = {
  id: string; owner: string; endpointId: string; appRef: string; mode: 'observe' | 'control'; prepare: boolean; windowRef?: string; binding: ComputerModelBinding;
  adapter?: ComputerStepAdapter; programStore?: Record<string, unknown>; createdAt: number; modelRequests: number; actions: number;
  rescues: number; rescueLimit: number;
  pending?: ActionEnvelope; controller: AbortController;
  task: ComputerTaskState;
  flowCapture: ComputerFlowCapture; flowScope: string; flowPrincipalId?: string; lastFlowId?: string;
  diagnostics: ComputerSessionDiagnostics;
  pendingContext?: { goal: string; before: z.infer<typeof ComputerObservationSchema>; expectation?: ComputerExpectation; flowId?: string };
  serviceLimits?: ComputerServiceLimits;
};
export const ComputerUseInputSchema = z.discriminatedUnion('op', [
  z.object({ op: z.literal('discover'), query: z.string().max(200) }).strict(),
  z.object({ op: z.literal('open'), appRef: z.string().min(1).max(200), windowRef: z.string().min(1).max(200).optional(),
    mode: z.enum(['observe', 'control']), prepare: z.boolean(), planner: z.enum(['gui', 'agent']).optional() }).strict(),
  z.object({ op: z.literal('observe'), question: z.string().min(1).max(4000).optional(), expect: ComputerExpectationSchema.optional() }).strict(),
  z.object({ op: z.literal('step'), goal: z.string().min(1).max(4000), expect: ComputerExpectationSchema.optional(), flowId: z.uuid().optional() }).strict(),
  z.object({ op: z.literal('exec'), code: z.string().max(65536), maxActions: z.number().int().min(1).max(12).optional(),
    timeoutMs: z.number().int().min(100).max(120000).optional() }).strict(),
  z.object({ op: z.literal('run'), goal: z.string().min(1).max(4000), expect: ComputerExpectationSchema,
    maxActions: z.number().int().min(1).max(12).optional() }).strict(),
  z.object({ op: z.literal('close'), saveFlowAs: z.string().trim().min(1).max(160).optional() }).strict(),
  z.object({ op: z.literal('flows') }).strict(),
  z.object({ op: z.literal('forget_flow'), flowId: z.uuid() }).strict(),
  z.object({ op: z.literal('report') }).strict(),
]);
export type ComputerUseInput = z.infer<typeof ComputerUseInputSchema>;
export interface ComputerPublicResult {
  status: string; sessionId: string; output?: string; scriptError?: string; scriptErrorMessage?: string; imageRef?: string; pending?: boolean; summary?: string;
  receipts?: Array<NonNullable<z.infer<typeof Reply>['receipt']>>;
  receipt?: z.infer<typeof Reply>['receipt']; claimedSuccess?: boolean; verified?: boolean;
  verification?: ComputerVerification;
  budget?: { actionsRemaining: number; modelRequestsRemaining: number; rescuesRemaining: number; expiresAt: number; serviceLimits?: ComputerServiceLimits };
  handoff?: { recentActions: Array<{ goal: string; action: string; dispatch: string; outcome: string; verification?: ComputerVerification }> };
  observation?: { id: string; width: number; height: number };
  errorCode?: string;
  diagnostic?: z.infer<typeof ComputerDiagnosticSchema>;
  nextAction?: string;
  apps?: z.infer<typeof ComputerAppSchema>[];
  windows?: z.infer<typeof ComputerWindowSchema>[];
  reportId?: string;
  report?: ComputerSessionReport;
  flows?: ReturnType<typeof computerFlowMetadata>[];
  savedFlow?: ReturnType<typeof computerFlowMetadata>;
  run?: { actionsExecuted: number; modelRequests: number; observationsReused: number; stabilityObservations: number; elapsedMs: number; phaseMs: ComputerSessionReport['phaseMs']; nativeMs: ComputerNativeTiming;
    stopReason: 'condition_satisfied' | 'condition_present' | 'action_limit' | 'time_limit' | 'handoff' };
}

export class ComputerRuntime {
  private readonly sessions = new Map<string, Session>();
  private readonly operations = new Map<string, AbortController>();
  private readonly reports = new Map<string, { diagnostics: ComputerSessionDiagnostics; expiresAt: number }>();
  private readonly openingReports = new Map<string, ComputerSessionDiagnostics>();
  constructor(private readonly endpoints: EndpointToolRuntime, private readonly getConfig: () => Config,
    private readonly getTurnEndpoint?: (owner: string) => string | undefined,
    private readonly flowStore: ComputerFlowRepository = new ComputerFlowStore()) {}

  async execute(owner: string, input: ComputerUseInput, signal?: AbortSignal, execution?: { toolCallId: string }): Promise<ComputerPublicResult> {
    input = ComputerUseInputSchema.parse(input);
    if (!owner) throw new Error('COMPUTER_CONVERSATION_REQUIRED');
    if (input.op === 'flows' || input.op === 'forget_flow') {
      signal?.throwIfAborted();
      const scope = this.flowScope(owner);
      return input.op === 'flows' ? { status: 'flows', sessionId: 'none', flows: this.flowStore.list(scope).map(computerFlowMetadata) }
        : { status: this.flowStore.delete(scope, input.flowId) ? 'flow_deleted' : 'flow_not_found', sessionId: 'none' };
    }
    if (input.op === 'report') {
      const report = this.getReport(owner);
      return { status: report ? 'report' : 'no_report', sessionId: report?.sessionId ?? 'none', ...(report ? { report } : {}) };
    }
    if (input.op === 'close') {
      const session = this.sessions.get(owner);
      const sessionId = session?.id ?? 'none';
      const canSaveFlow = session && !session.pending && !this.operations.has(owner) && !signal?.aborted && session.mode === 'control';
      const handoff = { recentActions: (session?.task.history ?? []).map(({ goal, action, dispatch, outcome, verification }) => ({ goal, action, dispatch, outcome, verification })) };
      const released = await this.close(owner);
      const report = this.getReport(owner);
      let savedFlow: ComputerPublicResult['savedFlow'];
      if (input.saveFlowAs && released) {
        if (!canSaveFlow || !report || report.failure || report.counters.unknownDispatches || report.counters.takeovers) {
          return { status: 'stopped', sessionId, errorCode: 'COMPUTER_FLOW_NOT_VERIFIED', report,
            nextAction: 'Control was released. Save only a complete native navigation sequence with a final verified selected condition or positive page-specific text and no failure or takeover.' };
        }
        let draft;
        try { draft = session.flowCapture.finish(input.saveFlowAs, session.endpointId); }
        catch { return { status: 'stopped', sessionId, errorCode: 'COMPUTER_FLOW_NOT_VERIFIED', report,
          nextAction: 'Control was released. Only a complete native navigation sequence with non-sensitive labels and a final verified selected condition or positive page-specific text can be saved.' }; }
        try { savedFlow = computerFlowMetadata(this.flowStore.save(session.flowScope, { ...draft, ...(session.flowPrincipalId ? { principalId: session.flowPrincipalId } : {}) })); }
        catch { return { status: 'stopped', sessionId, errorCode: 'COMPUTER_FLOW_SAVE_FAILED', report,
          nextAction: 'Control was released; no reusable flow was confirmed saved. Check native verification, non-sensitive labels and local storage. Do not repeat desktop input to save a flow.' }; }
      }
      return released ? { status: 'stopped', sessionId, handoff,
        ...(savedFlow ? { savedFlow } : {}),
        ...(report ? { report } : {}),
        nextAction: 'Desktop control is released. Continue with an appropriate authorized tool; this does not permit bypassing a desktop refusal.' }
        : { status: 'stop_unconfirmed', sessionId, errorCode: 'COMPUTER_RELEASE_UNCONFIRMED', report, nextAction: computerRecovery('COMPUTER_RELEASE_UNCONFIRMED') };
    }
    if (this.operations.has(owner)) throw new Error('COMPUTER_BUSY');
    const operation = new AbortController(); this.operations.set(owner, operation);
    const diagnostics = this.sessions.get(owner)?.diagnostics ?? (input.op === 'open' ? new ComputerSessionDiagnostics() : undefined);
    if (diagnostics) this.openingReports.set(owner, diagnostics);
    try {
      const operationSignal = signal ? AbortSignal.any([signal, operation.signal]) : operation.signal;
      const result = input.op === 'exec' ? await this.executeProgram(owner, input, operationSignal, execution)
        : input.op === 'run' ? await this.executeGoal(owner, input, operationSignal, diagnostics)
        : await this.executeInput(owner, input, operationSignal, diagnostics);
      if (result.errorCode) diagnostics?.fail(new Error(result.errorCode), diagnostics.phase, result.receipt?.dispatch ?? 'notStarted');
      if (diagnostics && !this.sessions.has(owner)) this.retainReport(owner, diagnostics);
      return { ...result, ...(diagnostics ? { reportId: diagnostics.snapshot().reportId,
        ...(result.errorCode || result.receipt?.dispatch === 'unknown' ? { report: diagnostics.snapshot() } : {}) } : {}) };
    } catch (error) {
      diagnostics?.fail(error, diagnostics.phase, undefined, !!signal?.aborted || operation.signal.aborted);
      if (diagnostics && !this.sessions.has(owner)) { diagnostics.finish(true); this.retainReport(owner, diagnostics); }
      if (diagnostics) {
        const report = diagnostics.snapshot();
        log.warn({ reportId: report.reportId, conversationId: owner, sessionId: report.sessionId, ...report.failure },
          `Computer operation failed: ${report.failure?.errorCode}`);
      }
      throw error;
    } finally {
      if (this.operations.get(owner) === operation) this.operations.delete(owner);
      if (this.openingReports.get(owner) === diagnostics) this.openingReports.delete(owner);
    }
  }
  private flowScope(owner: string): string {
    const effective = resolveEffectiveAgentConfigForSession(owner).config;
    return JSON.stringify([effective.id, effective.workspace]);
  }
  private async executeProgram(owner: string, input: Extract<ComputerUseInput, { op: 'exec' }>, signal: AbortSignal,
    execution?: { toolCallId: string }): Promise<ComputerPublicResult> {
    const s = this.sessions.get(owner);
    if (!s) throw new Error('COMPUTER_OPEN_REQUIRED');
    if (!('planner' in s.binding) || s.binding.planner !== 'agent' || !execution) throw new Error('COMPUTER_PLANNER_MISMATCH');
    const turn = computerAgentTurn(owner);
    if (JSON.stringify(turn.binding) !== JSON.stringify(s.binding)) { await this.close(owner); throw new Error('COMPUTER_AGENT_MODEL_CHANGED'); }
    const combined = AbortSignal.any([signal, s.controller.signal]);
    let current: ObservationReply | undefined;
    let actions = 0;
    const receipts: Array<NonNullable<ComputerPublicResult['receipt']>> = [];
    let imageRef: string | undefined;
    const observe = async (observationSignal = combined) => {
      current?.frame?.fill(0);
      current = await this.send(s, { op: 'observe', sessionId: s.id, owner }, observationSignal);
      if (current.value.status !== 'ready' || current.value.errorCode || !current.value.observation) {
        throw new Error(current.value.errorCode ?? 'COMPUTER_NOT_READY');
      }
      const observation = current.value.observation;
      let data: Record<string, unknown>;
      try { data = JSON.parse(observation.summary); }
      catch { data = { text: observation.summary, elements: [], truncated: true }; }
      return { snapshotId: observation.id, ...data };
    };
    const snapshot = (id: string) => {
      const observation = current?.value.observation;
      if (!observation || observation.id !== id || Date.now() - observation.capturedAt > 5000) throw new Error('COMPUTER_STALE_OBSERVATION');
      return observation;
    };
    try {
      const host: ComputerProgramHost = async (method, args, callSignal) => {
        callSignal.throwIfAborted();
        if (!this.getConfig().computer.enabled || Date.now() - s.createdAt >= this.getConfig().computer.maxSessionDurationMs) throw new Error('COMPUTER_SESSION_BUDGET');
        if (JSON.stringify(computerAgentTurn(owner).binding) !== JSON.stringify(s.binding)) throw new Error('COMPUTER_AGENT_MODEL_CHANGED');
        await turn.authorize?.(method, args);
        const hostResult = await (async () => {
        if (method === 'batch') {
          if (s.mode === 'observe') throw new Error('COMPUTER_READ_ONLY');
          return executeComputerBatch(args, host, {
            remainingInputs: (input.maxActions ?? 6) - actions, signal: callSignal,
            state: id => {
              const observation = snapshot(id);
              let data: Record<string, unknown>;
              try { data = JSON.parse(observation.summary); }
              catch { data = { text: observation.summary, elements: [], truncated: true }; }
              return { ...data, snapshotId: id };
            },
            verify: expect => {
              const verification = verifyComputerExpectation(expect, current?.value.observation);
              s.diagnostics.verify(verification);
              return verification;
            },
          });
        }
        if (method === 'observe') {
          const options = z.object({ visual: z.boolean().optional() }).strict().parse(args ?? {});
          const state = await observe(callSignal);
          if (options.visual && current?.frame && current.mimeType) imageRef = retainComputerFrame(owner, execution.toolCallId, current.frame, current.mimeType);
          return state;
        }
        if (method === 'emitScreenshot') {
          const value = z.object({ snapshotId: z.string() }).strict().parse(args);
          snapshot(value.snapshotId);
          if (!current?.frame || !current.mimeType) throw new Error('COMPUTER_FRAME_REQUIRED');
          imageRef = retainComputerFrame(owner, execution.toolCallId, current.frame, current.mimeType);
          return { imageRef };
        }
        if (method === 'resolve') {
          const value = z.object({ snapshotId: z.string(), role: z.string().max(100), label: z.string().max(300) }).strict().parse(args);
          const data = JSON.parse(snapshot(value.snapshotId).summary);
          if (data.truncated || !Array.isArray(data.elements)) throw new Error('COMPUTER_ELEMENT_REF_REQUIRED');
          const candidates = data.elements.filter((e: Record<string, unknown>) => e.role === value.role && e.label === value.label && e.in_web_content !== true);
          if (candidates.length !== 1 || typeof candidates[0].ref !== 'string') throw new Error('COMPUTER_ELEMENT_REF_REQUIRED');
          return candidates[0];
        }
        if (method === 'verify' || method === 'waitFor') {
          const value = z.object({ expect: ComputerExpectationSchema, timeoutMs: z.number().int().min(0).max(5000).optional(), fresh: z.boolean().optional() }).strict().parse(args);
          const deadline = Date.now() + (method === 'waitFor' ? value.timeoutMs ?? 2000 : 0);
          for (let sample = 0; sample < 20; sample++) {
            const cached = current?.value.observation;
            const reuse = sample === 0 && !value.fresh && cached && Date.now() - cached.capturedAt >= 0 && Date.now() - cached.capturedAt <= 5000;
            let state: Record<string, unknown>;
            if (reuse) {
              try { state = { ...JSON.parse(cached.summary), snapshotId: cached.id }; }
              catch { state = { text: cached.summary, elements: [], truncated: true, snapshotId: cached.id }; }
            } else state = await observe(callSignal);
            const verification = verifyComputerExpectation(value.expect, current!.value.observation);
            s.diagnostics.verify(verification);
            if (verification?.status === 'satisfied' || Date.now() >= deadline || sample === 19) return { ...state, verification, observationReused: Boolean(reuse) };
            await delay(Math.min(25 * 2 ** Math.min(sample, 3), 200, Math.max(0, deadline - Date.now())), undefined, { signal: callSignal });
          }
        }
        if (method === 'act') {
          if (s.mode === 'observe') throw new Error('COMPUTER_READ_ONLY');
          const value = z.object({ snapshotId: z.string(), action: ComputerActionSchema, expect: ComputerExpectationSchema.optional() }).strict().parse(args);
          const before = snapshot(value.snapshotId);
          if ((actions += computerActionInputCount(value.action)) > (input.maxActions ?? 6)) throw new Error('COMPUTER_ACTION_BUDGET');
          const action = groundComputerAction(value.action, before);
          s.task.assertProgress(action, before);
          s.pendingContext = { goal: 'Authorized main-agent UI program', before, expectation: value.expect };
          const envelope: ActionEnvelope = { actionId: randomUUID(), sessionId: s.id, observationId: before.id,
            brokerEpoch: before.brokerEpoch, generation: before.generation, grantId: current!.value.grantId!,
            deadlineAt: Date.now() + 120_000, action };
          const context: GoalContext = { observationsReused: 0, stabilityObservations: 0, actionsRemaining: computerActionInputCount(action),
            nativeMs: { precheckMs: 0, inputMs: 0, postObserveMs: 0 } };
          clearComputerFrames(owner); imageRef = undefined;
          current?.frame?.fill(0); current = undefined;
          const reply = await this.dispatchAction(s, envelope, callSignal, context);
          current = context.observation;
          if (reply.receipt) receipts.push(reply.receipt);
          if (reply.errorCode || reply.receipt?.dispatch !== 'completed') throw new Error(reply.errorCode ?? 'COMPUTER_NATIVE_ACTION_FAILED');
          let state: Record<string, unknown> = {};
          try { state = JSON.parse(current?.value.observation?.summary ?? '{}'); } catch { state = { truncated: true }; }
          return { ...state, receipt: reply.receipt, verification: reply.verification, snapshotId: current?.value.observation?.id };
        }
        throw new Error('COMPUTER_INVALID_INPUT');
        })();
        const checked = await turn.complete?.(method, hostResult);
        return checked ?? hostResult;
      };
      const result = await executeComputerProgram(input.code, host, s.programStore ??= Object.create(null), combined, input.timeoutMs);
      if (result.status === 'program_error') { await this.close(owner); return { ...result, sessionId: s.id, receipts }; }
      return { ...result, sessionId: s.id, receipts, ...(imageRef ? { imageRef } : {}), budget: this.budget(s) };
    } catch (error) {
      await this.close(owner);
      throw error;
    } finally { current?.frame?.fill(0); }
  }
  private async executeGoal(owner: string, input: Extract<ComputerUseInput, { op: 'run' }>, signal: AbortSignal,
    diagnostics?: ComputerSessionDiagnostics): Promise<ComputerPublicResult> {
    const startedAt = Date.now();
    const phasesBefore = diagnostics?.snapshot().phaseMs;
    const requestsBefore = diagnostics?.snapshot().counters.modelRequests ?? 0;
    const context: GoalContext = { observationsReused: 0, stabilityObservations: 0, actionsRemaining: input.maxActions ?? 6, nativeMs: { precheckMs: 0, inputMs: 0, postObserveMs: 0 } };
    let actionsExecuted = 0;
    const finish = (result: ComputerPublicResult, stopReason: NonNullable<ComputerPublicResult['run']>['stopReason']) => ({
      ...result, run: { actionsExecuted, modelRequests: (diagnostics?.snapshot().counters.modelRequests ?? 0) - requestsBefore,
        observationsReused: context.observationsReused, stabilityObservations: context.stabilityObservations, nativeMs: context.nativeMs,
        phaseMs: Object.fromEntries(Object.entries(diagnostics?.snapshot().phaseMs ?? {}).map(([key, value]) =>
          [key, value - (phasesBefore?.[key as keyof typeof phasesBefore] ?? 0)])) as ComputerSessionReport['phaseMs'], elapsedMs: Math.max(0, Date.now() - startedAt), stopReason },
    });
    const step = { op: 'step' as const, goal: input.goal, expect: input.expect };
    try {
      while (true) {
        signal.throwIfAborted();
        context.actionsRemaining = (input.maxActions ?? 6) - actionsExecuted;
        let result = await this.executeInput(owner, step, signal, diagnostics, context);
        if (result.receipt?.dispatch === 'completed') actionsExecuted += result.receipt.inputCount ?? 1;
        else actionsExecuted += result.receipt?.steps?.filter(step => step.dispatch === 'completed').length ?? 0;
        if (result.errorCode || result.pending || result.receipt && result.receipt.dispatch !== 'completed') return finish(result, 'handoff');
        if (result.verified) return finish({ ...result, status: 'goal_satisfied' }, 'condition_satisfied');
        if (result.status === 'condition_present') return finish(result, 'condition_present');
        if (!result.receipt || result.status !== 'ready') return finish(result, 'handoff');
        const stopReason = actionsExecuted >= (input.maxActions ?? 6) ? 'action_limit' : Date.now() - startedAt >= 120_000 ? 'time_limit' : undefined;
        if (stopReason) return finish({ ...result, status: 'goal_limit', verified: false,
          nextAction: 'The small-goal budget ended without verifying the condition. Inspect the result and remaining requirements before continuing; do not claim success.' }, stopReason);
      }
    } finally {
      // Pixels live only inside this call, never in session history or across Agent turns.
      context.observation?.frame?.fill(0);
      context.observation = undefined;
      this.sessions.get(owner)?.adapter?.reset?.();
    }
  }
  private async executeInput(owner: string, input: Exclude<ComputerUseInput, { op: 'close' | 'report' | 'flows' | 'forget_flow' | 'run' | 'exec' }>, signal: AbortSignal,
    diagnostics?: ComputerSessionDiagnostics, goalContext?: GoalContext): Promise<ComputerPublicResult> {
    signal.throwIfAborted();
    const config = this.getConfig();
    if (!config.computer.enabled) { await this.close(owner); throw new Error('COMPUTER_DISABLED'); }
    let s = this.sessions.get(owner);
    if (s && !('planner' in s.binding) && s.binding.modelRef.startsWith('xopc-cloud/')) rejectUnbudgetedCloudTransport('computer use');
    if (input.op === 'discover') {
      const endpoint = this.resolveEndpoint(owner);
      const id = randomUUID();
      const reply = await this.send({ endpointId: endpoint.endpointId, id }, { op: 'discover', sessionId: id, owner, query: input.query }, signal);
      reply.frame?.fill(0);
      return this.present(reply.value);
    }
    if (input.op === 'open' && !s) {
      const endpoint = this.resolveEndpoint(owner);
      const effective = resolveEffectiveAgentConfigForSession(owner).config;
      let adapter: ComputerStepAdapter | undefined;
      let binding: ComputerModelBinding;
      let serviceLimits: ComputerServiceLimits | undefined;
      if (input.planner === 'agent') {
        const turn = computerAgentTurn(owner);
        binding = turn.binding;
        turn.cleanup = async () => { await this.close(owner); };
      } else {
      const ref = effective.models.computerUse?.primary;
      if (!ref) throw new Error('COMPUTER_MODEL_REQUIRED');
      const model = resolveModel(ref);
      const profile = computerModelProfile(model);
      if (!profile) throw new Error('COMPUTER_MODEL_CAPABILITY_REQUIRED');
      const apiKey = await getApiKey(model.provider, { agentId: effective.id, appConfig: config });
      if (!apiKey) throw new Error('COMPUTER_MODEL_KEY_MISSING');
      let deployment: { revision: string; origin?: string } | undefined;
      if (model.provider === 'xopc-cloud') {
        rejectUnbudgetedCloudTransport('computer use');
        const response = await fetch(`${model.baseUrl.replace(/\/$/, '')}/models`, { headers: { Authorization: `Bearer ${apiKey}` },
          redirect: 'error', signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(15_000)]) : AbortSignal.timeout(15_000) });
        if (!response.ok) { await response.body?.cancel(); throw new Error('COMPUTER_DEPLOYMENT_UNAVAILABLE'); }
        const body = await readComputerJson(response, 2 * 1024 * 1024) as { data?: Array<{ id: string; xopc?: { computerDeployment?: unknown; computerLimits?: unknown } }> };
        const metadata = body.data?.find(item => item.id === model.id)?.xopc;
        const parsedDeployment = z.object({ revision: z.string().regex(/^[a-f0-9]{64}$/), origin: z.string().url().optional() }).safeParse(metadata?.computerDeployment);
        const parsedLimits = ComputerServiceLimitsSchema.optional().safeParse(metadata?.computerLimits);
        if (!parsedDeployment.success || !parsedLimits.success) throw new Error('COMPUTER_DEPLOYMENT_UNAVAILABLE');
        deployment = parsedDeployment.data; serviceLimits = parsedLimits.data;
      }
      adapter = createComputerModelAdapter({ modelId: model.id, baseUrl: model.baseUrl, api: model.api, apiKey, profile, headers: model.headers, deploymentRevision: deployment?.revision,
        maxOutputTokens: Math.min(2048, model.maxTokens ?? 2048, serviceLimits?.maxOutputTokens ?? 2048) });
      binding = { modelRef: ref, profile, origin: new URL(model.baseUrl).origin, runtimeLocation: 'unknown',
        ...(deployment?.origin ? { upstreamOrigin: deployment.origin } : {}) };
      }
      signal.throwIfAborted();
      s = { id: randomUUID(), owner, appRef: input.appRef, mode: input.mode, prepare: input.prepare, windowRef: input.windowRef, endpointId: endpoint.endpointId, adapter,
        binding,
        createdAt: Date.now(), actions: 0, modelRequests: 0, rescues: 0, rescueLimit: config.computer.maxRescuesPerSession,
        controller: new AbortController(), task: new ComputerTaskState(),
        flowCapture: new ComputerFlowCapture(), flowPrincipalId: endpoint.principalId, flowScope: JSON.stringify([effective.id, effective.workspace]),
        diagnostics: diagnostics!, serviceLimits };
      s.diagnostics.bind(s.id);
      this.sessions.set(owner, s);
      enterComputerControl(owner, async () => { await this.close(owner); });
    }
    if (!s) throw new Error('COMPUTER_OPEN_REQUIRED');
    signal = signal ? AbortSignal.any([signal, s.controller.signal]) : s.controller.signal;
    if (Date.now() - s.createdAt >= config.computer.maxSessionDurationMs) {
      s.diagnostics.fail(new Error('COMPUTER_SESSION_BUDGET'), 'observe', 'notStarted');
      await this.close(owner); throw new Error('COMPUTER_SESSION_BUDGET');
    }
    let phase: 'observe' | 'model' | 'dispatch' = 'observe';
    s.diagnostics.phase = 'observe';
    try {
      if (input.op === 'open') {
        if ((input.planner === 'agent') !== ('planner' in s.binding) || input.appRef !== s.appRef || input.windowRef !== s.windowRef || input.mode !== s.mode || input.prepare !== s.prepare) throw new Error('COMPUTER_CLOSE_BEFORE_TARGET_CHANGE');
        const reply = await this.send(s, { op: 'open', sessionId: s.id, owner, appRef: s.appRef, mode: s.mode, prepare: s.prepare,
          ...(s.windowRef ? { windowRef: s.windowRef } : {}), model: s.binding }, signal);
        if (reply.value.errorCode) s.diagnostics.fail(new Error(reply.value.errorCode), 'open', 'notStarted');
        if (reply.value.status === 'stopped') this.forget(s);
        return { ...this.present(reply.value), ...(reply.value.status !== 'stopped' ? { budget: this.budget(s) } : {}) };
      }
      let status: ObservationReply = goalContext?.observation
        ?? await this.send(s, { op: 'status', sessionId: s.id, owner }, signal);
      if (status.value.status === 'pending_authorization') status = await this.send(s, { op: 'settle', sessionId: s.id, owner }, signal);
      if (status.value.status === 'stopped') {
        if (status.value.errorCode) s.diagnostics.fail(new Error(status.value.errorCode), 'observe', 'notStarted');
        this.forget(s); return this.present(status.value);
      }
      if (input.op === 'step' && s.mode === 'observe') throw new Error('COMPUTER_READ_ONLY');
      if (s.pending) {
        if (input.op === 'observe') return this.present(status.value);
        const context = s.pendingContext;
        phase = 'dispatch';
        const result = await this.dispatchAction(s, s.pending, signal, goalContext);
        if (!this.isUndispatchedChange(result) || !context) return result;
        // Approval resumes the original goal, never a replacement supplied while waiting.
        input = { op: 'step', goal: context.goal, expect: context.expectation, flowId: context.flowId };
        this.reserveRescue(s, signal, result.diagnostic);
      } else if (status.value.status !== 'ready') return this.present(status.value);
      // Explicit reuse starts a fresh model decision, never a queued action from a previous call.
      if (input.op === 'step') {
        if (input.flowId || s.lastFlowId) s.adapter?.reset?.();
        s.lastFlowId = input.flowId;
      }
      while (true) {
        signal.throwIfAborted();
        if (Date.now() - s.createdAt >= config.computer.maxSessionDurationMs) throw new Error('COMPUTER_SESSION_BUDGET');
        phase = 'observe';
        const cached = goalContext?.observation;
        if (goalContext) goalContext.observation = undefined;
        const reuse = cached && status.value.status === 'ready' && cached.value.brokerEpoch === status.value.brokerEpoch
          && cached.value.generation === status.value.generation && cached.value.grantId === status.value.grantId
          && cached.value.observation && Date.now() - cached.value.observation.capturedAt >= 0
          && Date.now() - cached.value.observation.capturedAt <= 5000;
        if (cached && !reuse) cached.frame?.fill(0);
        if (reuse) goalContext!.observationsReused++;
        const observed = reuse ? cached : await this.send(s, { op: 'observe', sessionId: s.id, owner }, signal);
        try {
          if (observed.value.diagnostic && observed.value.errorCode) throw new ComputerOperationError(observed.value.diagnostic);
          const verification = verifyComputerExpectation(input.expect, observed.value.observation);
          if (input.op === 'observe') s.diagnostics.verify(verification);
          if (input.op === 'observe' && !input.question) return { ...this.present(observed.value), verification, verified: verification?.status === 'satisfied', budget: this.budget(s) };
          if (goalContext && input.op === 'step' && input.expect?.kind === 'text' && verification?.status === 'satisfied') {
            return { ...this.present(observed.value), status: 'condition_present', verified: false,
              verification: { ...verification, preexisting: true }, budget: this.budget(s),
              nextAction: 'This text was already visible before input. Choose a page-specific or selected-state condition; no action was dispatched.' };
          }
          if (input.op === 'step' && input.expect?.kind !== 'text' && verification?.status === 'satisfied') {
            s.diagnostics.verify(verification);
            s.adapter?.reset?.();
            return { status: 'condition_satisfied', sessionId: s.id, verification, verified: true, budget: this.budget(s),
              nextAction: 'Only the supplied condition was verified. No input was dispatched. Check remaining task requirements before reporting completion.' };
          }
          if (input.op === 'step' && s.actions >= config.computer.maxActionsPerSession) throw new Error('COMPUTER_ACTION_BUDGET');
          const o = observed.value.observation;
          if (!o || !observed.frame || !observed.mimeType) throw new Error('COMPUTER_FRAME_REQUIRED');
          let flowHint: string | undefined;
          if (input.op === 'step' && input.flowId) {
            const flowId = input.flowId;
            const flow = this.flowStore.list(s.flowScope).find(item => item.id === flowId);
            if (!flow) throw new Error('COMPUTER_FLOW_NOT_FOUND');
            if ((flow.principalId ? flow.principalId !== s.flowPrincipalId : flow.endpointId !== s.endpointId) || flow.appId !== o.target.appId) throw new Error('COMPUTER_FLOW_TARGET_MISMATCH');
            flowHint = computerFlowHint(flow);
          }
          phase = 'model';
          const predictionInput = input;
          if (!s.adapter) throw new Error('COMPUTER_PLANNER_MISMATCH');
          const proposal = await s.diagnostics.measure('model', () => predictComputerStep(s.adapter!, { goal: predictionInput.op === 'observe' ? predictionInput.question! : predictionInput.goal, readOnly: predictionInput.op === 'observe', image: observed.frame, mimeType: observed.mimeType,
            width: o.imageWidth, height: o.imageHeight, summary: o.summary, stateDigest: o.stateDigest,
            maxPlanActions: goalContext?.actionsRemaining, history: s.task.history, expectation: predictionInput.expect, flowHint, onModelRequest: () => {
              if (++s!.modelRequests > config.computer.maxModelRequests) throw new Error('COMPUTER_MODEL_BUDGET');
              s!.diagnostics.count('modelRequests');
            } }, () => {
            s!.diagnostics.count('predictionAttempts');
          }, signal));
          if (proposal.kind === 'answer') return { ...this.present(observed.value), summary: proposal.text, verified: false, verification, budget: this.budget(s) };
          if (input.op === 'observe') throw new Error('COMPUTER_READ_ONLY_MODEL_OUTPUT');
          if (proposal.kind === 'finished') { if (proposal.claimedSuccess) s.diagnostics.count('successClaims'); return { status: 'model_finished', sessionId: s.id, claimedSuccess: proposal.claimedSuccess, verified: false, verification, budget: this.budget(s),
            nextAction: 'The model claim is not proof. Check the requested completion condition using native or artifact evidence before reporting success.' };
          }
          if (proposal.kind === 'takeover') { s.diagnostics.count('takeovers'); return { status: 'takeover', sessionId: s.id, pending: true, budget: this.budget(s), summary: 'The GUI model requests user assistance. Inspect the authorized window locally.' }; }
          const action = groundComputerAction(proposal.action, o);
          if ((action.kind === 'activateSequence' || action.kind === 'batch') && !goalContext) throw new Error('COMPUTER_ACTION_BUDGET');
          const e: ActionEnvelope = { actionId: randomUUID(), sessionId: s.id, observationId: o.id, brokerEpoch: o.brokerEpoch,
            generation: o.generation, grantId: observed.value.grantId!, deadlineAt: Date.now() + 120_000, action };
          s.diagnostics.phase = 'dispatch'; s.task.assertProgress(action, o);
          s.pendingContext = { goal: input.goal, before: o, expectation: input.expect, flowId: input.flowId };
          phase = 'dispatch';
          const result = await this.dispatchAction(s, e, signal, goalContext);
          if (!this.isUndispatchedChange(result)) return result;
          this.reserveRescue(s, signal, result.diagnostic);
        } finally { observed.frame?.fill(0); }
      }
    } catch (error) {
      const failure = signal.aborted || computerDiagnostic(error)
        || (error instanceof Error && /^COMPUTER_[A-Z_0-9]+$/.test(error.message)) ? error
        : new ComputerOperationError({ errorCode: `COMPUTER_${phase.toUpperCase()}_FAILED`, phase, diagnosticId: randomUUID() });
      s.diagnostics.fail(failure, s.diagnostics.phase, undefined, signal.aborted);
      // Never replay an RPC with an unknown delivery outcome.
      await this.close(owner);
      throw failure;
    }
  }
  private isUndispatchedChange(result: ComputerPublicResult): boolean {
    return result.status === 'ready' && result.errorCode === 'COMPUTER_OBSERVATION_CHANGED' && !result.receipt;
  }
  private reserveRescue(s: Session, signal: AbortSignal, diagnostic?: z.infer<typeof ComputerDiagnosticSchema>): void {
    signal.throwIfAborted();
    const limit = Math.min(s.rescueLimit, this.getConfig().computer.maxRescuesPerSession);
    if (s.rescues >= limit) {
      s.diagnostics.count('rescueExhaustions');
      throw diagnostic ? new ComputerOperationError({ ...diagnostic, errorCode: 'COMPUTER_UI_UNSTABLE' }) : new Error('COMPUTER_UI_UNSTABLE');
    }
    s.rescues++;
    s.diagnostics.count('rescueAttempts');
    // Drop queued native batches and continuation state before using a fresh screenshot.
    s.adapter?.reset?.();
  }
  private async dispatchAction(s: Session, envelope: ActionEnvelope, signal?: AbortSignal, goalContext?: GoalContext): Promise<ComputerPublicResult> {
    if (!s.pending) {
      if (s.actions + computerActionInputCount(envelope.action) > this.getConfig().computer.maxActionsPerSession
        || goalContext && computerActionInputCount(envelope.action) > goalContext.actionsRemaining) throw new Error('COMPUTER_ACTION_BUDGET');
      // Reserve once before delivery; resuming the held envelope consumes no extra slot.
      s.actions += computerActionInputCount(envelope.action);
      s.pending = envelope;
      s.diagnostics.propose(envelope.actionId, envelope.action.kind, computerActionInputCount(envelope.action));
    }
    let reply: ObservationReply = await this.send(s, { op: 'act', sessionId: s.id, owner: s.owner, envelope }, signal);
    if (reply.value.status === 'pending_action') {
      reply.frame?.fill(0);
      const settled = await this.send(s, { op: 'settle', sessionId: s.id, owner: s.owner }, signal);
      if (settled.value.status !== 'pending_action' || settled.value.errorCode) reply = settled;
      else reply = await this.send(s, { op: 'act', sessionId: s.id, owner: s.owner, envelope }, signal);
    }
    if (reply.value.receipt && reply.value.receipt.actionId !== envelope.actionId) {
      reply.frame?.fill(0);
      throw new Error('COMPUTER_RECEIPT_MISMATCH');
    }
    if (goalContext && s.adapter?.hasPendingPlan && reply.value.status === 'ready' && !reply.value.errorCode
      && reply.value.receipt?.dispatch === 'completed' && reply.value.observation) {
      // Fast local continuations lack the incidental settling time of a model
      // round trip. Require two equal native snapshots before recording the
      // post-action state used by the remaining conditional plan.
      const receipt = reply.value.receipt;
      const nativeMs = reply.value.nativeMs;
      let stable = false;
      const stability = new ComputerStabilityTracker('post_action', envelope.action.kind);
      try {
        for (let sample = 0; sample < 3; sample++) {
          await delay(100, undefined, { signal });
          const next = await this.send(s, { op: 'observe', sessionId: s.id, owner: s.owner }, signal);
          goalContext.stabilityObservations++;
          const previous = reply;
          reply = { ...next, value: { ...next.value, receipt, nativeMs } };
          if (reply.value.diagnostic?.stability) {
            reply.value.diagnostic = { ...reply.value.diagnostic, stability: { ...reply.value.diagnostic.stability,
              stage: 'post_action', action: envelope.action.kind } };
          }
          previous.frame?.fill(0);
          if (previous.value.brokerEpoch !== next.value.brokerEpoch || previous.value.generation !== next.value.generation
            || previous.value.grantId !== next.value.grantId) { reply.value.errorCode = 'COMPUTER_GRANT_REVOKED'; break; }
          const a = previous.value.observation, b = next.value.observation;
          if (a && b) stability.compare(a, b);
          stable = next.value.status === 'ready' && !next.value.errorCode && !!a && !!b
            && previous.value.brokerEpoch === next.value.brokerEpoch && previous.value.generation === next.value.generation
            && previous.value.grantId === next.value.grantId && a.stateDigest === b.stateDigest
            && JSON.stringify(a.target) === JSON.stringify(b.target);
          if (stable || next.value.status !== 'ready' || next.value.errorCode) break;
        }
        if (!stable && !reply.value.errorCode) {
          reply.value.errorCode = 'COMPUTER_UI_UNSTABLE';
          reply.value.diagnostic = stability.diagnostic('COMPUTER_UI_UNSTABLE', 4);
        }
      } catch (error) {
        // The input is known completed even if subsequent observation fails.
        // Keep its receipt; never turn a failed capture into a replay request.
        reply.frame?.fill(0);
        const diagnostic = computerDiagnostic(error);
        reply = { value: { ...reply.value, receipt,
          errorCode: signal?.aborted ? 'COMPUTER_OPERATION_ABORTED' : diagnostic?.errorCode ?? 'COMPUTER_POST_ACTION_OBSERVATION_FAILED',
          ...(diagnostic ? { diagnostic: { ...diagnostic, ...(diagnostic.stability ? { stability: {
            ...diagnostic.stability, stage: 'post_action' as const, action: envelope.action.kind,
          } } : {}) } } : {}),
        } };
      }
    }
    if (goalContext && reply.value.receipt?.dispatch === 'completed' && reply.value.nativeMs) {
      for (const key of ['precheckMs', 'inputMs', 'postObserveMs'] as const) goalContext.nativeMs[key] += reply.value.nativeMs[key];
    }
    if (reply.value.status !== 'pending_action') s.pending = undefined;
    if (goalContext && reply.value.status === 'ready' && !reply.value.errorCode && reply.value.receipt?.dispatch === 'completed'
      && reply.frame && reply.mimeType && reply.value.observation) {
      goalContext.observation?.frame?.fill(0);
      goalContext.observation = reply;
    } else reply.frame?.fill(0);
    if (reply.value.status === 'ready' && reply.value.errorCode === 'COMPUTER_OBSERVATION_CHANGED' && !reply.value.receipt) {
      s.diagnostics.discard();
      s.actions -= computerActionInputCount(envelope.action); s.pendingContext = undefined;
      return { ...this.present(reply.value), budget: this.budget(s) };
    }
    const context = s.pendingContext;
    const verification = verifyComputerExpectation(context?.expectation, reply.value.observation, context?.before);
    if (reply.value.receipt) s.diagnostics.record(reply.value.receipt, context?.before, reply.value.observation, verification);
    const failureCode = reply.value.errorCode ?? (reply.value.receipt?.dispatch === 'unknown' || reply.value.receipt?.dispatch === 'started'
      ? reply.value.receipt.errorCode ?? 'COMPUTER_NATIVE_ACTION_FAILED' : undefined);
    if (failureCode) s.diagnostics.fail(reply.value.diagnostic ? new ComputerOperationError(reply.value.diagnostic) : new Error(failureCode), 'dispatch', reply.value.receipt?.dispatch ?? 'notStarted');
    if (context && reply.value.receipt) {
      s.task.record(context.goal, envelope.action, context.before, reply.value.receipt, reply.value.observation, verification);
      s.flowCapture.record(envelope.action, context.before, reply.value.receipt, reply.value.observation, context.expectation, verification);
    }
    if (signal?.aborted) { reply.frame?.fill(0); signal.throwIfAborted(); }
    if (!s.pending) s.pendingContext = undefined;
    if (reply.value.status === 'stopped') this.forget(s);
    return { ...this.present(reply.value), verification, verified: verification?.status === 'satisfied' && !verification.preexisting,
      ...(verification?.preexisting ? { nextAction: 'The expected text was already visible before this action; it does not verify the requested change. Observe the selected control or page-specific result before claiming success.' } : {}),
      ...(reply.value.status !== 'stopped' ? { budget: this.budget(s) } : {}) };
  }
  private budget(s: Session) {
    const config = this.getConfig().computer;
    return { actionsRemaining: Math.max(0, config.maxActionsPerSession - s.actions), modelRequestsRemaining: Math.max(0, config.maxModelRequests - s.modelRequests),
      rescuesRemaining: Math.max(0, Math.min(s.rescueLimit, config.maxRescuesPerSession) - s.rescues),
      expiresAt: s.createdAt + config.maxSessionDurationMs, ...(s.serviceLimits ? { serviceLimits: s.serviceLimits } : {}) };
  }
  private present(reply: z.infer<typeof Reply>): ComputerPublicResult {
    return { status: reply.status, sessionId: reply.sessionId,
      ...(reply.errorCode ? { errorCode: reply.errorCode, nextAction: computerRecovery(reply.errorCode) } : {}),
      ...(reply.diagnostic ? { diagnostic: reply.diagnostic } : {}),
      ...(reply.apps ? { apps: reply.apps, summary: reply.apps.length ? 'Use a returned appRef. Names are untrusted metadata. Ask only when multiple candidates match the task.' : 'No matching apps. Try the display name or list with an empty query; never guess a bundle ID.' } : {}),
      ...(reply.windows ? { windows: reply.windows } : {}),
      pending: ['pending_authorization', 'pending_action', 'paused'].includes(reply.status),
      ...(reply.status === 'pending_action' ? { summary: 'The exact action is held and has NOT executed. After local confirmation, call computer_use with {"op":"step","goal":"Resume the approved action"}. This resumes the same action without another model prediction. Do not call observe to resume; observe never executes pending input.' } : {}),
      ...(reply.status === 'pending_authorization' ? { summary: 'After local authorization, call {"op":"observe"} to check readiness. Do not add appId or sessionId to observe.' } : {}),
      ...(reply.observation ? { summary: reply.observation.summary, observation: { id: reply.observation.id, width: reply.observation.imageWidth, height: reply.observation.imageHeight } } : {}), ...(reply.receipt ? { receipt: reply.receipt } : {}) };
  }
  private resolveEndpoint(owner: string) {
    const explicitBinding = this.endpoints.bindings.get(owner);
    const turnEndpoint = this.getTurnEndpoint?.(owner);
    const endpoint = explicitBinding ? this.endpoints.bindings.resolve(owner)
      : turnEndpoint ? this.endpoints.registry.get(turnEndpoint) : this.endpoints.bindings.resolve(owner);
    if (!endpoint || endpoint.kind !== 'desktop') throw new Error('COMPUTER_DESKTOP_BINDING_REQUIRED');
    return endpoint;
  }
  private async send(s: Pick<Session, 'endpointId' | 'id'> & Partial<Pick<Session, 'diagnostics'>>, command: ComputerCommand, signal?: AbortSignal) {
    signal?.throwIfAborted();
    const tool = this.endpoints.registry.getTool(s.endpointId, COMPUTER_CONTROL_TOOL);
    if (!tool) throw new Error('COMPUTER_DESKTOP_UPGRADE_REQUIRED');
    const invoke = () => this.endpoints.invocations.invoke({ endpointId: s.endpointId, toolCallId: randomUUID(),
      toolName: COMPUTER_CONTROL_TOOL, arguments: command, descriptorRevision: tool.revision, signal });
    const phase = command.op === 'open' ? 'open' : command.op === 'act' ? 'dispatch' : command.op === 'observe' ? 'observe' : command.op === 'release' ? 'release' : undefined;
    if (command.op === 'observe') s.diagnostics?.count('observations');
    const startedAt = performance.now();
    const reply = s.diagnostics && phase ? await s.diagnostics.measure(phase, invoke) : await invoke();
    const endpointRoundTripMs = performance.now() - startedAt;
    const file = reply.content.find((item) => item.type === 'file');
    let frame: Uint8Array | undefined;
    if (file?.type === 'file' && reply.invocationId) frame = this.endpoints.uploads.takeComputerFrame(file.fileId, reply.invocationId);
    try {
      signal?.throwIfAborted();
      const json = reply.content.find((item) => item.type === 'json');
      const value = Reply.parse(json?.type === 'json' ? json.value : undefined);
      if (value.sessionId !== s.id) throw new Error('COMPUTER_SESSION_MISMATCH');
      if (command.op === 'act' && value.receipt?.actionId === command.envelope.actionId && (value.nativeMs || value.transportTiming)) {
        s.diagnostics?.timing({ actionId: value.receipt.actionId, kind: command.envelope.action.kind, nativeMs: value.nativeMs,
          transport: value.transportTiming, endpointRoundTripMs });
      }
      if ((file && !frame) || (value.observation && !frame && !value.errorCode)) throw new Error('COMPUTER_FRAME_HANDOFF_FAILED');
      if (frame && (!value.observation || !['observe', 'act'].includes(command.op))) throw new Error('COMPUTER_UNEXPECTED_FRAME');
      return { value, frame, mimeType: file?.type === 'file' ? file.mimeType as 'image/png' | 'image/jpeg' : undefined };
    } catch (error) { frame?.fill(0); throw error; }
  }
  private forget(s: Session): void {
    if (this.sessions.get(s.owner) !== s) return;
    this.sessions.delete(s.owner); leaveComputerControl(s.owner);
    s.diagnostics.finish(true); this.retainReport(s.owner, s.diagnostics);
    clearComputerFrames(s.owner); s.programStore = undefined;
    s.task.clear(); s.pendingContext = undefined; s.controller.abort();
  }
  async close(owner: string): Promise<boolean> {
    this.operations.get(owner)?.abort();
    clearComputerFrames(owner);
    const s = this.sessions.get(owner); if (!s) return true;
    s.programStore = undefined;
    s.task.clear(); s.pendingContext = undefined;
    s.controller.abort();
    try {
      const reply = await this.send(s, { op: 'release', sessionId: s.id, owner }, AbortSignal.timeout(5000));
      if (reply.value.status === 'stopped') { this.forget(s); return true; }
    } catch (error) {
      if (error instanceof Error && error.message === 'COMPUTER_SESSION_NOT_FOUND') { this.forget(s); return true; }
      // Retain the admission gate until desktop revocation is confirmed.
    }
    s.diagnostics.fail(new Error('COMPUTER_RELEASE_UNCONFIRMED'), 'release', 'unknown');
    s.diagnostics.finish(false);
    return false;
  }
  getReport(owner: string): ComputerSessionReport | undefined {
    this.pruneReports();
    return (this.sessions.get(owner)?.diagnostics ?? this.openingReports.get(owner) ?? this.reports.get(owner)?.diagnostics)?.snapshot();
  }
  private retainReport(owner: string, diagnostics: ComputerSessionDiagnostics): void {
    this.pruneReports();
    const previous = this.reports.get(owner);
    this.reports.delete(owner);
    this.reports.set(owner, { diagnostics, expiresAt: Date.now() + 30 * 60_000 });
    while (this.reports.size > 32) this.reports.delete(this.reports.keys().next().value!);
    if (previous?.diagnostics !== diagnostics) {
      const report = diagnostics.snapshot();
      log.info({ reportId: report.reportId, conversationId: owner, sessionId: report.sessionId,
        status: report.status, durationMs: report.durationMs, counters: report.counters, failure: report.failure }, 'Computer session diagnostics retained');
    }
  }
  private pruneReports(): void {
    for (const [owner, report] of this.reports) if (report.expiresAt <= Date.now()) this.reports.delete(owner);
  }
  async shutdown(): Promise<void> { await Promise.all([...new Set([...this.sessions.keys(), ...this.operations.keys()])].map((owner) => this.close(owner))); }
}
