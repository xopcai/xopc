import crypto from 'node:crypto';
import type { TurnOrigin } from '@xopcai/endpoint-tools-protocol';
import type { ClarificationResponseAction } from '@xopcai/gateway-contract';

import type { Config } from '../../config/schema.js';
import type { MessageBus } from '../../infra/bus/index.js';
import type { AgentService } from '../../agent/service.js';
import type { ChannelManager } from '../../channels/manager.js';
import type { SessionIndex } from '../../session/index.js';
import { onConnectionWaitChanged } from '../../storage/sqlite/connection-wait-repository.js';
import {
  EphemeralClarificationWaiter,
  type ClarificationStreamEvent,
} from '../ephemeral-clarification-waiter.js';
import {
  createClarificationWait,
  getClarification,
  getClarificationSnapshot,
  resolveClarification,
  supersedeActiveClarification,
} from '../../storage/sqlite/clarification-wait-repository.js';
import type { ClarifyRequestPayload, ClarifyRequestResult } from '../../agent/tools/clarify-tool.js';
import { runGatewayAgent } from './run-gateway-agent.js';
import type { UserTurnAttachment, UserTurnInput } from '../user-turn-input.js';
import type { AgentSourceContext, TurnContextRef } from '../../agent/source-context/types.js';
import { fitSourceContextsToBudget } from '../../agent/source-context/budget.js';
import { createLogger } from '../../utils/logger.js';
import { listActiveSessionInputRuns } from '../../storage/sqlite/index.js';
import {
  SessionInputCoordinator,
  type ReplaceLatestTurnInput,
  type SubmitSessionInput,
} from './session-input-coordinator.js';

/**
 * Owns gateway agent runs, durable clarification coordination, and the
 * lifecycle-bound clarification waiter used by ephemeral side chats.
 */

const log = createLogger('Gateway:AgentRunner');

export interface GatewayAgentRunnerOptions {
  validateConnectionResume?: (input: import('../../storage/sqlite/session-input-repository.js').SessionInput) => Promise<boolean>;
  bus: MessageBus;
  sessionIndex: SessionIndex;
  /** Resolved lazily — the runner is constructed before AgentService exists. */
  getAgentService: () => AgentService;
  getChannelManager: () => ChannelManager;
  getConfig: () => Config;
  /** Publish low-frequency gateway state changes. */
  emit: (type: string, payload: unknown) => void;
  publishRealtime: (topic: string, event: string, data: unknown) => void;
  completeRealtimeTopic: (topic: string) => void;
  resolveTurnContext: (ref: TurnContextRef) => Promise<AgentSourceContext | null>;
}

const MAX_TURN_CONTEXTS = 5;

export class GatewayAgentRunner {
  private readonly opts: GatewayAgentRunnerOptions;
  /** Per-run abort for webchat (POST /api/agent/abort or client disconnect). */
  private readonly runAbortControllers = new Map<string, AbortController>();
  private readonly runCompletions = new Map<string, Promise<void>>();
  private readonly resolveRunCompletions = new Map<string, () => void>();
  private readonly ephemeralClarifications = new EphemeralClarificationWaiter();
  /** Maps webchat session key → active `runId` for `clarify` tool routing. */
  private readonly activeWebchatRunBySession = new Map<string, string>();
  private readonly externalStreamBySession = new Map<string, (event: ClarificationStreamEvent) => void>();
  private readonly externalClarificationResponses = new Map<string, () => boolean>();
  readonly inputs: SessionInputCoordinator;
  private readonly unsubscribeConnectionWait: () => void;

  constructor(opts: GatewayAgentRunnerOptions) {
    this.opts = opts;
    this.unsubscribeConnectionWait = onConnectionWaitChanged(sessionKey => {
      const revision = this.inputs.snapshot(sessionKey).revision;
      opts.emit('session.connection-wait.changed', { sessionKey, revision });
      opts.publishRealtime('sessions', 'session.connection-wait.changed', { sessionKey, revision });
    });
    this.inputs = new SessionInputCoordinator({
      beforeExecute: opts.validateConnectionResume,
      sessionExists: async (sessionKey) => Boolean(await opts.sessionIndex.getSessionMetadata(sessionKey)),
      execute: async (input) => {
        const generator = this.runAgent(
          input.content,
          'webchat',
          input.sessionKey,
          input.origin,
          input.attachments,
          input.thinking,
          { runId: input.runId, taskRunId: input.taskRunId, sourceContexts: input.sourceContexts,
            ...(input.origin.type === 'channel' && input.origin.channel === 'voice' ? { presentation: 'voice' as const } : {}) },
        );
        let result: { status: string; summary: string } | undefined;
        while (true) {
          const step = await generator.next();
          if (step.done) {
            result = step.value;
            break;
          }
        }
        return result;
      },
      prepareAttachments: async (sessionKey, attachments) => {
        const media = await opts.getAgentService().prepareInboundAttachments(sessionKey, attachments);
        if (!media?.length) return undefined;
        return media.map((ref) => ({
          id: ref.id,
          type: ref.type,
          mimeType: ref.mimeType,
          uri: ref.uri,
          name: ref.name,
          size: ref.size,
        }));
      },
      prepareContexts: async (refs) => {
        if (!refs?.length) return undefined;
        const unique = new Map<string, TurnContextRef>();
        for (const ref of refs) {
          const sourceId = ref.sourceId.trim();
          if (sourceId) unique.set(`${ref.kind}:${sourceId}`, { ...ref, sourceId });
        }
        if (unique.size > MAX_TURN_CONTEXTS) {
          throw new Error(`A message can reference at most ${MAX_TURN_CONTEXTS} notes`);
        }
        const contexts = await Promise.all(
          [...unique.values()].map((ref) => opts.resolveTurnContext(ref)),
        );
        if (contexts.some((context) => context === null)) {
          throw new Error('A referenced note is no longer available');
        }
        return fitSourceContextsToBudget(
          contexts.filter((context): context is AgentSourceContext => context !== null),
        );
      },
      steer: (sessionKey, content) => opts.getAgentService().turnDispatcher.steerWebchatSession(sessionKey, content),
      emit: opts.emit,
    });
  }

  // ── Read-only accessors (so peers don't get a Map ref) ────────────────

  /** True when a webchat agent run is currently in-flight for `sessionKey`. */
  hasActiveRun(sessionKey: string): boolean {
    return this.activeWebchatRunBySession.has(sessionKey);
  }

  getActiveRunId(sessionKey: string): string | undefined {
    return this.activeWebchatRunBySession.get(sessionKey)
      ?? this.inputs.snapshot(sessionKey).activeRunId;
  }

  listActiveRuns(): Array<{ sessionKey: string; runId: string }> {
    const runs = new Map(
      listActiveSessionInputRuns().map(({ sessionKey, runId }) => [sessionKey, runId]),
    );
    for (const [sessionKey, runId] of this.activeWebchatRunBySession) {
      runs.set(sessionKey, runId);
    }
    return [...runs].map(([sessionKey, runId]) => ({ sessionKey, runId }));
  }

  disposeClarifications(): void {
    this.ephemeralClarifications.dispose();
    this.unsubscribeConnectionWait();
  }

  registerExternalWebchatRun(
    sessionKey: string,
    runId: string,
    publish: (event: ClarificationStreamEvent) => void,
    options?: { beforeClarificationResponse?: () => boolean },
  ): void {
    this.activeWebchatRunBySession.set(sessionKey, runId);
    this.externalStreamBySession.set(sessionKey, publish);
    if (options?.beforeClarificationResponse) this.externalClarificationResponses.set(sessionKey, options.beforeClarificationResponse);
  }

  unregisterExternalWebchatRun(sessionKey: string, runId: string): void {
    if (this.activeWebchatRunBySession.get(sessionKey) === runId) {
      this.activeWebchatRunBySession.delete(sessionKey);
      this.externalStreamBySession.delete(sessionKey);
      this.externalClarificationResponses.delete(sessionKey);
    }
  }

  cancelClarificationForRun(runId: string): void {
    this.ephemeralClarifications.cancelForRun(runId);
  }

  // ── runAgent (webchat HTTP POST) ──────────────────────────────────────

  async *runAgent(
    message: string,
    channel: string,
    chatId: string,
    origin: TurnOrigin,
    attachments?: UserTurnAttachment[],
    thinking?: string,
    runOptions?: { signal?: AbortSignal; runId?: string; taskRunId?: string; sourceContexts?: AgentSourceContext[]; presentation?: 'voice' },
  ): AsyncGenerator<
    { type: string; [key: string]: unknown },
    { status: string; summary: string },
    unknown
  > {
    const trackedRunId = runOptions?.runId;
    if (trackedRunId) {
      let resolve = () => {};
      this.runCompletions.set(trackedRunId, new Promise<void>((done) => { resolve = done; }));
      this.resolveRunCompletions.set(trackedRunId, resolve);
    }
    const iter = runGatewayAgent(
      {
        config: this.opts.getConfig(),
        agentService: this.opts.getAgentService(),
        bus: this.opts.bus,
        runAbortControllers: this.runAbortControllers,
        activeWebchatRunBySession: this.activeWebchatRunBySession,
        sessionIndex: this.opts.sessionIndex,
        emit: this.opts.emit,
        publishRealtime: this.opts.publishRealtime,
        completeRealtimeTopic: this.opts.completeRealtimeTopic,
      },
      message,
      channel,
      chatId,
      origin,
      attachments,
      thinking,
      runOptions,
    );

    try {
      // Delegate return/throw so interrupted consumers also run the inner cleanup.
      return yield* iter as unknown as ReturnType<GatewayAgentRunner['runAgent']>;
    } finally {
      if (trackedRunId) {
        this.resolveRunCompletions.get(trackedRunId)?.();
        this.resolveRunCompletions.delete(trackedRunId);
        this.runCompletions.delete(trackedRunId);
      }
    }
  }

  submitSessionInput(input: SubmitSessionInput) {
    return this.inputs.submit(input);
  }

  replaceLatestSessionTurn(input: ReplaceLatestTurnInput) {
    return this.inputs.replaceLatestTurn(input, async () => {
      const activeRunId = this.activeWebchatRunBySession.get(input.sessionKey)
        ?? this.inputs.snapshot(input.sessionKey).activeRunId;
      if (activeRunId) await this.abortAgentRun(activeRunId);

      const { evictEmbeddedSessionRunner } = await import('../../agent/embedded/session-runner.js');
      evictEmbeddedSessionRunner(input.sessionKey, 'gateway_user_turn_replaced');
      this.opts.getAgentService().evictSessionAgent(input.sessionKey);
    });
  }

  getSessionInputState(sessionKey: string) {
    return this.inputs.snapshot(sessionKey);
  }

  updateSessionInput(sessionKey: string, id: string, body: {
    version: number; content?: string; attachments?: UserTurnAttachment[]; contextRefs?: TurnContextRef[];
    thinking?: string; position?: number;
  }) {
    return this.inputs.update(sessionKey, id, body);
  }

  removeSessionInput(sessionKey: string, id: string, version: number) {
    return this.inputs.remove(sessionKey, id, version);
  }

  recoverSessionInputs(): void {
    this.inputs.recover();
  }

  /** Abort an in-flight webchat agent run. */
  async abortAgentRun(runId: string): Promise<{ aborted: boolean; idle: boolean }> {
    this.ephemeralClarifications.cancelForRun(runId);
    const keysToMark: string[] = [];
    for (const [sk, id] of this.activeWebchatRunBySession) {
      if (id === runId) {
        keysToMark.push(sk);
      }
    }
    const c = this.runAbortControllers.get(runId);
    if (!c) {
      return { aborted: false, idle: true };
    }
    const completion = this.runCompletions.get(runId);
    for (const sk of keysToMark) {
      const clarification = getClarificationSnapshot(sk)?.clarification;
      if (clarification?.originRunId === runId) supersedeActiveClarification(sk);
      void this.opts.sessionIndex
        .appendTranscriptContextEntry(sk, {
          text: 'Webchat agent run aborted',
          data: { runId },
        })
        .catch(() => {});
    }
    c.abort();
    const { abortEmbeddedRun } = await import('../../agent/embedded/runs.js');
    await Promise.all(keysToMark.map((sessionKey) => abortEmbeddedRun(sessionKey).catch(() => false)));
    await completion;
    return { aborted: true, idle: true };
  }

  answerEphemeralClarification(requestId: string, answer: string): boolean {
    return this.ephemeralClarifications.answer(requestId, answer);
  }

  getClarificationState(sessionKey: string) {
    return getClarificationSnapshot(sessionKey);
  }

  resolveClarificationResponse(input: {
    id: string;
    expectedVersion: number;
    idempotencyKey: string;
    action: ClarificationResponseAction;
    answer?: string;
  }) {
    const result = resolveClarification(input);
    if (result.ok) {
      this.opts.emit('clarification.updated', result.clarification);
      if (result.queued) void this.inputs.drain(result.clarification.sessionKey);
    }
    return result;
  }

  getClarificationById(id: string) {
    return getClarification(id);
  }

  answerClarificationChoice(requestId: string, choiceIndex: number, idempotencyKey: string): boolean {
    const wait = getClarification(requestId);
    const answer = wait?.status === 'open' ? wait.choices?.[choiceIndex] : undefined;
    if (!answer) return false;
    return this.resolveClarificationResponse({
      id: wait.id,
      expectedVersion: wait.version,
      idempotencyKey,
      action: 'answer',
      answer,
    }).ok;
  }

  answerClarificationText(sessionKey: string, answer: string, idempotencyKey: string): boolean {
    const wait = getClarificationSnapshot(sessionKey)?.clarification;
    if (!wait || wait.status !== 'open' || !answer.trim()) return false;
    return this.resolveClarificationResponse({
      id: wait.id,
      expectedVersion: wait.version,
      idempotencyKey,
      action: 'answer',
      answer,
    }).ok;
  }

  /** Same execution path as scheduled continuation, but lets callers observe failures. */
  async runScheduledWebchatTurn(sessionKey: string, userTurn: UserTurnInput): Promise<void> {
    const clientMessageId = crypto.randomUUID();
    const accepted = await this.inputs.submit({
      sessionKey,
      clientMessageId,
      delivery: 'next',
      content: userTurn.text,
      attachments: userTurn.attachments,
      origin: { type: 'system', source: 'workflow' },
    });
    if (accepted.ok === false) throw new Error(`Scheduled session input was rejected: ${accepted.code}`);
    await this.inputs.waitForCompletion(sessionKey, clientMessageId);
  }

  async runScheduledWebchatContinuation(sessionKey: string, message: string): Promise<void> {
    await this.runScheduledWebchatTurn(sessionKey, { text: message });
  }

  /** Background drain for extension-initiated webchat turns (`scheduleWebchatContinuation`). */
  async drainScheduledWebchatContinuation(sessionKey: string, message: string): Promise<void> {
    try {
      await this.runScheduledWebchatContinuation(sessionKey, message);
    } catch (err) {
      log.warn({ err, sessionKey }, 'Scheduled webchat continuation failed');
    }
  }

  // ── Clarify dispatch (called from AgentService.gatewayClarify) ────────

  /**
   * Persist normal clarification waits and use the lifecycle-bound waiter only
   * for caller-owned ephemeral sessions.
   * Rejects when neither path is available (e.g. CLI without webchat or TG).
   *
   * `publishStreamFor(runId)` is the bridge into AgentService's
   * `turnDispatcher.enqueueWebchatStreamEvent`. We take it as a callback so the
   * runner does not import AgentService statically.
   */
  async requestClarification(opts: {
    sessionKey: string;
    runId: string;
    toolCallId: string;
    request: ClarifyRequestPayload;
    publishStreamFor: (runId: string) => (event: ClarificationStreamEvent) => void;
  }): Promise<ClarifyRequestResult> {
    const { sessionKey, request, publishStreamFor } = opts;
    const runId = this.activeWebchatRunBySession.get(sessionKey) ?? opts.runId;
    const publishStream = this.externalStreamBySession.get(sessionKey)
      ?? (runId ? publishStreamFor(runId) : undefined);
    const metadata = await this.opts.sessionIndex.getSessionMetadata(sessionKey).catch(() => null);
    const routing = metadata?.routing;
    const deliver =
      routing?.source === 'telegram'
        ? async (ctx: {
            sessionKey: string;
            requestId: string;
            request: ClarifyRequestPayload;
          }) => {
            await this.deliverTelegramClarify(ctx);
          }
        : undefined;
    const persistedSession = getClarificationSnapshot(sessionKey);
    if (!persistedSession && this.externalStreamBySession.has(sessionKey)) {
      return this.ephemeralClarifications.start({
        beforeResponse: this.externalClarificationResponses.get(sessionKey),
        runId,
        publish: publishStream!,
        request,
      }).then((answer) => ({ status: 'answered' as const, answer }));
    }
    if (!persistedSession) {
      return Promise.reject(
        new Error('Clarify requires a persisted session.'),
      );
    }
    const wait = createClarificationWait({
      sessionKey,
      runId: opts.runId,
      toolCallId: opts.toolCallId,
      kind: request.kind === 'approval' ? 'approval' : 'input',
      question: request.question,
      choices: request.choices,
      suggestedAnswer: request.suggestedAnswer,
      approvalKey: request.approvalKey,
    });
    const event: ClarificationStreamEvent = {
      type: 'clarify_request',
      requestId: wait.id,
      kind: wait.kind,
      question: wait.question,
      choices: wait.choices,
      suggestedAnswer: wait.suggestedAnswer,
      expiresAt: wait.expiresAt,
      createdAt: wait.createdAt,
      version: wait.version,
    };
    if (this.activeWebchatRunBySession.has(sessionKey)) publishStream?.(event);
    if (deliver) await deliver({ sessionKey, requestId: wait.id, request });
    return { status: 'waiting' as const, waitId: wait.id, expiresAt: wait.expiresAt };
  }

  private async deliverTelegramClarify(ctx: {
    sessionKey: string;
    requestId: string;
    request: ClarifyRequestPayload;
  }): Promise<void> {
    const metadata = await this.opts.sessionIndex.getSessionMetadata(ctx.sessionKey).catch(() => null);
    const routing = metadata?.routing;
    if (!routing || routing.source !== 'telegram') {
      return;
    }

    let body = ctx.request.question;
    if (ctx.request.suggestedAnswer) {
      body += `\n\nSuggested answer (never selected automatically): ${ctx.request.suggestedAnswer}`;
    }

    body += ctx.request.kind === 'approval'
      ? '\n\nFor safety, this approval expires after 10 minutes.'
      : '\n\nThis question remains available until you answer or cancel the task.';

    const choices = ctx.request.choices;
    const buttonRows =
      choices && choices.length >= 2
        ? choices.map((c, i) => [
            {
              text: c.length > 64 ? `${c.slice(0, 61)}…` : c,
              callback_data: `clarify:${ctx.requestId}:${i}`,
            },
          ])
        : undefined;

    body += buttonRows
      ? '\n\nReply with your answer, or tap an option below.'
      : '\n\nReply with your answer.';

    await this.opts.getChannelManager().send({
      channel: 'telegram',
      chat_id: routing.peerId,
      content: body,
      metadata: {
        accountId: routing.accountId,
        ...(routing.threadId ? { threadId: routing.threadId } : {}),
      },
      buttons: buttonRows,
    });
  }
}
