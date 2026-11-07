import type { AgentSession } from '@earendil-works/pi-coding-agent';
import type { ImageContent } from '@earendil-works/pi-ai';
import type { AgentMessage } from '@earendil-works/pi-agent-core';

import { AgentRunCancelledError } from '../orchestration/run-termination.js';
import { registerSteeringTranscript, type TranscriptUserMessage } from '../inbound/attachment-pipeline.js';
import { VOICE_AGENT_INSTRUCTION_TYPE } from '../../session/voice-transcript.js';

export type EmbeddedSteerOptions = { images?: ImageContent[]; transcriptMessage?: TranscriptUserMessage; voiceAgentInstruction?: boolean };

export type EmbeddedRunIdentity = {
  conversationId: string;
  transcriptId: string;
  runId: string;
};

export type EmbeddedRunHandle = EmbeddedRunIdentity & {
  session: AgentSession;
  abort: () => Promise<void>;
};

type PendingEmbeddedRun = EmbeddedRunIdentity & {
  handle?: EmbeddedRunHandle;
  abortController: AbortController;
  steeringCleanup: Array<() => void>;
  steeringImages: Map<TranscriptUserMessage, ImageContent[]>;
};

export class EmbeddedRunConflictError extends Error {
  constructor(readonly conversationId: string, readonly activeRunId: string) {
    super(`Session '${conversationId}' already has active embedded run '${activeRunId}'`);
    this.name = 'EmbeddedRunConflictError';
  }
}

export type EmbeddedRunLease = {
  signal: AbortSignal;
  attach(session: AgentSession, abort: () => Promise<void>): Promise<void>;
  release(): void;
};

export type EmbeddedRunCancellation = {
  signal: AbortSignal;
  release(): void;
};

/** Owns one process-local execution lease per session while leaving steer/abort on the control plane. */
export class EmbeddedRunRegistry {
  private readonly byConversationId = new Map<string, PendingEmbeddedRun>();
  private readonly prepared = new Map<string, AbortController>();

  reserveCancellation(identity: Pick<EmbeddedRunIdentity, 'conversationId' | 'runId'>): EmbeddedRunCancellation {
    const key = JSON.stringify([identity.conversationId, identity.runId]);
    if (this.prepared.has(key)) throw new EmbeddedRunConflictError(identity.conversationId, identity.runId);
    const controller = new AbortController();
    this.prepared.set(key, controller);
    return { signal: controller.signal, release: () => {
      if (this.prepared.get(key) === controller) this.prepared.delete(key);
    } };
  }

  acquire(identity: EmbeddedRunIdentity): EmbeddedRunLease {
    const active = this.byConversationId.get(identity.conversationId);
    if (active) throw new EmbeddedRunConflictError(identity.conversationId, active.runId);

    const controller = this.prepared.get(JSON.stringify([identity.conversationId, identity.runId]));
    const entry: PendingEmbeddedRun = { ...identity, abortController: controller ?? new AbortController(), steeringCleanup: [], steeringImages: new Map() };
    this.byConversationId.set(identity.conversationId, entry);

    return {
      signal: entry.abortController.signal,
      attach: async (session, abort) => {
        entry.handle = { ...identity, session, abort };
        if (entry.abortController.signal.aborted) await abort();
      },
      release: () => {
        for (const cleanup of entry.steeringCleanup) cleanup();
        entry.steeringCleanup.length = 0;
        entry.steeringImages.clear();
        if (this.byConversationId.get(identity.conversationId) === entry) {
          this.byConversationId.delete(identity.conversationId);
        }
      },
    };
  }

  getByConversationId(conversationId: string): EmbeddedRunHandle | undefined {
    return this.byConversationId.get(conversationId)?.handle;
  }

  async abortByConversationId(conversationId: string, reason: 'user_cancelled' | 'parent_cancelled' = 'parent_cancelled', expectedRunId?: string): Promise<boolean> {
    const entry = this.byConversationId.get(conversationId);
    if (!entry || (expectedRunId !== undefined && entry.runId !== expectedRunId)) {
      const prepared = expectedRunId === undefined ? undefined : this.prepared.get(JSON.stringify([conversationId, expectedRunId]));
      if (!prepared) return false;
      prepared.abort(new AgentRunCancelledError('Embedded run aborted', reason));
      return true;
    }
    entry.abortController.abort(new AgentRunCancelledError('Embedded run aborted', reason));
    if (entry.handle) await entry.handle.abort();
    return true;
  }

  async steerByConversationId(conversationId: string, text: string, expectedRunId?: string, options?: EmbeddedSteerOptions): Promise<boolean> {
    const handle = this.getByConversationId(conversationId);
    if (!handle || (expectedRunId !== undefined && handle.runId !== expectedRunId)
      || this.byConversationId.get(conversationId)?.abortController.signal.aborted) {
      return false;
    }
    const entry = this.byConversationId.get(conversationId)!;
    if (options?.voiceAgentInstruction) {
      await handle.session.sendCustomMessage({ customType: VOICE_AGENT_INSTRUCTION_TYPE, content: text, display: false },
        { deliverAs: 'steer', triggerTurn: true });
      return true;
    }
    const transcript = options?.transcriptMessage;
    const unregister = transcript ? registerSteeringTranscript(conversationId, transcript) : undefined;
    if (transcript && options?.images?.length) entry.steeringImages.set(transcript, options.images);
    const cleanup = () => { unregister?.(); if (transcript) entry.steeringImages.delete(transcript); };
    entry.steeringCleanup.push(cleanup);
    try {
      const disposition = options?.images?.length
        ? await handle.session.steer(text, options.images)
        : await handle.session.steer(text);
      if (disposition === 'handled') cleanup();
    } catch (error) {
      cleanup();
      throw error;
    }
    return true;
  }

  restoreSteeringImages(conversationId: string, runId: string, messages: AgentMessage[]): AgentMessage[] {
    const entry = this.byConversationId.get(conversationId);
    if (!entry || entry.runId !== runId || entry.steeringImages.size === 0) return messages;
    let next = messages;
    let after = -1;
    for (const [transcript, images] of entry.steeringImages) {
      const text = userMessageText(transcript);
      const index = messages.findIndex((message, index) => index > after && message.role === 'user'
        && (!(message as { turnId?: string }).turnId || (message as { turnId?: string }).turnId === runId)
        && (transcript.timestamp === undefined || (message as { timestamp?: number }).timestamp === transcript.timestamp)
        && userMessageText(message) === text);
      if (index < 0) continue;
      after = index;
      const user = messages[index] as Extract<AgentMessage, { role: 'user' }>;
      const content = typeof user.content === 'string' ? [{ type: 'text' as const, text: user.content }] : user.content;
      if (content.some(part => part.type === 'image')) continue;
      if (next === messages) next = [...messages];
      next[index] = { ...user, content: [...content, ...images] };
    }
    return next;
  }

  size(): number {
    return this.byConversationId.size;
  }
}

const embeddedRunRegistry = new EmbeddedRunRegistry();

function userMessageText(message: AgentMessage): string {
  const content = (message as { content?: unknown }).content;
  return typeof content === 'string' ? content.trim() : Array.isArray(content)
    ? content.filter(part => part?.type === 'text').map(part => part.text).join('\n').trim() : '';
}

export function restoreEmbeddedSteeringImages(conversationId: string, runId: string, messages: AgentMessage[]): AgentMessage[] {
  return embeddedRunRegistry.restoreSteeringImages(conversationId, runId, messages);
}

export function acquireEmbeddedRunLease(identity: EmbeddedRunIdentity): EmbeddedRunLease {
  return embeddedRunRegistry.acquire(identity);
}

export function reserveEmbeddedRunCancellation(identity: Pick<EmbeddedRunIdentity, 'conversationId' | 'runId'>): EmbeddedRunCancellation {
  return embeddedRunRegistry.reserveCancellation(identity);
}

export function getEmbeddedRunByConversationId(conversationId: string): EmbeddedRunHandle | undefined {
  return embeddedRunRegistry.getByConversationId(conversationId);
}

export function abortEmbeddedRun(conversationId: string, reason: 'user_cancelled' | 'parent_cancelled' = 'parent_cancelled', expectedRunId?: string): Promise<boolean> {
  return embeddedRunRegistry.abortByConversationId(conversationId, reason, expectedRunId);
}

export function queueEmbeddedSteer(conversationId: string, text: string, expectedRunId?: string, options?: EmbeddedSteerOptions): Promise<boolean> {
  return embeddedRunRegistry.steerByConversationId(conversationId, text, expectedRunId, options);
}
