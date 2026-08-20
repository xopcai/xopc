/**
 * Shared building blocks for the two direct-turn entry points (streaming
 * webchat SSE and one-shot CLI). Both flows do the same hydrate → maybe-slash
 * → run-embedded-turn → after-turn dance; this module captures that core so
 * the entry points only manage their I/O specifics (event sink, voice STT,
 * TTS, transcript persistence).
 */

import crypto from 'node:crypto';

import type { AgentMessage } from '@earendil-works/pi-agent-core';
import type { ImageContent } from '@earendil-works/pi-ai';

import { commandRegistry } from '../../chat-commands/index.js';
import { parseSlashCommand } from '../../chat-commands/command-parse.js';
import { shouldSkipResetOverlapCommand } from '../../session/reset-triggers.js';
import { hydrateUserTurnForLlm, type TranscriptUserMessage } from '../inbound/attachment-pipeline.js';
import type { CommandHandler } from '../messaging/command-handler.js';
import type { CommandStreamEvent } from '../../chat-commands/types.js';
import type { SessionStore } from '../../session/index.js';
import type { Config } from '../../config/schema.js';
import type { AgentInstanceGateway } from '../agent-instance-gateway.js';
import type { ModelManager } from '../models/index.js';
import { extractAgentUserPlainText } from '../memory/user-message-text.js';
import { runEmbeddedTurnForSession } from '../embedded/run-for-session.js';
import type { EmbeddedStreamEvent } from '../embedded/types.js';
import { resolveImageHandlingStrategy } from '../image/vision-detection.js';
import { buildTaskExecutionDirective } from '../../tasks/task-context-assembler.js';
import { prependAgentContext } from '../memory/context/planner.js';

export interface HydratePerTurnStateDeps {
  hydrateSessionWorkspaceFromStore: (sessionKey: string) => Promise<void>;
  hydrateSessionModelFromStore: (sessionKey: string) => Promise<void>;
  applyResolvedThinkingLevel: (sessionKey: string, thinking?: string | null) => Promise<void>;
}

/** Workspace + model + thinking level — common prep before any direct turn. */
export async function hydratePerTurnState(
  deps: HydratePerTurnStateDeps,
  sessionKey: string,
  thinking?: string,
): Promise<void> {
  await deps.hydrateSessionWorkspaceFromStore(sessionKey);
  await deps.hydrateSessionModelFromStore(sessionKey);
  await deps.applyResolvedThinkingLevel(sessionKey, thinking);
}

export interface SlashCommandTask {
  /** True if the input parsed as a registered slash command (handled or not). */
  matched: boolean;
  /** Aggregated user-visible reply text (assistant view). */
  aggregatedText: string;
  /** The parsed command name when matched. */
  command?: string;
  /** Structured command result metadata for webchat and other rich clients. */
  metadata?: Record<string, unknown>;
}

export interface TryRunSlashCommandDeps {
  commandHandler: Pick<CommandHandler, 'executeCommandAndAggregateReply'>;
  log: { warn: (obj: Record<string, unknown>, msg: string) => void };
}

/**
 * Detect a slash command and, if registered, execute it and aggregate the reply
 * text. Errors thrown inside the command surface as `aggregatedText` so callers
 * can persist the receipt or stream it as a token.
 */
export async function tryRunSlashCommand(
  deps: TryRunSlashCommandDeps,
  ctx: {
    sessionKey: string;
    channel: string;
    chatId: string;
    senderId?: string;
    isGroup?: boolean;
    inboundMetadata?: Record<string, unknown>;
  },
  content: string,
  options?: {
    skipResetCommands?: boolean;
    emitEvent?: (event: CommandStreamEvent) => void | Promise<void>;
  },
): Promise<SlashCommandTask> {
  const parsed = parseSlashCommand(content);
  if (!parsed) {
    return { matched: false, aggregatedText: '' };
  }
  if (options?.skipResetCommands && shouldSkipResetOverlapCommand(parsed.command, true)) {
    return { matched: false, aggregatedText: '' };
  }
  if (!commandRegistry.has(parsed.command)) {
    return { matched: false, aggregatedText: '' };
  }
  try {
    const { aggregatedText, metadata } = await deps.commandHandler.executeCommandAndAggregateReply(
      parsed.command,
      parsed.args,
      {
        sessionKey: ctx.sessionKey,
        channel: ctx.channel,
        chatId: ctx.chatId,
        senderId: ctx.senderId ?? '',
        isGroup: ctx.isGroup ?? false,
        inboundMetadata: ctx.inboundMetadata ?? {},
      },
      { emitEvent: options?.emitEvent },
    );
    return { matched: true, aggregatedText: aggregatedText ?? '', command: parsed.command, metadata };
  } catch (err) {
    const em = err instanceof Error ? err.message : String(err);
    deps.log.warn(
      { err, sessionKey: ctx.sessionKey, command: parsed.command },
      `Slash command failed: ${em}`,
    );
    return { matched: true, aggregatedText: `Command error: ${em}`, command: parsed.command };
  }
}

export interface RunDirectAgentTurnDeps {
  sessionStore: SessionStore;
  agentManager: AgentInstanceGateway;
  modelManager: ModelManager;
  config: Config | undefined;
}

export interface RunDirectAgentTurnInput {
  sessionKey: string;
  runId?: string;
  userMessage: AgentMessage;
  abortSignal?: AbortSignal;
  deadlineAtMs?: number;
  sourceImages?: ImageContent[];
  onEvent?: (event: EmbeddedStreamEvent) => void;
}

export interface RunDirectAgentTurnResult {
  ok: boolean;
  errorMessage?: string;
  lastAssistantText?: string;
}

/**
 * Convert a user message into an embedded turn, including the standard memory
 * prefetch + background-review nudge wiring used by every direct entry point.
 */
export async function runDirectAgentTurn(
  deps: RunDirectAgentTurnDeps,
  input: RunDirectAgentTurnInput,
): Promise<RunDirectAgentTurnResult> {
  const turnId = input.runId ?? crypto.randomUUID();
  const userPlain = extractAgentUserPlainText(input.userMessage);
  const userContext = await deps.agentManager.prepareUserTurnContext(
    input.userMessage,
    input.sessionKey,
    turnId,
  );
  const userMessageForModel = prependAgentContext(
    userContext.modelMessage,
    buildTaskExecutionDirective(input.sessionKey),
  );
  if (userContext.consentRequests.length > 0) {
    input.onEvent?.({
      type: 'memory_consent_required',
      runId: turnId,
      requests: userContext.consentRequests,
    });
  }

  const modelRef = deps.modelManager.getModelForSession(input.sessionKey);
  const llmTurn = await hydrateUserTurnForLlm({
    message: input.userMessage as TranscriptUserMessage,
    modelRef,
  });
  const sourceImages = resolveImageHandlingStrategy(modelRef) === 'native' ? (input.sourceImages ?? []) : [];
  const llmImages = [...llmTurn.images, ...sourceImages];

  const result = await runEmbeddedTurnForSession({
    sessionKey: input.sessionKey,
    runId: turnId,
    userMessage: userMessageForModel,
    llmImages,
    sessionStore: deps.sessionStore,
    agentManager: deps.agentManager,
    modelManager: deps.modelManager,
    getConfig: () => deps.config,
    abortSignal: input.abortSignal,
    deadlineAtMs: input.deadlineAtMs,
    beforeTurn: () => deps.agentManager.beginBackgroundReviewUserTurn(input.sessionKey),
    onEvent: input.onEvent,
  });

  const understandingReview = await deps.agentManager.afterAgentTurn(input.sessionKey, userPlain);
  if (understandingReview?.createdRecords.length) {
    input.onEvent?.({ type: 'memory_captured', runId: turnId, records: understandingReview.createdRecords });
  }
  deps.agentManager.scheduleBackgroundReviewAfterUserTurn(input.sessionKey);

  return result;
}
