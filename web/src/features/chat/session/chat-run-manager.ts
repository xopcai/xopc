import type { AgentStreamRunStatus } from '@xopcai/gateway-contract';

import { MessageSender } from '@/features/chat/messages/message-sender';

/** App-wide owner of run subscriptions, scoped per session for safe route switching. */
class ChatRunManager {
  private static instance: ChatRunManager | undefined;
  private readonly senders = new Map<string, MessageSender>();
  private readonly resumeRunIds = new Map<string, string>();
  private readonly userAbortedSessions = new Set<string>();

  static get(): ChatRunManager {
    if (!ChatRunManager.instance) ChatRunManager.instance = new ChatRunManager();
    return ChatRunManager.instance;
  }

  senderFor(conversationId: string): MessageSender {
    let sender = this.senders.get(conversationId);
    if (!sender) {
      sender = new MessageSender();
      this.senders.set(conversationId, sender);
    }
    return sender;
  }

  isStreamingFor(conversationId: string): boolean {
    return this.senders.get(conversationId)?.isStreamingFor(conversationId) ?? false;
  }

  isTrackingRun(conversationId: string, runId: string): boolean {
    return this.senders.get(conversationId)?.isTrackingRun(conversationId, runId) ?? false;
  }

  getResumeRunId(conversationId: string): string | null {
    return this.resumeRunIds.get(conversationId) ?? null;
  }

  setResumeRunId(conversationId: string, runId: string | null): void {
    if (runId) this.resumeRunIds.set(conversationId, runId);
    else this.resumeRunIds.delete(conversationId);
  }

  setUserAborted(conversationId: string, aborted: boolean): void {
    if (aborted) this.userAbortedSessions.add(conversationId);
    else this.userAbortedSessions.delete(conversationId);
  }

  takeUserAborted(conversationId: string): boolean {
    return this.userAbortedSessions.delete(conversationId);
  }

  resetRunTracking(conversationId: string): void {
    this.resumeRunIds.delete(conversationId);
    this.userAbortedSessions.delete(conversationId);
  }

  abort(conversationId: string): void {
    this.senders.get(conversationId)?.abort();
    this.senders.delete(conversationId);
    this.resetRunTracking(conversationId);
  }

  reconcileTerminal(conversationId: string, runId: string, status: AgentStreamRunStatus): boolean {
    const handled = this.senders.get(conversationId)?.reconcileTerminal(conversationId, runId, status) ?? false;
    if (this.resumeRunIds.get(conversationId) === runId) this.resumeRunIds.delete(conversationId);
    return handled;
  }

  reconcileInactive(conversationId: string, runId: string): boolean {
    const handled = this.senders.get(conversationId)?.reconcileInactive(conversationId, runId) ?? false;
    if (this.resumeRunIds.get(conversationId) === runId) this.resumeRunIds.delete(conversationId);
    return handled;
  }

  releaseIdleSender(conversationId: string): void {
    const sender = this.senders.get(conversationId);
    if (sender && !sender.isSending) this.senders.delete(conversationId);
  }
}

export const chatRunManager = ChatRunManager.get();
