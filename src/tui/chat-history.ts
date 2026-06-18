import type { HistoryMessage } from './tui-backend.js';
import { ChatLog } from './components/chat-log.js';

/** Replay persisted transcript into the scroll log (synthetic run ids per assistant row). */
export function appendHistoryToChatLog(
  chatLog: ChatLog,
  messages: HistoryMessage[],
  toolsExpanded: boolean,
  showThinking = true,
): void {
  chatLog.setToolsExpanded(toolsExpanded);
  chatLog.setShowThinking(showThinking);

  messages.forEach((hm, idx) => {
    const runId = `history:${idx}`;

    if (hm.kind === 'bash') {
      if (hm.bash) {
        chatLog.addBashSummary(hm.bash);
      } else {
        chatLog.addSystem(hm.content);
      }
      return;
    }

    if (hm.kind === 'custom') {
      if (hm.custom) {
        if (hm.custom.state) return;
        if (hm.custom.display === false) return;
        chatLog.addCustomMessage({
          customType: hm.custom.customType,
          content: hm.content,
          rawContent: hm.rawContent,
          details: hm.custom.details,
          display: hm.custom.display,
        });
      } else {
        chatLog.addSystem(hm.content);
      }
      return;
    }

    if (hm.kind === 'branch') {
      if (hm.branch) {
        chatLog.addBranchMessageSummary(hm.branch);
      } else {
        chatLog.addSystem(hm.content);
      }
      return;
    }

    if (hm.kind === 'compaction') {
      chatLog.addCompactionSummary({
        compacted: true,
        summary: hm.content,
        tokensBefore: hm.tokensBefore,
        tokensAfter: hm.tokensAfter,
        transcriptSummary: hm.content,
      });
      return;
    }

    if (hm.role === 'user') {
      chatLog.addUser(hm.content);
      return;
    }

    if (hm.role === 'system') {
      chatLog.addSystem(hm.content);
      return;
    }

    const tools = hm.toolCalls ?? [];
    for (let t = 0; t < tools.length; t++) {
      const tc = tools[t]!;
      const tid = `history:${idx}:t:${t}`;
      chatLog.startTool(tid, tc.name, tc.args ?? {}, runId);
      if (tc.result !== undefined) {
        chatLog.updateToolResult(tid, tc.result, tc.isError ?? false);
      }
    }

    const body = hm.content.trim() ? hm.content : ' ';
    chatLog.finalizeAssistant(body, runId);
  });
}
