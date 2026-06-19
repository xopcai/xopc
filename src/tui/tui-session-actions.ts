import type { TUI } from '@earendil-works/pi-tui';

import { parseAgentSessionKey } from '../routing/agent-session-key.js';
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
  resolveSessionKey: (raw?: string) => string;
  updateHeader: () => void;
  updateFooter: () => void;
  setActivityStatus: (status: string) => void;
  historyLimit?: number;
  onAgentIdChange?: (agentId: string) => void;
  sessionSnapshot?: TuiSessionSnapshot;
};

export function createSessionActions(context: SessionActionsContext) {
  const {
    client,
    chatLog,
    tui,
    state,
    resolveSessionKey,
    updateHeader,
    updateFooter,
    setActivityStatus,
    historyLimit = 200,
    onAgentIdChange,
    sessionSnapshot,
  } = context;

  let refreshSessionInfoPromise: Promise<void> = Promise.resolve();
  let lastHistoryKeys: string[] = [];

  const updateAgentFromSessionKey = (key: string) => {
    const parsed = parseAgentSessionKey(key);
    if (!parsed?.agentId) {
      return;
    }
    onAgentIdChange?.(parsed.agentId);
  };

  const runRefreshSessionInfo = async () => {
    try {
      state.sessionInfo = await client.getSessionInfo(state.currentSessionKey);
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
    state.messageFollowUpQueue.length = 0;
    state.steeringQueue.length = 0;
  };

  const loadHistory = async (opts?: { merge?: boolean }) => {
    try {
      const { messages } = await client.loadHistory({
        sessionKey: state.currentSessionKey,
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

  const setSession = async (rawKey: string) => {
    const nextKey = resolveSessionKey(rawKey);
    updateAgentFromSessionKey(nextKey);
    state.currentSessionKey = nextKey;
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
    await client.abortChat({ sessionKey: state.currentSessionKey, runId }).catch(() => {});
  };

  const resetCurrentSession = async () => {
    await client.resetSession(state.currentSessionKey);
    clearChatForSessionSwitch();
    await loadHistory();
  };

  return {
    refreshSessionInfo,
    loadHistory,
    setSession,
    abortActive,
    resetCurrentSession,
    clearChatForSessionSwitch,
  };
}
