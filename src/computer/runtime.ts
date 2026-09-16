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
import { ComputerModelAdapter, predictComputerStep, readComputerJson } from './model-adapter.js';
import { enterComputerControl, leaveComputerControl } from './control-guard.js';
import { computerModelProfile } from './model-policy.js';
import { computerRecovery } from './errors.js';

const Reply = z.object({
  status: z.enum(['pending_authorization', 'ready', 'running', 'pending_action', 'paused', 'stopped']),
  sessionId: z.string(), brokerEpoch: z.string(), generation: z.number().int().nonnegative(),
  grantId: z.string().optional(), observation: ComputerObservationSchema.optional(),
  errorCode: z.string().optional(),
  apps: z.array(ComputerAppSchema).max(100).optional(), windows: z.array(ComputerWindowSchema).max(100).optional(),
  receipt: z.object({ actionId: z.string(), dispatch: z.enum(['notStarted', 'started', 'completed', 'unknown']), outcome: z.enum(['applied', 'notApplied', 'unknown']), verification: z.enum(['semantic', 'artifact', 'visual', 'none']), errorCode: z.string().optional() }).optional(),
}).strict();
type Session = {
  id: string; owner: string; endpointId: string; appRef: string; mode: 'observe' | 'control'; prepare: boolean; windowRef?: string; binding: ComputerModelBinding;
  adapter: ComputerModelAdapter; createdAt: number; modelRequests: number; actions: number;
  pending?: ActionEnvelope; controller: AbortController;
};
export const ComputerUseInputSchema = z.discriminatedUnion('op', [
  z.object({ op: z.literal('discover'), query: z.string().max(200) }).strict(),
  z.object({ op: z.literal('open'), appRef: z.string().min(1).max(200), windowRef: z.string().min(1).max(200).optional(),
    mode: z.enum(['observe', 'control']), prepare: z.boolean() }).strict(),
  z.object({ op: z.literal('observe'), question: z.string().min(1).max(4000).optional() }).strict(),
  z.object({ op: z.literal('step'), goal: z.string().min(1).max(4000) }).strict(),
  z.object({ op: z.literal('close') }).strict(),
]);
export type ComputerUseInput = z.infer<typeof ComputerUseInputSchema>;
export interface ComputerPublicResult {
  status: string; sessionId: string; pending?: boolean; summary?: string;
  receipt?: z.infer<typeof Reply>['receipt']; claimedSuccess?: boolean; verified?: false;
  observation?: { id: string; width: number; height: number };
  errorCode?: string;
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
      const sessionId = this.sessions.get(owner)?.id ?? 'none';
      await this.close(owner); return { status: 'stopped', sessionId };
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
      if (model.provider === 'xopc-cloud') {
        const response = await fetch(`${model.baseUrl.replace(/\/$/, '')}/models`, { headers: { Authorization: `Bearer ${apiKey}` },
          redirect: 'error', signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(15_000)]) : AbortSignal.timeout(15_000) });
        if (!response.ok) { await response.body?.cancel(); throw new Error('COMPUTER_DEPLOYMENT_UNAVAILABLE'); }
        const body = await readComputerJson(response, 2 * 1024 * 1024) as { data?: Array<{ id: string; xopc?: { computerDeployment?: unknown } }> };
        deployment = z.object({ revision: z.string().regex(/^[a-f0-9]{64}$/), origin: z.string().url() }).parse(body.data?.find(item => item.id === model.id)?.xopc?.computerDeployment);
      }
      const adapter = new ComputerModelAdapter({ modelId: model.id, baseUrl: model.baseUrl, apiKey, profile, headers: model.headers, deploymentRevision: deployment?.revision });
      signal.throwIfAborted();
      s = { id: randomUUID(), owner, appRef: input.appRef, mode: input.mode, prepare: input.prepare, windowRef: input.windowRef, endpointId: endpoint.endpointId, adapter,
        binding: { modelRef: ref, profile, origin: new URL(model.baseUrl).origin, runtimeLocation: 'unknown',
          ...(deployment ? { upstreamOrigin: deployment.origin } : {}) },
        createdAt: Date.now(), actions: 0, modelRequests: 0, controller: new AbortController() };
      this.sessions.set(owner, s);
      enterComputerControl(owner, () => this.close(owner));
    }
    if (!s) throw new Error('COMPUTER_OPEN_REQUIRED');
    signal = signal ? AbortSignal.any([signal, s.controller.signal]) : s.controller.signal;
    if (Date.now() - s.createdAt >= config.computer.maxSessionDurationMs) {
      await this.close(owner); throw new Error('COMPUTER_SESSION_BUDGET');
    }
    try {
      if (input.op === 'open') {
        if (input.appRef !== s.appRef || input.windowRef !== s.windowRef || input.mode !== s.mode || input.prepare !== s.prepare) throw new Error('COMPUTER_CLOSE_BEFORE_TARGET_CHANGE');
        const reply = await this.send(s, { op: 'open', sessionId: s.id, owner, appRef: s.appRef, mode: s.mode, prepare: s.prepare,
          ...(s.windowRef ? { windowRef: s.windowRef } : {}), model: s.binding }, signal);
        if (reply.value.status === 'stopped') await this.close(owner);
        return this.present(reply.value);
      }
      const status = await this.send(s, { op: 'status', sessionId: s.id, owner }, signal);
      if (status.value.status === 'stopped') { this.sessions.delete(owner); leaveComputerControl(owner); return this.present(status.value); }
      if (input.op === 'step' && s.mode === 'observe') throw new Error('COMPUTER_READ_ONLY');
      if (s.pending) {
        if (input.op === 'observe') return this.present(status.value);
        return await this.dispatchAction(s, s.pending, signal);
      }
      if (status.value.status !== 'ready') return this.present(status.value);
      const observed = await this.send(s, { op: 'observe', sessionId: s.id, owner }, signal);
      try {
        if (input.op === 'observe' && !input.question) return this.present(observed.value);
        if (input.op === 'step' && s.actions >= config.computer.maxActionsPerSession) throw new Error('COMPUTER_ACTION_BUDGET');
        const o = observed.value.observation;
        if (!o || !observed.frame || !observed.mimeType) throw new Error('COMPUTER_FRAME_REQUIRED');
        const proposal = await predictComputerStep(s.adapter, { goal: input.op === 'observe' ? input.question! : input.goal, readOnly: input.op === 'observe', image: observed.frame, mimeType: observed.mimeType,
          width: o.imageWidth, height: o.imageHeight, summary: o.summary }, () => {
          if (++s!.modelRequests > config.computer.maxModelRequests) throw new Error('COMPUTER_MODEL_BUDGET');
        }, signal);
        if (proposal.kind === 'answer') return { ...this.present(observed.value), summary: proposal.text, verified: false };
        if (input.op === 'observe') throw new Error('COMPUTER_READ_ONLY_MODEL_OUTPUT');
        if (proposal.kind === 'finished') return { status: 'model_finished', sessionId: s.id, claimedSuccess: proposal.claimedSuccess, verified: false };
        if (proposal.kind === 'takeover') return { status: 'takeover', sessionId: s.id, pending: true, summary: 'The GUI model requests user assistance. Inspect the authorized window locally.' };
        const e: ActionEnvelope = { actionId: randomUUID(), sessionId: s.id, observationId: o.id, brokerEpoch: o.brokerEpoch,
          generation: o.generation, grantId: observed.value.grantId!, deadlineAt: Date.now() + 120_000, action: proposal.action };
        return await this.dispatchAction(s, e, signal);
      } finally { observed.frame?.fill(0); }
    } catch (error) {
      // Never replay an RPC with an unknown delivery outcome.
      await this.close(owner);
      throw error;
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
    if (reply.value.status === 'stopped') await this.close(s.owner);
    return this.present(reply.value);
  }
  private present(reply: z.infer<typeof Reply>): ComputerPublicResult {
    return { status: reply.status, sessionId: reply.sessionId,
      ...(reply.errorCode ? { errorCode: reply.errorCode, nextAction: computerRecovery(reply.errorCode) } : {}),
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
    const json = reply.content.find((item) => item.type === 'json');
    const value = Reply.parse(json?.type === 'json' ? json.value : undefined);
    if (value.sessionId !== s.id) throw new Error('COMPUTER_SESSION_MISMATCH');
    const file = reply.content.find((item) => item.type === 'file');
    let frame: Uint8Array | undefined;
    if (file?.type === 'file' && reply.invocationId) frame = this.endpoints.uploads.takeComputerFrame(file.fileId, reply.invocationId);
    if (signal?.aborted) { frame?.fill(0); signal.throwIfAborted(); }
    return { value, frame, mimeType: file?.type === 'file' ? file.mimeType as 'image/png' | 'image/jpeg' : undefined };
  }
  async close(owner: string): Promise<void> {
    this.operations.get(owner)?.abort();
    const s = this.sessions.get(owner); if (!s) return;
    this.sessions.delete(owner);
    leaveComputerControl(owner);
    s.controller.abort();
    try { await this.send(s, { op: 'release', sessionId: s.id, owner }); } catch { /* Broker watchdog revokes disconnected sessions. */ }
  }
  async shutdown(): Promise<void> { await Promise.all([...new Set([...this.sessions.keys(), ...this.operations.keys()])].map((owner) => this.close(owner))); }
}
