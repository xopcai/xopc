import crypto from 'node:crypto';

import type { AgentMessage } from '@earendil-works/pi-agent-core';
import { SessionManager } from '@earendil-works/pi-coding-agent';
import type { Api, Model } from '@earendil-works/pi-ai';

import {
  SessionCompactor,
  type CompactionExecutionOptions,
  type CompactionResult,
} from '../memory/compaction.js';
import type { SessionStore } from '../../session/store.js';
import { openSqliteHydratingSessionManager } from './sqlite-hydrating-session-manager.js';

export interface EmbeddedTranscriptRuntime {
  readonly runtimeId: string;
  readonly sessionId: string;
  readonly persistent: boolean;

  openSessionManager(cwd: string): SessionManager;
  loadMessages(): Promise<AgentMessage[]>;
  compact(
    messages: AgentMessage[],
    model: Model<Api>,
    instructions?: string,
    force?: boolean,
    options?: CompactionExecutionOptions,
  ): Promise<CompactionResult>;
}

export async function createSqliteTranscriptRuntime(params: {
  sessionKey: string;
  sessionStore: SessionStore;
}): Promise<EmbeddedTranscriptRuntime> {
  const identity = await params.sessionStore.resolveTranscriptPath(params.sessionKey);
  return {
    runtimeId: params.sessionKey,
    sessionId: identity.sessionId,
    persistent: true,
    openSessionManager: (cwd) => openSqliteHydratingSessionManager({
      sessionKey: params.sessionKey,
      sessionId: identity.sessionId,
      cwd,
    }),
    loadMessages: () => params.sessionStore.load(params.sessionKey),
    compact: (messages, model, instructions, force, options) =>
      params.sessionStore.compact(
        params.sessionKey,
        messages,
        model,
        instructions,
        force,
        options,
      ),
  };
}

export class InMemoryTranscriptRuntime implements EmbeddedTranscriptRuntime {
  readonly persistent = false;
  readonly runtimeId: string;
  readonly sessionId: string;

  private readonly sessionManager: SessionManager;
  private readonly compactor = new SessionCompactor();
  private baselineEntryCount = 0;

  constructor(params: {
    runtimeId: string;
    cwd: string;
    initialMessages?: readonly AgentMessage[];
  }) {
    this.runtimeId = params.runtimeId;
    this.sessionId = crypto.randomUUID();
    this.sessionManager = SessionManager.inMemory(params.cwd, { id: this.sessionId });
    for (const message of params.initialMessages ?? []) {
      if (message.role === 'compactionSummary') {
        this.sessionManager.appendCustomMessageEntry(
          'side-chat-parent-compaction',
          `The parent conversation was compacted into this summary:\n\n${message.summary}`,
          false,
        );
      } else if (message.role === 'branchSummary') {
        this.sessionManager.appendCustomMessageEntry(
          'side-chat-parent-branch',
          `The parent conversation includes this branch summary:\n\n${message.summary}`,
          false,
        );
      } else {
        this.sessionManager.appendMessage(message);
      }
    }
    this.captureBaseline();
  }

  openSessionManager(_cwd: string): SessionManager {
    return this.sessionManager;
  }

  async loadMessages(): Promise<AgentMessage[]> {
    return [...this.sessionManager.buildSessionContext().messages];
  }

  captureBaseline(): void {
    this.baselineEntryCount = this.sessionManager.getBranch().length;
  }

  loadConversationMessages(): AgentMessage[] {
    return this.sessionManager
      .getBranch()
      .slice(this.baselineEntryCount)
      .flatMap((entry) => entry.type === 'message' ? [entry.message] : []);
  }

  async compact(
    messages: AgentMessage[],
    model: Model<Api>,
    instructions?: string,
    force?: boolean,
    options?: CompactionExecutionOptions,
  ): Promise<CompactionResult> {
    const result = await this.compactor.compact(messages, model, instructions, force, options);
    if (!result.compacted) return result;

    const messageEntries = this.sessionManager
      .getBranch()
      .filter((entry): entry is Extract<typeof entry, { type: 'message' }> => entry.type === 'message');
    const firstKept = messageEntries[result.firstKeptIndex];
    if (!firstKept) return { ...result, compacted: false };

    this.sessionManager.appendCompaction(
      result.summary,
      firstKept.id,
      result.tokensBefore,
      {
        plannerVersion: result.plannerVersion,
        summaryModelRef: result.summaryModelRef,
        qualityAudit: result.qualityAudit,
      },
    );
    return result;
  }
}
