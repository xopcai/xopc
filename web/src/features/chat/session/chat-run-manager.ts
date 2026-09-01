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

  senderFor(sessionKey: string): MessageSender {
    let sender = this.senders.get(sessionKey);
    if (!sender) {
      sender = new MessageSender();
      this.senders.set(sessionKey, sender);
    }
    return sender;
  }

  isStreamingFor(sessionKey: string): boolean {
    return this.senders.get(sessionKey)?.isStreamingFor(sessionKey) ?? false;
  }

  isTrackingRun(sessionKey: string, runId: string): boolean {
    return this.senders.get(sessionKey)?.isTrackingRun(sessionKey, runId) ?? false;
  }

  getResumeRunId(sessionKey: string): string | null {
    return this.resumeRunIds.get(sessionKey) ?? null;
  }

  setResumeRunId(sessionKey: string, runId: string | null): void {
    if (runId) this.resumeRunIds.set(sessionKey, runId);
    else this.resumeRunIds.delete(sessionKey);
  }

  setUserAborted(sessionKey: string, aborted: boolean): void {
    if (aborted) this.userAbortedSessions.add(sessionKey);
    else this.userAbortedSessions.delete(sessionKey);
  }

  takeUserAborted(sessionKey: string): boolean {
    return this.userAbortedSessions.delete(sessionKey);
  }

  resetRunTracking(sessionKey: string): void {
    this.resumeRunIds.delete(sessionKey);
    this.userAbortedSessions.delete(sessionKey);
  }

  abort(sessionKey: string): void {
    this.senders.get(sessionKey)?.abort();
    this.senders.delete(sessionKey);
    this.resetRunTracking(sessionKey);
  }

  reconcileTerminal(sessionKey: string, runId: string, status: AgentStreamRunStatus): boolean {
    const handled = this.senders.get(sessionKey)?.reconcileTerminal(sessionKey, runId, status) ?? false;
    if (this.resumeRunIds.get(sessionKey) === runId) this.resumeRunIds.delete(sessionKey);
    return handled;
  }

  reconcileInactive(sessionKey: string, runId: string): boolean {
    const handled = this.senders.get(sessionKey)?.reconcileInactive(sessionKey, runId) ?? false;
    if (this.resumeRunIds.get(sessionKey) === runId) this.resumeRunIds.delete(sessionKey);
    return handled;
  }

  releaseIdleSender(sessionKey: string): void {
    const sender = this.senders.get(sessionKey);
    if (sender && !sender.isSending) this.senders.delete(sessionKey);
  }
}

export const chatRunManager = ChatRunManager.get();
