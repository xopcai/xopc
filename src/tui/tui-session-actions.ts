import type { TUI } from '@earendil-works/pi-tui';

import {
  appendHistoryToChatLog,
  historyKeysHaveAppendOnlyPrefix,
  historyMessageKey,
} from './chat-history.js';
import type { ChatLog } from './components/chat-log.js';
import { clearSeenStreamEvents } from './tui-agent-events.js';
import type { TuiBackend } from './tui-backend.js';
import type { TuiState } from './tui-types.js';
import type { TuiSessionSnapshot } from './tui-session-snapshot.js';
import {
  markRunAborting,
  markRunIdleAfterAbort,
  resetRunStatus,
} from './tui-run-state.js';

export type SessionActionsContext = {
  client: TuiBackend;
  chatLog: ChatLog;
  tui: TUI;
  state: TuiState;
  resolveConversationId: (raw?: string) => string;
  updateHeader: () => void;
  updateFooter: () => void;
  setActivityStatus: (status: string) => void;
  historyLimit?: number;
  onAgentIdChange?: (agentId: string) => void;
  sessionSnapshot?: TuiSessionSnapshot;
  onSessionInfoChange?: () => void;
};

export function createSessionActions(context: SessionActionsContext) {
  const {
    client,
    chatLog,
    tui,
    state,
    resolveConversationId,
    updateHeader,
    updateFooter,
    setActivityStatus,
    historyLimit = 200,
    onAgentIdChange,
    sessionSnapshot,
    onSessionInfoChange,
  } = context;

  let generation = 0;
  let historyRequest = 0;
  let infoRequest = 0;
  let pendingAbort: { runId: string; generation: number; promise: Promise<void> } | undefined;
  let lastHistoryKeys: string[] = [];

  const captureSession = () => {
    const conversationId = state.currentConversationId;
    const version = generation;
    return { conversationId, isCurrent: () => conversationId === state.currentConversationId && version === generation };
  };

  const refreshSessionInfo = async () => {
    const session = captureSession();
    const request = ++infoRequest;
    try {
      const info = await client.getSessionInfo(session.conversationId);
      if (!session.isCurrent() || request !== infoRequest) return;
      state.sessionInfo = { ...info, interactionPolicy: info.interactionPolicy ?? state.sessionInfo.interactionPolicy };
      if (info.agentId) onAgentIdChange?.(info.agentId);
      onSessionInfoChange?.();
      updateFooter();
      tui.requestRender();
    } catch (error) {
      if (!session.isCurrent() || request !== infoRequest) return;
      chatLog.addStatus(`Session information unavailable: ${error instanceof Error ? error.message : String(error)}`);
      tui.requestRender();
    }
  };

  const clearChatForSessionSwitch = () => {
    generation++;
    historyRequest++;
    infoRequest++;
    chatLog.clearAll();
    clearSeenStreamEvents();
    sessionSnapshot?.clear();
    lastHistoryKeys = [];
    resetRunStatus(state);
    state.sessionInfo = {};
    state.historyLoaded = false;
  };

  const loadHistory = async (opts?: { merge?: boolean }) => {
    const session = captureSession();
    const request = ++historyRequest;
    try {
      const { messages } = await client.loadHistory({
        conversationId: session.conversationId,
        limit: historyLimit,
      });
      if (!session.isCurrent() || request !== historyRequest) return;
      sessionSnapshot?.replaceFromHistory(messages);
      const nextKeys = messages.map(historyMessageKey);
      const canAppend =
        opts?.merge === true &&
        historyKeysHaveAppendOnlyPrefix(lastHistoryKeys, nextKeys);
      if (canAppend) {
        appendHistoryToChatLog(
          chatLog,
          messages.slice(lastHistoryKeys.length),
          state.toolsExpanded,
          state.showThinking,
          { startIndex: lastHistoryKeys.length },
        );
      } else {
        chatLog.clearAll();
        appendHistoryToChatLog(chatLog, messages, state.toolsExpanded, state.showThinking);
      }
      lastHistoryKeys = nextKeys;
      state.historyLoaded = true;
    } catch (error) {
      if (!session.isCurrent() || request !== historyRequest) return;
      chatLog.addStatus(`History unavailable; showing the last loaded view. ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      if (session.isCurrent() && request === historyRequest) {
        await refreshSessionInfo();
        tui.requestRender();
      }
    }
  };

  const loadHistoryWindow = async (opts: {
    rowNumber: number;
    before?: number;
    after?: number;
  }): Promise<boolean> => {
    if (!client.loadHistoryWindow) {
      return false;
    }
    const session = captureSession();
    const request = ++historyRequest;
    try {
      const { messages } = await client.loadHistoryWindow({
        conversationId: session.conversationId,
        rowNumber: opts.rowNumber,
        before: opts.before,
        after: opts.after,
      });
      if (!session.isCurrent() || request !== historyRequest || messages.length === 0) {
        return false;
      }
      sessionSnapshot?.replaceFromHistory(messages);
      chatLog.clearAll();
      appendHistoryToChatLog(chatLog, messages, state.toolsExpanded, state.showThinking);
      lastHistoryKeys = messages.map(historyMessageKey);
      state.historyLoaded = true;
      return true;
    } catch (error) {
      if (session.isCurrent() && request === historyRequest) {
        chatLog.addStatus(`History window unavailable: ${error instanceof Error ? error.message : String(error)}`);
      }
      return false;
    } finally {
      if (session.isCurrent() && request === historyRequest) {
        await refreshSessionInfo();
        tui.requestRender();
      }
    }
  };

  const setSession = async (rawKey: string) => {
    const nextKey = resolveConversationId(rawKey);
    state.currentConversationId = nextKey;
    state.activeRunId = null;
    setActivityStatus('idle');
    clearChatForSessionSwitch();
    updateHeader();
    updateFooter();
    await loadHistory();
  };

  const abortActive = (opts?: { clearUi?: boolean }): Promise<void> => {
    if (!state.activeRunId) return Promise.resolve();
    if (pendingAbort?.runId === state.activeRunId && pendingAbort.generation === generation) return pendingAbort.promise;
    const session = captureSession();
    const runId = state.activeRunId;
    markRunAborting(state, runId);
    setActivityStatus('aborting');
    tui.requestRender();
    const token = { runId, generation, promise: undefined as unknown as Promise<void> };
    pendingAbort = token;
    token.promise = (async () => {
      try {
        const result = await client.abortChat({ conversationId: session.conversationId, runId });
        if (!session.isCurrent() || state.activeRunId !== runId) return;
        if (!result.ok) throw new Error('The backend did not confirm that the run stopped.');
        state.activeRunId = null;
        if (opts?.clearUi !== false) chatLog.dropAssistant(runId);
        markRunIdleAfterAbort(state);
        setActivityStatus('idle');
      } catch (error) {
        if (!session.isCurrent() || state.activeRunId !== runId) return;
        state.runStatus = { ...state.runStatus, phase: 'stalled', stalledAt: Date.now() };
        setActivityStatus('stalled');
        throw error;
      } finally {
        if (pendingAbort === token) pendingAbort = undefined;
        if (session.isCurrent()) tui.requestRender();
      }
    })();
    return token.promise;
  };

  const resetCurrentSession = async () => {
    const session = captureSession();
    await abortActive();
    if (!session.isCurrent()) return;
    await client.resetSession(session.conversationId);
    if (!session.isCurrent()) return;
    clearChatForSessionSwitch();
    await loadHistory();
  };

  return {
    sessionVersion: () => generation,
    refreshSessionInfo,
    loadHistory,
    loadHistoryWindow,
    setSession,
    abortActive,
    resetCurrentSession,
    clearChatForSessionSwitch,
  };
}
