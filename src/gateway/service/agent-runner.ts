/**
 * GatewayAgentRunner — webchat agent invocation and the surrounding control
 * surface (abort, steer, clarify-bridge plumbing, scheduled continuations).
 *
 * Was 200 lines of `GatewayService` covering seven concerns that all hung off
 * the same handful of fields (`activeWebchatRunBySession`, `runAbortControllers`,
 * `clarifyBridge`, `runRelay`):
 *
 *   - `runAgent(message, channel, chatId, ...)` — wraps {@link runGatewayAgent}
 *   - `abortAgentRun(runId)` — POST /api/agent/abort + cleanup
 *   - `steerWebchatAgent(chatId, message)` — Agent.steer queue at tool boundary
 *   - `submitClarifyResponse(requestId, answer)` — UI answers a `clarify` call
 *   - `enqueueWebchatPersistentGoalKickoff(sessionKey, goalText)` — initial
 *     `/goal` kickoff posts the goal text as the next user turn
 *   - `drainScheduledWebchatContinuation(sk, msg)` — background continuation
 *     (extension scheduler + persistent-goal flow)
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
import { AgentRunRelay, type RelayEvent } from '../agent-run-relay.js';
import { ClarifyBridge, type ClarifyBridgeRequest } from '../clarify-bridge.js';
import { buildSessionKey, parseSessionKey } from '../../routing/session-key.js';
import { getDefaultAgentId } from '../../routing/resolve-route.js';
import { runGatewayAgent } from './run-gateway-agent.js';
import { createLogger } from '../../utils/logger.js';

const log = createLogger('Gateway:AgentRunner');

export interface GatewayAgentRunnerOptions {
  bus: MessageBus;
  sessionIndex: SessionIndex;
  /** Resolved lazily — the runner is constructed before AgentService exists. */
  getAgentService: () => AgentService;
  getChannelManager: () => ChannelManager;
  getConfig: () => Config;
  /** SSE emit (re-used so `runAgent` events broadcast to subscribers). */
  emit: (type: string, payload: unknown) => void;
}

export class GatewayAgentRunner {
  private readonly opts: GatewayAgentRunnerOptions;
  readonly runRelay = new AgentRunRelay();
  /** Per-run abort for webchat (POST /api/agent/abort or client disconnect). */
  private readonly runAbortControllers = new Map<string, AbortController>();
  private readonly clarifyBridge = new ClarifyBridge();
  /** Maps webchat session key → active `runId` for `clarify` tool routing. */
  private readonly activeWebchatRunBySession = new Map<string, string>();

  constructor(opts: GatewayAgentRunnerOptions) {
    this.opts = opts;
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
    attachments?: Array<{
      type: string;
      mimeType?: string;
      data?: string;
      name?: string;
      size?: number;
    }>,
    thinking?: string,
    runOptions?: { signal?: AbortSignal; clientCreatedAtMs?: number },
  ): AsyncGenerator<
    { type: string; [key: string]: unknown },
    { status: string; summary: string },
    unknown
  > {
    const iter = runGatewayAgent(
      {
        config: this.opts.getConfig(),
        agentService: this.opts.getAgentService(),
        bus: this.opts.bus,
        runRelay: this.runRelay,
        runAbortControllers: this.runAbortControllers,
        activeWebchatRunBySession: this.activeWebchatRunBySession,
        sessionIndex: this.opts.sessionIndex,
        emit: this.opts.emit,
      },
      message,
      channel,
      chatId,
      attachments,
      thinking,
      runOptions,
    );

    let step = await iter.next();
    while (!step.done) {
      yield step.value as { type: string; [key: string]: unknown };
      step = await iter.next();
    }
    return step.value;
  }

  /** Abort an in-flight webchat agent run (matches `runId` from SSE `status`). */
  abortAgentRun(runId: string): boolean {
    this.clarifyBridge.cancelForRun(runId);
    const keysToMark: string[] = [];
    for (const [sk, id] of this.activeWebchatRunBySession) {
      if (id === runId) {
        keysToMark.push(sk);
      }
    }
    for (const sk of keysToMark) {
      this.activeWebchatRunBySession.delete(sk);
    }
    const relaySk = this.runRelay.getSessionKey(runId);
    if (relaySk && !keysToMark.includes(relaySk)) {
      keysToMark.push(relaySk);
    }
    const c = this.runAbortControllers.get(runId);
    if (!c) {
      return false;
    }
    const cutoffTs = Date.now();
    for (const sk of keysToMark) {
      void this.opts.sessionIndex
        .updateSessionMetadata(sk, { abortCutoffTimestamp: cutoffTs })
        .catch(() => {});
      void this.opts.sessionIndex
        .appendTranscriptContextEntry(sk, {
          text: 'Webchat agent run aborted',
          data: { runId, abortCutoffTimestamp: cutoffTs },
        })
        .catch(() => {});
    }
    c.abort();
    for (const sk of keysToMark) {
      void import('../../agent/embedded/runs.js').then(({ abortEmbeddedRun }) =>
        abortEmbeddedRun(sk),
      );
    }
    return true;
  }

  /**
   * Queue steering text for an active webchat run (`Agent.steer` /
   * tool-boundary injection). `chatId` is the same as `POST /api/agent` body
   * (`sessionKey` or legacy peer id).
   */
  async steerWebchatAgent(
    chatId: string,
    message: string,
  ): Promise<
    { ok: true } | { ok: false; code: 'BAD_REQUEST' | 'NO_ACTIVE_RUN' | 'STEER_FAILED' }
  > {
    const trimmed = message.trim();
    if (!trimmed) {
      return { ok: false, code: 'BAD_REQUEST' };
    }
    const cfg = this.opts.getConfig();
    const parsedKey = parseSessionKey(chatId);
    const sessionKey = parsedKey
      ? chatId
      : buildSessionKey({
          agentId: getDefaultAgentId(cfg),
          source: 'webchat',
          accountId: 'default',
          peerKind: 'direct',
          peerId: chatId,
        });
    if (!this.activeWebchatRunBySession.has(sessionKey)) {
      return { ok: false, code: 'NO_ACTIVE_RUN' };
    }
    const steered = await this.opts
      .getAgentService()
      .turnDispatcher.steerWebchatSession(sessionKey, trimmed);
    if (!steered) {
      return { ok: false, code: 'STEER_FAILED' };
    }
    return { ok: true };
  }

  /** Deliver a user's answer to a pending `clarify` tool call. */
  submitClarifyResponse(requestId: string, answer: string): boolean {
    return this.clarifyBridge.handleResponse(requestId, answer);
  }

  /** Hermes-style: after HTTP sets a goal, enqueue the goal text as the next user turn. */
  enqueueWebchatPersistentGoalKickoff(sessionKey: string, goalText: string): void {
    queueMicrotask(() => {
      void this.drainScheduledWebchatContinuation(sessionKey, goalText);
    });
  }

  /** Background drain for extension-initiated webchat turns (`scheduleWebchatContinuation`). */
  async drainScheduledWebchatContinuation(sessionKey: string, message: string): Promise<void> {
    try {
      const gen = this.runAgent(message, 'webchat', sessionKey, undefined, undefined, {
        clientCreatedAtMs: Date.now(),
      });
      for await (const _ of gen) {
        // Relay + `agent.stream` broadcast; UI attaches via pending runId + resume.
      }
    } catch (err) {
      log.warn({ err, sessionKey }, 'Scheduled webchat continuation failed');
    }
  }

  // ── Clarify dispatch (called from AgentService.gatewayClarify) ────────

  /**
   * Resolve clarify-bridge config for `sessionKey`: who delivers the question
   * (webchat SSE, Telegram message, or both), then start the bridge request.
   * Rejects when neither path is available (e.g. CLI without webchat or TG).
   *
   * `publishSseFor(runId)` is the bridge into AgentService's
   * `turnDispatcher.enqueueWebchatSseEvent`. We take it as a callback so the
   * runner does not import AgentService statically.
   */
  requestClarification(opts: {
    sessionKey: string;
    request: ClarifyBridgeRequest;
    publishSseFor: (runId: string) => (e: RelayEvent) => void;
  }): Promise<string> {
    const { sessionKey, request, publishSseFor } = opts;
    const runId = this.activeWebchatRunBySession.get(sessionKey);
    const publishSse = runId ? publishSseFor(runId) : undefined;
    const parsed = parseSessionKey(sessionKey);
    const deliver =
      parsed?.source === 'telegram'
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
      relay: this.runRelay,
      publishSse,
      request,
      deliver,
    });
  }

  private async deliverTelegramClarify(ctx: {
    sessionKey: string;
    requestId: string;
    request: ClarifyBridgeRequest;
  }): Promise<void> {
    const parsed = parseSessionKey(ctx.sessionKey);
    if (!parsed || parsed.source !== 'telegram') {
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
      chat_id: parsed.peerId,
      content: body,
      metadata: {
        accountId: parsed.accountId,
        ...(parsed.threadId ? { threadId: parsed.threadId } : {}),
      },
      buttons: buttonRows,
    });
  }
}
