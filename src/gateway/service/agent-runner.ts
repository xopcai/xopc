import crypto from 'node:crypto';
import type { TurnOrigin } from '@xopcai/endpoint-tools-protocol';

/**
 * GatewayAgentRunner — webchat agent invocation and the surrounding control
 * surface (abort, steer, clarify-bridge plumbing, scheduled Task continuations).
 *
 * Was 200 lines of `GatewayService` covering seven concerns that all hung off
 * the same handful of fields (`activeWebchatRunBySession`, `runAbortControllers`,
 * `clarifyBridge`, `runRelay`):
 *
 *   - `runAgent(message, channel, chatId, ...)` — wraps {@link runGatewayAgent}
 *   - `abortAgentRun(runId)` — POST /api/agent/abort + cleanup
 *   - `submitClarifyResponse(requestId, answer)` — UI answers a `clarify` call
 *   - `runScheduledWebchatTurn(sk, userTurn)` — background webchat user turn
 *   - `drainScheduledWebchatContinuation(sk, msg)` — background Task continuation
 *   - `clarifyForSession({ sessionKey, request })` — clarify-bridge dispatch
 *     used by `gatewayClarify.requestClarification` in AgentService
 *
 * Owns the two state maps (`activeWebchatRunBySession`, `runAbortControllers`)
 * directly so peer coordinators (sessions-api, marketplace, config) cannot
 * accidentally mutate them.
 */
import type { Config } from '../../config/schema.js';
import type { MessageBus } from '../../infra/bus/index.js';
import type { AgentService } from '../../agent/service.js';
import type { ChannelManager } from '../../channels/manager.js';
import type { SessionIndex } from '../../session/index.js';
import type { ClarifyStreamEvent } from '../clarify-bridge.js';
import { ClarifyBridge, type ClarifyBridgeRequest } from '../clarify-bridge.js';
import { runGatewayAgent } from './run-gateway-agent.js';
import type { UserTurnAttachment, UserTurnInput } from '../user-turn-input.js';
import { createLogger } from '../../utils/logger.js';
import { SessionInputCoordinator, type SubmitSessionInput } from './session-input-coordinator.js';

const log = createLogger('Gateway:AgentRunner');

export interface GatewayAgentRunnerOptions {
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
}

export class GatewayAgentRunner {
  private readonly opts: GatewayAgentRunnerOptions;
  /** Per-run abort for webchat (POST /api/agent/abort or client disconnect). */
  private readonly runAbortControllers = new Map<string, AbortController>();
  private readonly runCompletions = new Map<string, Promise<void>>();
  private readonly resolveRunCompletions = new Map<string, () => void>();
  private readonly clarifyBridge = new ClarifyBridge();
  /** Maps webchat session key → active `runId` for `clarify` tool routing. */
  private readonly activeWebchatRunBySession = new Map<string, string>();
  readonly inputs: SessionInputCoordinator;

  constructor(opts: GatewayAgentRunnerOptions) {
    this.opts = opts;
    this.inputs = new SessionInputCoordinator({
      sessionExists: async (sessionKey) => Boolean(await opts.sessionIndex.getSessionMetadata(sessionKey)),
      execute: async (input) => {
        const generator = this.runAgent(
          input.content,
          'webchat',
          input.sessionKey,
          input.origin,
          input.attachments,
          input.thinking,
          { runId: input.runId },
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
    return this.activeWebchatRunBySession.get(sessionKey);
  }

  getClarifyBridge(): ClarifyBridge {
    return this.clarifyBridge;
  }

  /** Called from `GatewayService.stop()` so the bridge gets cleaned up. */
  disposeClarifyBridge(): void {
    this.clarifyBridge.dispose();
  }

  // ── runAgent (webchat HTTP POST) ──────────────────────────────────────

  async *runAgent(
    message: string,
    channel: string,
    chatId: string,
    origin: TurnOrigin,
    attachments?: UserTurnAttachment[],
    thinking?: string,
    runOptions?: { signal?: AbortSignal; runId?: string },
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
      let step = await iter.next();
      while (!step.done) {
        yield step.value as unknown as { type: string; [key: string]: unknown };
        step = await iter.next();
      }
      return step.value;
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

  getSessionInputState(sessionKey: string) {
    return this.inputs.snapshot(sessionKey);
  }

  updateSessionInput(sessionKey: string, id: string, body: {
    version: number; content?: string; attachments?: UserTurnAttachment[]; thinking?: string; position?: number;
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
    this.clarifyBridge.cancelForRun(runId);
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

  /** Deliver a user's answer to a pending `clarify` tool call. */
  submitClarifyResponse(requestId: string, answer: string): boolean {
    return this.clarifyBridge.handleResponse(requestId, answer);
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
   * Resolve clarify-bridge config for `sessionKey`: who delivers the question
   * (webchat stream, Telegram message, or both), then start the bridge request.
   * Rejects when neither path is available (e.g. CLI without webchat or TG).
   *
   * `publishStreamFor(runId)` is the bridge into AgentService's
   * `turnDispatcher.enqueueWebchatStreamEvent`. We take it as a callback so the
   * runner does not import AgentService statically.
   */
  async requestClarification(opts: {
    sessionKey: string;
    request: ClarifyBridgeRequest;
    publishStreamFor: (runId: string) => (event: ClarifyStreamEvent) => void;
  }): Promise<string> {
    const { sessionKey, request, publishStreamFor } = opts;
    const runId = this.activeWebchatRunBySession.get(sessionKey);
    const publishStream = runId ? publishStreamFor(runId) : undefined;
    const metadata = await this.opts.sessionIndex.getSessionMetadata(sessionKey).catch(() => null);
    const routing = metadata?.routing;
    const deliver =
      routing?.source === 'telegram'
        ? async (ctx: {
            sessionKey: string;
            requestId: string;
            request: ClarifyBridgeRequest;
          }) => {
            await this.deliverTelegramClarify(ctx);
          }
        : undefined;
    if (!runId && !deliver) {
      return Promise.reject(
        new Error('Clarify is not available for this session (use webchat, Telegram, or CLI)'),
      );
    }
    return this.clarifyBridge.startRequest({
      sessionKey,
      runId,
      publishStream,
      request,
      deliver,
    });
  }

  private async deliverTelegramClarify(ctx: {
    sessionKey: string;
    requestId: string;
    request: ClarifyBridgeRequest;
  }): Promise<void> {
    const metadata = await this.opts.sessionIndex.getSessionMetadata(ctx.sessionKey).catch(() => null);
    const routing = metadata?.routing;
    if (!routing || routing.source !== 'telegram') {
      return;
    }

    let body = ctx.request.question;
    if (ctx.request.default) {
      body += `\n\nDefault if unsure: ${ctx.request.default}`;
    }

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

    if (!buttonRows) {
      body += '\n\nReply with your answer in this chat.';
    }

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
