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

  let refreshSessionInfoPromise: Promise<void> = Promise.resolve();
  let lastHistoryKeys: string[] = [];

  const runRefreshSessionInfo = async () => {
    try {
      state.sessionInfo = await client.getSessionInfo(state.currentConversationId);
      if (state.sessionInfo.agentId) onAgentIdChange?.(state.sessionInfo.agentId);
      onSessionInfoChange?.();
      updateFooter();
      tui.requestRender();
    } catch {
      // ignore
    }
  };

  const refreshSessionInfo = async () => {
    refreshSessionInfoPromise = refreshSessionInfoPromise.then(
      runRefreshSessionInfo,
      runRefreshSessionInfo,
    );
    await refreshSessionInfoPromise;
  };

  const clearChatForSessionSwitch = () => {
    chatLog.clearAll();
    clearSeenStreamEvents();
    sessionSnapshot?.clear();
    lastHistoryKeys = [];
    resetRunStatus(state);
    state.historyLoaded = false;
  };

  const loadHistory = async (opts?: { merge?: boolean }) => {
    try {
      const { messages } = await client.loadHistory({
        conversationId: state.currentConversationId,
        limit: historyLimit,
      });
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
    } catch {
      // ignore; footer already hints on disconnect
    } finally {
      state.historyLoaded = true;
      await refreshSessionInfo();
      tui.requestRender();
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
    try {
      const { messages } = await client.loadHistoryWindow({
        conversationId: state.currentConversationId,
        rowNumber: opts.rowNumber,
        before: opts.before,
        after: opts.after,
      });
      if (messages.length === 0) {
        return false;
      }
      sessionSnapshot?.replaceFromHistory(messages);
      chatLog.clearAll();
      appendHistoryToChatLog(chatLog, messages, state.toolsExpanded, state.showThinking);
      lastHistoryKeys = messages.map(historyMessageKey);
      state.historyLoaded = true;
      return true;
    } catch {
      return false;
    } finally {
      await refreshSessionInfo();
      tui.requestRender();
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

  const abortActive = async (opts?: { clearUi?: boolean }) => {
    if (!state.activeRunId) {
      return;
    }
    const runId = state.activeRunId;
    markRunAborting(state, runId);
    state.activeRunId = null;
    if (opts?.clearUi !== false) {
      chatLog.dropAssistant(runId);
    }
    setActivityStatus('idle');
    markRunIdleAfterAbort(state);
    tui.requestRender();
    await client.abortChat({ conversationId: state.currentConversationId, runId }).catch(() => {});
  };

  const resetCurrentSession = async () => {
    await client.resetSession(state.currentConversationId);
    clearChatForSessionSwitch();
    await loadHistory();
  };

  return {
    refreshSessionInfo,
    loadHistory,
    loadHistoryWindow,
    setSession,
    abortActive,
    resetCurrentSession,
    clearChatForSessionSwitch,
  };
}
