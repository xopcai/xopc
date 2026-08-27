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
import type { XopcTranscriptCompactionEntry } from '../../session/session-context-for-llm.js';
import type { TranscriptSourceEntry } from '../../storage/sqlite/transcript-repository.js';
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
  private readonly compactionRows = new Map<string, XopcTranscriptCompactionEntry>();
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
    _messages: AgentMessage[],
    model: Model<Api>,
    instructions?: string,
    force?: boolean,
    options?: CompactionExecutionOptions,
  ): Promise<CompactionResult> {
    const branch = this.sessionManager.getBranch();
    const sources = branch.flatMap((entry, index): TranscriptSourceEntry[] => {
      const compaction = this.compactionRows.get(entry.id);
      if (compaction) {
        return [{ entryId: entry.id, seq: index + 1, createdAt: Date.now(), row: compaction }];
      }
      if (entry.type !== 'message') return [];
      return [{ entryId: entry.id, seq: index + 1, createdAt: Date.now(), row: entry.message }];
    });
    const result = await this.compactor.compact(sources, model, instructions, force, options);
    if (!result.compacted || !result.handover || !result.audit) return result;

    const messageEntries = branch
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
    const boundary = this.sessionManager.getBranch().at(-1);
    if (boundary) {
      this.compactionRows.set(boundary.id, {
        type: 'compaction',
        at: new Date().toISOString(),
        baseSeq: branch.length,
        plannerVersion: 3,
        summaryModelRef: result.summaryModelRef ?? 'unknown',
        qualityAudit: result.qualityAudit ?? 'disabled',
        handover: result.handover,
        audit: result.audit,
        summary: result.summary,
        messages: result.messages,
        firstKeptIndex: result.firstKeptIndex,
        tokensBefore: result.tokensBefore,
        tokensAfter: result.tokensAfter,
      });
    }
    return result;
  }
}
