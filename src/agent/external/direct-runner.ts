import { randomUUID } from 'node:crypto';

import type { Config } from '../../config/schema.js';
import type { UserTurnAttachment } from '../../gateway/user-turn-input.js';
import { getProjectForSession } from '../../projects/workspace.js';
import { maybeApplyExternalSessionTitle } from '../../session/session-title.js';
import { effectiveWorkspacePathForSession } from '../../session/session-workspace.js';
import type { SessionConfigStore } from '../../session/index.js';
import type { SessionStore } from '../../session/store.js';
import { readCurrentTranscriptId } from '../../storage/sqlite/session-instance-repository.js';
import { getSqliteDatabase } from '../../storage/sqlite/transaction.js';
import { getExternalAgentDriver } from './registry.js';
import { getExternalConversationAgent } from './session-binding.js';
import { runExternalProjectTurn } from './turn-runner.js';

export interface RunExternalDirectTurnInput {
  conversationId: string;
  content: string;
  attachments?: UserTurnAttachment[];
  thinking?: string;
  runId?: string;
  signal?: AbortSignal;
  deadlineAtMs?: number;
  cfg?: Config;
  sessionStore?: SessionStore;
  sessionConfigStore?: SessionConfigStore;
  /** Called with cumulative visible assistant text during streaming (e.g. Telegram draft stream). */
  onTextUpdate?: (fullText: string) => void;
}

export type ExternalDirectTurnResult =
  | { status: 'succeeded'; text: string }
  | { status: 'failed' | 'interrupted'; text: string; error: Error };

/**
 * Execute a non-webchat turn (Channels like Telegram/Weixin, Automations, CLI direct runs)
 * on an external coding runtime (`codex`, `agy`, `claude`) using the unified `runExternalProjectTurn` pipeline.
 * Returns `null` if the conversation is not bound to an external agent.
 */
export async function runExternalDirectTurn(
  input: RunExternalDirectTurnInput,
): Promise<ExternalDirectTurnResult | null> {
  const externalAgent = getExternalConversationAgent(input.conversationId);
  if (!externalAgent) return null;

  const driver = getExternalAgentDriver(externalAgent.execution.kind);
  if (!externalAgent.enabled || externalAgent.deletedAt) {
    throw new Error(`${driver.label} agent "${externalAgent.id}" is disabled.`);
  }

  const transcriptId = readCurrentTranscriptId(getSqliteDatabase(), input.conversationId)?.trim();
  if (!transcriptId) {
    throw new Error(`Session "${input.conversationId}" has no active transcript.`);
  }

  const sessionConfig = input.sessionConfigStore
    ? await input.sessionConfigStore.get(input.conversationId).catch(() => undefined)
    : undefined;
  const project = getProjectForSession(input.conversationId);
  const workspaceOverride = input.cfg
    ? effectiveWorkspacePathForSession(input.cfg, input.conversationId, sessionConfig, project)
    : sessionConfig?.workingDirectoryOverride?.trim() || undefined;

  const controller = new AbortController();
  let deadlineTimer: NodeJS.Timeout | undefined;
  if (typeof input.deadlineAtMs === 'number' && Number.isFinite(input.deadlineAtMs)) {
    const remainingMs = Math.max(1, input.deadlineAtMs - Date.now());
    deadlineTimer = setTimeout(() => {
      controller.abort(new Error(`${driver.label} turn timed out.`));
    }, remainingMs);
    deadlineTimer.unref?.();
  }
  const signal = input.signal ? AbortSignal.any([input.signal, controller.signal]) : controller.signal;

  const runId = input.runId?.trim() || `ext-direct-${randomUUID()}`;
  let accumulatedText = '';
  let lastFinishedText = '';
  let turnError: string | undefined;
  let interrupted = false;

  try {
    for await (const event of runExternalProjectTurn({
      conversationId: input.conversationId,
      transcriptId,
      agentId: externalAgent.id,
      execution: externalAgent.execution,
      instructions: externalAgent.profile?.instructions,
      modelOverride: sessionConfig?.modelOverride,
      thinkingLevel: input.thinking ?? sessionConfig?.thinkingLevel,
      serviceTierOverride: sessionConfig?.serviceTierOverride,
      workspaceOverride,
      onTitleUpdated: (title) => {
        if (input.sessionStore) {
          void maybeApplyExternalSessionTitle(input.sessionStore, input.conversationId, title);
        }
      },
      content: input.content,
      attachments: input.attachments,
      hasAttachmentsOrContext: Boolean(input.attachments?.length),
      runId,
      signal,
      headless: true,
    })) {
      if (event.type === 'message_update') {
        const sub = event.assistantMessageEvent as { type?: string; delta?: string } | undefined;
        if (sub?.type === 'text_delta' && typeof sub.delta === 'string' && sub.delta) {
          accumulatedText += sub.delta;
          input.onTextUpdate?.(accumulatedText);
        }
      } else if (event.type === 'message_end') {
        const message = event.message as { content?: Array<{ type?: string; text?: string }> } | undefined;
        const text = (message?.content ?? [])
          .filter((part) => part.type === 'text' && typeof part.text === 'string')
          .map((part) => part.text!)
          .join('');
        if (text.trim()) {
          lastFinishedText = text;
        }
      } else if (event.type === 'turn_outcome') {
        const outcome = event.outcome as { status?: string; summary?: string } | undefined;
        interrupted = outcome?.status === 'partial' && outcome.summary === 'aborted';
        if (outcome?.status === 'failed') turnError = outcome.summary || `${driver.label} turn failed.`;
      } else if (event.type === 'error' && typeof event.content === 'string') {
        turnError = event.content;
      }
    }

    const text = (lastFinishedText || accumulatedText).trim();
    if (signal.aborted || interrupted) {
      const error = signal.reason instanceof Error ? signal.reason : new Error(`${driver.label} turn cancelled.`);
      return { text, status: 'interrupted', error };
    }
    if (turnError) return { text, status: 'failed', error: new Error(turnError) };
    return { text, status: 'succeeded' };
  } finally {
    if (deadlineTimer) clearTimeout(deadlineTimer);
  }
}
