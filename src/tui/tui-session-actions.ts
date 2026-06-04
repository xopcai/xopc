import type { TUI } from '@earendil-works/pi-tui';

import { parseAgentSessionKey } from '../routing/agent-session-key.js';
import { appendHistoryToChatLog } from './chat-history.js';
import type { ChatLog } from './components/chat-log.js';
import { clearPendingToolCallIds } from './tui-agent-events.js';
import type { TuiBackend } from './tui-backend.js';
import type { StreamAssembler } from './stream-assembler.js';
import type { TuiState } from './tui-types.js';

export type SessionActionsContext = {
  client: TuiBackend;
  chatLog: ChatLog;
  tui: TUI;
  state: TuiState;
  assembler: StreamAssembler;
  resolveSessionKey: (raw?: string) => string;
  updateHeader: () => void;
  updateFooter: () => void;
  setActivityStatus: (status: string) => void;
  historyLimit?: number;
  onAgentIdChange?: (agentId: string) => void;
};

export function createSessionActions(context: SessionActionsContext) {
  const {
    client,
    chatLog,
    tui,
    state,
    assembler,
    resolveSessionKey,
    updateHeader,
    updateFooter,
    setActivityStatus,
    historyLimit = 200,
    onAgentIdChange,
  } = context;

  let refreshSessionInfoPromise: Promise<void> = Promise.resolve();

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
    assembler.clear();
    chatLog.clearAll();
    clearPendingToolCallIds();
    state.historyLoaded = false;
    state.messageFollowUpQueue.length = 0;
  };

  const loadHistory = async () => {
    try {
      const { messages } = await client.loadHistory({
        sessionKey: state.currentSessionKey,
        limit: historyLimit,
      });
      chatLog.clearAll();
      appendHistoryToChatLog(chatLog, messages, state.toolsExpanded);
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
    state.activeRunId = null;
    assembler.drop(runId);
    if (opts?.clearUi !== false) {
      chatLog.dropAssistant(runId);
    }
    setActivityStatus('idle');
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
