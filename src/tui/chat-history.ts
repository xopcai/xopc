import type { AgentMessage } from '@earendil-works/pi-agent-core';

import type { HistoryMessage } from './tui-backend.js';
import { ChatLog } from './components/chat-log.js';
import { createAssistantMessageFromText } from './components/assistant-message.js';

export function historyMessageKey(message: HistoryMessage, index: number): string {
  if (message.id) return `id:${message.id}`;
  return [
    'fallback',
    index,
    message.kind ?? 'message',
    message.role,
    message.timestamp ?? '',
    JSON.stringify(message.content),
  ].join(':');
}

function historyContentText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map((block) => {
      if (!block || typeof block !== 'object') return '';
      const rec = block as { type?: unknown; text?: unknown; thinking?: unknown };
      if (rec.type === 'text' && typeof rec.text === 'string') return rec.text;
      if (rec.type === 'thinking' && typeof rec.thinking === 'string') return rec.thinking;
      return '';
    })
    .filter(Boolean)
    .join('\n');
}

function assistantHistoryMessage(content: unknown): AgentMessage {
  if (typeof content === 'string') {
    return createAssistantMessageFromText(content.trim() ? content : ' ');
  }
  if (Array.isArray(content)) {
    return {
      role: 'assistant',
      content,
      timestamp: Date.now(),
    } as AgentMessage;
  }
  return createAssistantMessageFromText(' ');
}

export function historyKeysHaveAppendOnlyPrefix(
  previousKeys: readonly string[],
  nextKeys: readonly string[],
): boolean {
  return (
    previousKeys.length > 0 &&
    previousKeys.length <= nextKeys.length &&
    previousKeys.every((key, index) => nextKeys[index] === key)
  );
}

/** Replay persisted transcript into the scroll log (synthetic run ids per assistant row). */
export function appendHistoryToChatLog(
  chatLog: ChatLog,
  messages: HistoryMessage[],
  toolsExpanded: boolean,
  showThinking = true,
  opts?: { startIndex?: number },
): void {
  chatLog.setToolsExpanded(toolsExpanded);
  chatLog.setShowThinking(showThinking);

  messages.forEach((hm, idx) => {
    const historyIndex = (opts?.startIndex ?? 0) + idx;
    const displayIndex = hm.displayIndex ?? historyIndex;
    const runId = `history:${historyIndex}`;

    if (hm.kind === 'bash') {
      if (hm.bash) {
        chatLog.addBashSummary(hm.bash);
      } else {
        chatLog.addSystem(historyContentText(hm.content));
      }
      return;
    }

    if (hm.kind === 'custom') {
      if (hm.custom) {
        if (hm.custom.state) return;
        if (hm.custom.display === false) return;
        chatLog.addCustomMessage({
          customType: hm.custom.customType,
          content: historyContentText(hm.content),
          rawContent: hm.rawContent,
          details: hm.custom.details,
          display: hm.custom.display,
        });
      } else {
        chatLog.addSystem(historyContentText(hm.content));
      }
      return;
    }

    if (hm.kind === 'branch') {
      if (hm.branch) {
        chatLog.addBranchMessageSummary(hm.branch);
      } else {
        chatLog.addSystem(historyContentText(hm.content));
      }
      return;
    }

    if (hm.kind === 'compaction') {
      chatLog.addCompactionSummary({
        compacted: true,
        summary: historyContentText(hm.content),
        tokensBefore: hm.tokensBefore,
        tokensAfter: hm.tokensAfter,
        transcriptSummary: historyContentText(hm.content),
      });
      return;
    }

    if (hm.role === 'user') {
      chatLog.addUser(historyContentText(hm.content), {
        displayIndex,
        historyIndex,
        role: 'user',
      });
      return;
    }

    if (hm.role === 'system') {
      chatLog.addSystem(historyContentText(hm.content), {
        displayIndex,
        historyIndex,
        role: 'system',
      });
      return;
    }

    chatLog.finalizeAssistant(assistantHistoryMessage(hm.content), runId, {
      displayIndex,
      historyIndex,
      role: 'assistant',
    });

    const tools = hm.toolCalls ?? [];
    for (let t = 0; t < tools.length; t++) {
      const tc = tools[t]!;
      const tid = `history:${historyIndex}:t:${t}`;
      chatLog.startTool(tid, tc.name, tc.args ?? {}, runId);
      if (tc.result !== undefined) {
        chatLog.updateToolResult(tid, tc.result, tc.isError ?? false);
      }
    }
  });
}
