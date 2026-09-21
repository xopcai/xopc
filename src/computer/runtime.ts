import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  COMPUTER_CONTROL_TOOL, ComputerAppSchema, ComputerWindowSchema, ComputerObservationSchema,
  type ActionEnvelope, type ComputerCommand, type ComputerModelBinding,
} from '@xopcai/computer-control-contract';
import type { EndpointToolRuntime } from '../endpoint-tools/runtime.js';
import type { Config } from '../config/schema.js';
import { resolveEffectiveAgentConfigForSession } from '../config/agent-profile.js';
import { getApiKey, resolveModel } from '../providers/index.js';
import { createComputerModelAdapter, predictComputerStep, readComputerJson, type ComputerStepAdapter } from './model-adapter.js';
import { enterComputerControl, leaveComputerControl } from './control-guard.js';
import { computerModelProfile, ComputerServiceLimitsSchema, type ComputerServiceLimits } from './model-policy.js';
import { ComputerDiagnosticSchema, ComputerOperationError, computerDiagnostic, computerRecovery } from './errors.js';
import { createLogger } from '../utils/logger.js';
import { ComputerExpectationSchema, ComputerTaskState, verifyComputerExpectation,
  type ComputerExpectation, type ComputerVerification } from './task-state.js';

const log = createLogger('ComputerRuntime');

const Reply = z.object({
  status: z.enum(['pending_authorization', 'ready', 'running', 'pending_action', 'paused', 'stopped']),
  sessionId: z.string(), brokerEpoch: z.string(), generation: z.number().int().nonnegative(),
  grantId: z.string().optional(), observation: ComputerObservationSchema.optional(),
  errorCode: z.string().optional(),
  diagnostic: ComputerDiagnosticSchema.optional(),
  apps: z.array(ComputerAppSchema).max(100).optional(), windows: z.array(ComputerWindowSchema).max(100).optional(),
  receipt: z.object({ actionId: z.string(), dispatch: z.enum(['notStarted', 'started', 'completed', 'unknown']), outcome: z.enum(['applied', 'notApplied', 'unknown']), verification: z.enum(['semantic', 'artifact', 'visual', 'none']), errorCode: z.string().optional() }).optional(),
}).strict();
type Session = {
  id: string; owner: string; endpointId: string; appRef: string; mode: 'observe' | 'control'; prepare: boolean; windowRef?: string; binding: ComputerModelBinding;
  adapter: ComputerStepAdapter; createdAt: number; modelRequests: number; actions: number;
  pending?: ActionEnvelope; controller: AbortController;
  task: ComputerTaskState;
  pendingContext?: { goal: string; before: z.infer<typeof ComputerObservationSchema>; expectation?: ComputerExpectation };
  serviceLimits?: ComputerServiceLimits;
};
export const ComputerUseInputSchema = z.discriminatedUnion('op', [
  z.object({ op: z.literal('discover'), query: z.string().max(200) }).strict(),
  z.object({ op: z.literal('open'), appRef: z.string().min(1).max(200), windowRef: z.string().min(1).max(200).optional(),
    mode: z.enum(['observe', 'control']), prepare: z.boolean() }).strict(),
  z.object({ op: z.literal('observe'), question: z.string().min(1).max(4000).optional(), expect: ComputerExpectationSchema.optional() }).strict(),
  z.object({ op: z.literal('step'), goal: z.string().min(1).max(4000), expect: ComputerExpectationSchema.optional() }).strict(),
  z.object({ op: z.literal('close') }).strict(),
]);
export type ComputerUseInput = z.infer<typeof ComputerUseInputSchema>;
export interface ComputerPublicResult {
  status: string; sessionId: string; pending?: boolean; summary?: string;
  receipt?: z.infer<typeof Reply>['receipt']; claimedSuccess?: boolean; verified?: boolean;
  verification?: ComputerVerification;
  budget?: { actionsRemaining: number; modelRequestsRemaining: number; expiresAt: number; serviceLimits?: ComputerServiceLimits };
  handoff?: { recentActions: Array<{ goal: string; action: string; dispatch: string; outcome: string; verification?: ComputerVerification }> };
  observation?: { id: string; width: number; height: number };
  errorCode?: string;
  diagnostic?: z.infer<typeof ComputerDiagnosticSchema>;
  nextAction?: string;
  apps?: z.infer<typeof ComputerAppSchema>[];
  windows?: z.infer<typeof ComputerWindowSchema>[];
}

export class ComputerRuntime {
  private readonly sessions = new Map<string, Session>();
  private readonly operations = new Map<string, AbortController>();
  constructor(private readonly endpoints: EndpointToolRuntime, private readonly getConfig: () => Config,
    private readonly getTurnEndpoint?: (owner: string) => string | undefined) {}

  async execute(owner: string, input: ComputerUseInput, signal?: AbortSignal): Promise<ComputerPublicResult> {
    input = ComputerUseInputSchema.parse(input);
    if (!owner) throw new Error('COMPUTER_CONVERSATION_REQUIRED');
    if (input.op === 'close') {
      const session = this.sessions.get(owner);
      const sessionId = session?.id ?? 'none';
      const handoff = { recentActions: (session?.task.history ?? []).map(({ goal, action, dispatch, outcome, verification }) => ({ goal, action, dispatch, outcome, verification })) };
      const released = await this.close(owner);
      return released ? { status: 'stopped', sessionId, handoff,
        nextAction: 'Desktop control is released. Continue with an appropriate authorized tool; this does not permit bypassing a desktop refusal.' }
        : { status: 'stop_unconfirmed', sessionId, errorCode: 'COMPUTER_RELEASE_UNCONFIRMED', nextAction: computerRecovery('COMPUTER_RELEASE_UNCONFIRMED') };
    }
    if (this.operations.has(owner)) throw new Error('COMPUTER_BUSY');
    const operation = new AbortController(); this.operations.set(owner, operation);
    try {
      return await this.executeInput(owner, input, signal ? AbortSignal.any([signal, operation.signal]) : operation.signal);
    } finally { if (this.operations.get(owner) === operation) this.operations.delete(owner); }
  }
  private async executeInput(owner: string, input: Exclude<ComputerUseInput, { op: 'close' }>, signal: AbortSignal): Promise<ComputerPublicResult> {
    signal.throwIfAborted();
    const config = this.getConfig();
    if (!config.computer.enabled) { await this.close(owner); throw new Error('COMPUTER_DISABLED'); }
    let s = this.sessions.get(owner);
    if (input.op === 'discover') {
      const endpoint = this.resolveEndpoint(owner);
      const id = randomUUID();
      const reply = await this.send({ endpointId: endpoint.endpointId, id }, { op: 'discover', sessionId: id, owner, query: input.query }, signal);
      reply.frame?.fill(0);
      return this.present(reply.value);
    }
    if (input.op === 'open' && !s) {
      const endpoint = this.resolveEndpoint(owner);
      const effective = resolveEffectiveAgentConfigForSession(config, owner).config;
      const ref = effective.models.computerUse?.primary;
      if (!ref) throw new Error('COMPUTER_MODEL_REQUIRED');
      const model = resolveModel(ref);
      const profile = computerModelProfile(model);
      if (!profile) throw new Error('COMPUTER_MODEL_CAPABILITY_REQUIRED');
      const apiKey = await getApiKey(model.provider, { agentId: effective.id, appConfig: config });
      if (!apiKey) throw new Error('COMPUTER_MODEL_KEY_MISSING');
      let deployment: { revision: string; origin: string } | undefined;
      let serviceLimits: ComputerServiceLimits | undefined;
      if (model.provider === 'xopc-cloud') {
        const response = await fetch(`${model.baseUrl.replace(/\/$/, '')}/models`, { headers: { Authorization: `Bearer ${apiKey}` },
          redirect: 'error', signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(15_000)]) : AbortSignal.timeout(15_000) });
        if (!response.ok) { await response.body?.cancel(); throw new Error('COMPUTER_DEPLOYMENT_UNAVAILABLE'); }
        const body = await readComputerJson(response, 2 * 1024 * 1024) as { data?: Array<{ id: string; xopc?: { computerDeployment?: unknown; computerLimits?: unknown } }> };
        const metadata = body.data?.find(item => item.id === model.id)?.xopc;
        const parsedDeployment = z.object({ revision: z.string().regex(/^[a-f0-9]{64}$/), origin: z.string().url() }).safeParse(metadata?.computerDeployment);
        const parsedLimits = ComputerServiceLimitsSchema.optional().safeParse(metadata?.computerLimits);
        if (!parsedDeployment.success || !parsedLimits.success) throw new Error('COMPUTER_DEPLOYMENT_UNAVAILABLE');
        deployment = parsedDeployment.data; serviceLimits = parsedLimits.data;
      }
      const adapter = createComputerModelAdapter({ modelId: model.id, baseUrl: model.baseUrl, apiKey, profile, headers: model.headers, deploymentRevision: deployment?.revision,
        maxOutputTokens: Math.min(2048, model.maxTokens ?? 2048, serviceLimits?.maxOutputTokens ?? 2048) });
      signal.throwIfAborted();
      s = { id: randomUUID(), owner, appRef: input.appRef, mode: input.mode, prepare: input.prepare, windowRef: input.windowRef, endpointId: endpoint.endpointId, adapter,
        binding: { modelRef: ref, profile, origin: new URL(model.baseUrl).origin, runtimeLocation: 'unknown',
          ...(deployment ? { upstreamOrigin: deployment.origin } : {}) },
        createdAt: Date.now(), actions: 0, modelRequests: 0, controller: new AbortController(), task: new ComputerTaskState(), serviceLimits };
      this.sessions.set(owner, s);
      enterComputerControl(owner, async () => { await this.close(owner); });
    }
    if (!s) throw new Error('COMPUTER_OPEN_REQUIRED');
    signal = signal ? AbortSignal.any([signal, s.controller.signal]) : s.controller.signal;
    if (Date.now() - s.createdAt >= config.computer.maxSessionDurationMs) {
      await this.close(owner); throw new Error('COMPUTER_SESSION_BUDGET');
    }
    let phase: 'observe' | 'model' | 'dispatch' = 'observe';
    try {
      if (input.op === 'open') {
        if (input.appRef !== s.appRef || input.windowRef !== s.windowRef || input.mode !== s.mode || input.prepare !== s.prepare) throw new Error('COMPUTER_CLOSE_BEFORE_TARGET_CHANGE');
        const reply = await this.send(s, { op: 'open', sessionId: s.id, owner, appRef: s.appRef, mode: s.mode, prepare: s.prepare,
          ...(s.windowRef ? { windowRef: s.windowRef } : {}), model: s.binding }, signal);
        if (reply.value.status === 'stopped') this.forget(s);
        return { ...this.present(reply.value), ...(reply.value.status !== 'stopped' ? { budget: this.budget(s) } : {}) };
      }
      const status = await this.send(s, { op: 'status', sessionId: s.id, owner }, signal);
      if (status.value.status === 'stopped') { this.forget(s); return this.present(status.value); }
      if (input.op === 'step' && s.mode === 'observe') throw new Error('COMPUTER_READ_ONLY');
      if (s.pending) {
        if (input.op === 'observe') return this.present(status.value);
        phase = 'dispatch';
        return await this.dispatchAction(s, s.pending, signal);
      }
      if (status.value.status !== 'ready') return this.present(status.value);
      for (let observationAttempt = 0; observationAttempt < 2; observationAttempt++) {
        const observed = await this.send(s, { op: 'observe', sessionId: s.id, owner }, signal);
        try {
          const verification = verifyComputerExpectation(input.expect, observed.value.observation);
          if (input.op === 'observe' && !input.question) return { ...this.present(observed.value), verification, verified: verification?.status === 'satisfied', budget: this.budget(s) };
          if (input.op === 'step' && input.expect?.kind !== 'text' && verification?.status === 'satisfied') {
            s.adapter.reset?.();
            return { status: 'condition_satisfied', sessionId: s.id, verification, verified: true, budget: this.budget(s),
              nextAction: 'Only the supplied condition was verified. No input was dispatched. Check remaining task requirements before reporting completion.' };
          }
          if (input.op === 'step' && s.actions >= config.computer.maxActionsPerSession) throw new Error('COMPUTER_ACTION_BUDGET');
          const o = observed.value.observation;
          if (!o || !observed.frame || !observed.mimeType) throw new Error('COMPUTER_FRAME_REQUIRED');
          phase = 'model';
          const proposal = await predictComputerStep(s.adapter, { goal: input.op === 'observe' ? input.question! : input.goal, readOnly: input.op === 'observe', image: observed.frame, mimeType: observed.mimeType,
            width: o.imageWidth, height: o.imageHeight, summary: o.summary, stateDigest: o.stateDigest,
            history: s.task.history, expectation: input.expect }, () => {
            if (++s!.modelRequests > config.computer.maxModelRequests) throw new Error('COMPUTER_MODEL_BUDGET');
          }, signal);
          if (proposal.kind === 'answer') return { ...this.present(observed.value), summary: proposal.text, verified: false, verification, budget: this.budget(s) };
          if (input.op === 'observe') throw new Error('COMPUTER_READ_ONLY_MODEL_OUTPUT');
          if (proposal.kind === 'finished') return { status: 'model_finished', sessionId: s.id, claimedSuccess: proposal.claimedSuccess, verified: false, verification, budget: this.budget(s),
            nextAction: 'The model claim is not proof. Check the requested completion condition using native or artifact evidence before reporting success.' };
          if (proposal.kind === 'takeover') return { status: 'takeover', sessionId: s.id, pending: true, budget: this.budget(s), summary: 'The GUI model requests user assistance. Inspect the authorized window locally.' };
          const e: ActionEnvelope = { actionId: randomUUID(), sessionId: s.id, observationId: o.id, brokerEpoch: o.brokerEpoch,
            generation: o.generation, grantId: observed.value.grantId!, deadlineAt: Date.now() + 120_000, action: proposal.action };
          s.task.assertProgress(proposal.action, o);
          s.pendingContext = { goal: input.goal, before: o, expectation: input.expect };
          phase = 'dispatch';
          const result = await this.dispatchAction(s, e, signal);
          if (result.status !== 'ready' || result.receipt || result.errorCode !== 'COMPUTER_OBSERVATION_CHANGED') return result;
          // The broker positively confirms no dispatch. Re-observe and re-plan, never replay.
          phase = 'observe';
        } finally { observed.frame?.fill(0); }
      }
      throw new Error('COMPUTER_UI_UNSTABLE');
    } catch (error) {
      const failure = signal.aborted || computerDiagnostic(error)
        || (error instanceof Error && /^COMPUTER_[A-Z_0-9]+$/.test(error.message)) ? error
        : new ComputerOperationError({ errorCode: `COMPUTER_${phase.toUpperCase()}_FAILED`, phase, diagnosticId: randomUUID() });
      const diagnostic = computerDiagnostic(failure);
      if (diagnostic) log.warn({ ...diagnostic, conversationId: owner, sessionId: s.id }, `Computer operation failed: ${diagnostic.errorCode}`);
      // Never replay an RPC with an unknown delivery outcome.
      await this.close(owner);
      throw failure;
    }
  }
  private async dispatchAction(s: Session, envelope: ActionEnvelope, signal?: AbortSignal): Promise<ComputerPublicResult> {
    if (!s.pending) {
      if (s.actions >= this.getConfig().computer.maxActionsPerSession) throw new Error('COMPUTER_ACTION_BUDGET');
      // Reserve once before delivery; resuming the held envelope consumes no extra slot.
      s.actions++;
      s.pending = envelope;
    }
    const reply = await this.send(s, { op: 'act', sessionId: s.id, owner: s.owner, envelope }, signal);
    if (reply.value.status !== 'pending_action') s.pending = undefined;
    reply.frame?.fill(0);
    if (reply.value.status === 'ready' && reply.value.errorCode === 'COMPUTER_OBSERVATION_CHANGED' && !reply.value.receipt) {
      s.actions--; s.pendingContext = undefined;
      return { ...this.present(reply.value), budget: this.budget(s) };
    }
    const context = s.pendingContext;
    const verification = verifyComputerExpectation(context?.expectation, reply.value.observation, context?.before);
    if (context && reply.value.receipt) s.task.record(context.goal, envelope.action, context.before, reply.value.receipt, reply.value.observation, verification);
    if (!s.pending) s.pendingContext = undefined;
    if (reply.value.status === 'stopped') this.forget(s);
    return { ...this.present(reply.value), verification, verified: verification?.status === 'satisfied' && !verification.preexisting,
      ...(verification?.preexisting ? { nextAction: 'The expected text was already visible before this action; it does not verify the requested change. Observe the selected control or page-specific result before claiming success.' } : {}),
      ...(reply.value.status !== 'stopped' ? { budget: this.budget(s) } : {}) };
  }
  private budget(s: Session) {
    const config = this.getConfig().computer;
    return { actionsRemaining: Math.max(0, config.maxActionsPerSession - s.actions), modelRequestsRemaining: Math.max(0, config.maxModelRequests - s.modelRequests),
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
  private async send(s: Pick<Session, 'endpointId' | 'id'>, command: ComputerCommand, signal?: AbortSignal) {
    signal?.throwIfAborted();
    const tool = this.endpoints.registry.getTool(s.endpointId, COMPUTER_CONTROL_TOOL);
    if (!tool) throw new Error('COMPUTER_DESKTOP_UPGRADE_REQUIRED');
    const reply = await this.endpoints.invocations.invoke({ endpointId: s.endpointId, toolCallId: randomUUID(),
      toolName: COMPUTER_CONTROL_TOOL, arguments: command, descriptorRevision: tool.revision, signal });
    const file = reply.content.find((item) => item.type === 'file');
    let frame: Uint8Array | undefined;
    if (file?.type === 'file' && reply.invocationId) frame = this.endpoints.uploads.takeComputerFrame(file.fileId, reply.invocationId);
    try {
      signal?.throwIfAborted();
      const json = reply.content.find((item) => item.type === 'json');
      const value = Reply.parse(json?.type === 'json' ? json.value : undefined);
      if (value.sessionId !== s.id) throw new Error('COMPUTER_SESSION_MISMATCH');
      if ((file && !frame) || (value.observation && !frame && !value.errorCode)) throw new Error('COMPUTER_FRAME_HANDOFF_FAILED');
      if (frame && (!value.observation || !['observe', 'act'].includes(command.op))) throw new Error('COMPUTER_UNEXPECTED_FRAME');
      return { value, frame, mimeType: file?.type === 'file' ? file.mimeType as 'image/png' | 'image/jpeg' : undefined };
    } catch (error) { frame?.fill(0); throw error; }
  }
  private forget(s: Session): void {
    if (this.sessions.get(s.owner) !== s) return;
    this.sessions.delete(s.owner); leaveComputerControl(s.owner);
    s.task.clear(); s.pendingContext = undefined; s.controller.abort();
  }
  async close(owner: string): Promise<boolean> {
    this.operations.get(owner)?.abort();
    const s = this.sessions.get(owner); if (!s) return true;
    s.task.clear(); s.pendingContext = undefined;
    s.controller.abort();
    try {
      const reply = await this.send(s, { op: 'release', sessionId: s.id, owner }, AbortSignal.timeout(5000));
      if (reply.value.status === 'stopped') { this.forget(s); return true; }
    } catch (error) {
      if (error instanceof Error && error.message === 'COMPUTER_SESSION_NOT_FOUND') { this.forget(s); return true; }
      // Retain the admission gate until desktop revocation is confirmed.
    }
    return false;
  }
  async shutdown(): Promise<void> { await Promise.all([...new Set([...this.sessions.keys(), ...this.operations.keys()])].map((owner) => this.close(owner))); }
}
